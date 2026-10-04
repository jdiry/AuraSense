#include "fwog_display.h"
#include "pico/stdlib.h"

#include <stdio.h>
#include <string.h>

#include "aura_cmd.h"

/* Red held 6 s powers the board off. fwog_power_poll() below must run on
   every loop iteration -- see bsp/display_cpu/power/power_poll.h. */
FWOG_POWER_DEFAULT();

/* Host protocol: one JSON command per line on this CPU's USB CDC port
   ("FWOG display AuraSense <ver>"), one JSON reply per line back. Anything
   the host should ignore (heartbeat, diagnostics) starts with '#'. */

#define LED_FRAME_MS   20u
#define BAR_FRAME_MS   50u
#define HEARTBEAT_MS   5000u
#define IDLE_GLOW_MS   6000u   /* one slow idle breath */

#define BAR_X  20u
#define BAR_Y  170u
#define BAR_W  (ST7789_W - 2u * BAR_X)
#define BAR_H  24u

static aura_t s_aura;
static bool s_lcd_ready;
static uint16_t s_bg, s_fg, s_accent, s_track;

/* ---- Screen ---- */

static void draw_centered(uint16_t y, const char *text, unsigned scale, uint16_t fg) {
    const unsigned cols = lcd_text_cols(ST7789_W, scale);
    const unsigned w = lcd_text_width_px(cols, scale);
    /* Pad to the full width so a shorter label erases a longer one. */
    char padded[48];
    const unsigned len = (unsigned)strlen(text);
    const unsigned left = len < cols ? (cols - len) / 2u : 0u;
    snprintf(padded, sizeof padded, "%*s%s", (int)left, "", text);
    lcd_text_draw_padded((uint16_t)((ST7789_W - w) / 2u), y, padded, cols, scale, fg, s_bg);
}

static void screen_idle(void) {
    if (!s_lcd_ready) return;
    st7789_clear(s_bg);
    st7789_dma_wait();
    /* Scale 3 is the most lcd_text draws: above LCD_MAX_SCALE (private to
       lcd_text.c) every glyph is silently skipped and the screen stays black. */
    draw_centered(90, "AuraSense", 3, s_fg);
}

static void screen_intervene_start(void) {
    if (!s_lcd_ready) return;
    st7789_clear(s_bg);
    st7789_dma_wait();
    st7789_fill_rect(BAR_X, BAR_Y, BAR_W, BAR_H, s_track);
}

static void screen_phase(aura_phase_t p) {
    if (!s_lcd_ready) return;
    draw_centered(90, aura_phase_label(p), 3, s_fg);
}

/* Placeholder for the Phase 4 breathing circle: a bar that fills and drains
   with the breath. */
static void screen_bar(unsigned level) {
    if (!s_lcd_ready) return;
    const uint16_t filled = (uint16_t)((uint32_t)BAR_W * level / 1000u);
    if (filled) st7789_fill_rect(BAR_X, BAR_Y, filled, BAR_H, s_accent);
    if (filled < BAR_W) st7789_fill_rect(BAR_X + filled, BAR_Y, BAR_W - filled, BAR_H, s_track);
}

/* ---- LEDs ---- */

static void leds_all(uint8_t r, uint8_t g, uint8_t b) {
    for (unsigned i = 0; i < FWOG_LED_COUNT; i++) ws2812_set_color(i, r, g, b);
    ws2812_process();
}

static void leds_frame(uint32_t now) {
    if (s_aura.state == AURA_STATE_INTERVENING) {
        /* Teal, brightness tracks the breath. Kept well below full scale. */
        const unsigned v = 2u + aura_level(&s_aura, now) * 48u / 1000u;
        leds_all(0, (uint8_t)v, (uint8_t)(v * 3u / 4u));
    } else {
        /* Dim, slow triangle glow. */
        const uint32_t t = now % IDLE_GLOW_MS;
        const uint32_t half = IDLE_GLOW_MS / 2u;
        const unsigned tri = (unsigned)(t < half ? t : IDLE_GLOW_MS - t) * 1000u / half;
        const unsigned v = 1u + tri * 6u / 1000u;
        leds_all(0, (uint8_t)v, (uint8_t)v);
    }
}

/* ---- Commands ---- */

static void enter_state_visuals(aura_state_t prev, aura_phase_t *shown_phase) {
    if (s_aura.state == prev && prev == AURA_STATE_IDLE) return;
    if (s_aura.state == AURA_STATE_IDLE) {
        screen_idle();
    } else if (prev == AURA_STATE_IDLE) {
        screen_intervene_start();
        *shown_phase = (aura_phase_t)-1;   /* force a label redraw */
    } else {
        *shown_phase = (aura_phase_t)-1;   /* restart: cycle starts over */
    }
}

static void handle_line(const char *line, uint32_t now, aura_phase_t *shown_phase) {
    aura_cmd_t cmd;
    aura_parse(line, &cmd);
    const aura_state_t prev = s_aura.state;
    aura_apply(&s_aura, &cmd, now);
    if (cmd.kind == AURA_CMD_INTERVENE || cmd.kind == AURA_CMD_IDLE)
        enter_state_visuals(prev, shown_phase);

    char reply[96];
    aura_reply(reply, sizeof reply, &s_aura, &cmd);
    DIAG("%s", reply);
    /* Audio (cmd.clip) is wired in Phase 4. */
}

int main(void) {
    board_init();
    aura_init(&s_aura);

    s_bg = st7789_rgb565(0, 0, 0);
    s_fg = st7789_rgb565(230, 240, 240);
    s_accent = st7789_rgb565(0, 190, 160);
    s_track = st7789_rgb565(20, 40, 40);

    /* Bounded: the display CPU has no watchdog to recover a spin here.
       Same shape as apps/bench/display. */
    st7789_init_begin();
    const absolute_time_t lcd_deadline = make_timeout_time_ms(500);
    while (!st7789_ready() && !time_reached(lcd_deadline)) st7789_init_step();
    s_lcd_ready = st7789_ready();
    if (s_lcd_ready) board_backlight(255);
    screen_idle();

    const bool leds_ok = ws2812_init(pio0, 0);

    static char line_buf[160];
    unsigned line_len = 0u;
    aura_phase_t shown_phase = (aura_phase_t)-1;
    absolute_time_t next_led = make_timeout_time_ms(LED_FRAME_MS);
    absolute_time_t next_bar = make_timeout_time_ms(BAR_FRAME_MS);
    absolute_time_t next_beat = make_timeout_time_ms(1000);

    while (true) {
        const uint32_t now = to_ms_since_boot(get_absolute_time());
        const fwog_power_t power = fwog_power_poll(now);

        /* Host commands. */
        int c;
        while ((c = getchar_timeout_us(0)) != PICO_ERROR_TIMEOUT) {
            if (c == '\r' || c == '\n') {
                if (line_len > 0u) {
                    line_buf[line_len] = '\0';
                    handle_line(line_buf, now, &shown_phase);
                    line_len = 0u;
                }
            } else if (line_len < sizeof(line_buf) - 1u) {
                line_buf[line_len++] = (char)c;
            }
        }

        /* Green dismisses a running intervention from the device itself. */
        if (s_aura.state == AURA_STATE_INTERVENING &&
            (power.buttons.released & FWOG_BTN_BIT(FWOG_BTN_GREEN))) {
            aura_init(&s_aura);
            screen_idle();
            DIAG("# dismissed by button\n");
        }

        if (aura_tick(&s_aura, now)) {
            screen_idle();
            DIAG("# intervention finished\n");
        }

        if (s_aura.state == AURA_STATE_INTERVENING) {
            const aura_phase_t p = aura_phase(&s_aura, now);
            if (p != shown_phase) {
                shown_phase = p;
                screen_phase(p);
            }
            if (time_reached(next_bar)) {
                next_bar = make_timeout_time_ms(BAR_FRAME_MS);
                screen_bar(aura_level(&s_aura, now));
            }
        }

        /* The red-hold countdown owns the LED bar while it runs. */
        if (leds_ok && !power.armed && time_reached(next_led)) {
            next_led = make_timeout_time_ms(LED_FRAME_MS);
            leds_frame(now);
        }

        if (time_reached(next_beat)) {
            next_beat = make_timeout_time_ms(HEARTBEAT_MS);
            DIAG("# alive state=%s lcd=%s\n", aura_state_name(s_aura.state),
                 s_lcd_ready ? "ok" : "FAILED");
        }
        sleep_ms(1);
    }
}
