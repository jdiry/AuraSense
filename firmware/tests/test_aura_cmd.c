/* Host test for display/aura_cmd.c. No SDK, no board.
 *   ./tests/run.sh          (from firmware/)  */
#include "aura_cmd.h"

#include <stdio.h>
#include <string.h>

static int failures;

#define CHECK(cond) do { \
    if (!(cond)) { printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); failures++; } \
} while (0)

static void test_parse_ping_idle(void) {
    aura_cmd_t c;
    aura_parse("{\"cmd\":\"ping\"}", &c);
    CHECK(c.kind == AURA_CMD_PING);
    aura_parse("{ \"cmd\" : \"idle\" }", &c);
    CHECK(c.kind == AURA_CMD_IDLE);
}

static void test_parse_intervene_full(void) {
    aura_cmd_t c;
    aura_parse("{\"cmd\":\"intervene\",\"pattern\":\"box\",\"phase_ms\":4000,"
               "\"duration_s\":120,\"clip\":\"calm_01.wav\"}", &c);
    CHECK(c.kind == AURA_CMD_INTERVENE);
    CHECK(c.phase_ms == 4000u);
    CHECK(c.duration_s == 120u);
    CHECK(strcmp(c.clip, "calm_01.wav") == 0);
}

static void test_parse_intervene_defaults(void) {
    aura_cmd_t c;
    aura_parse("{\"cmd\":\"intervene\"}", &c);
    CHECK(c.kind == AURA_CMD_INTERVENE);
    CHECK(c.phase_ms == AURA_DEFAULT_PHASE_MS);
    CHECK(c.duration_s == AURA_DEFAULT_DURATION_S);
    CHECK(c.clip[0] == '\0');
}

static void test_parse_errors(void) {
    aura_cmd_t c;
    aura_parse("hello", &c);
    CHECK(c.kind == AURA_CMD_INVALID && strcmp(c.error, "missing cmd") == 0);
    aura_parse("{\"cmd\":\"dance\"}", &c);
    CHECK(c.kind == AURA_CMD_INVALID && strcmp(c.error, "unknown cmd") == 0);
    aura_parse("{\"cmd\":\"intervene\",\"pattern\":\"478\"}", &c);
    CHECK(c.kind == AURA_CMD_INVALID && strcmp(c.error, "unsupported pattern") == 0);
    aura_parse("{\"cmd\":\"intervene\",\"phase_ms\":-5}", &c);
    CHECK(c.kind == AURA_CMD_INVALID && strcmp(c.error, "bad phase_ms") == 0);
    aura_parse("{\"cmd\":\"intervene\",\"phase_ms\":10}", &c);
    CHECK(c.kind == AURA_CMD_INVALID);
    aura_parse("{\"cmd\":\"intervene\",\"duration_s\":0}", &c);
    CHECK(c.kind == AURA_CMD_INVALID && strcmp(c.error, "bad duration_s") == 0);
    aura_parse("{\"cmd\":\"intervene\",\"clip\":\"this_name_is_far_too_long_for_the_buffer.wav\"}", &c);
    CHECK(c.kind == AURA_CMD_INVALID && strcmp(c.error, "bad clip") == 0);
}

static void test_key_inside_value_not_matched(void) {
    aura_cmd_t c;
    /* "cmd" appears as a value first; the real key comes later. */
    aura_parse("{\"clip\":\"cmd\",\"cmd\":\"ping\"}", &c);
    CHECK(c.kind == AURA_CMD_PING);
}

static void intervene(aura_t *a, uint32_t now, uint32_t dur_s) {
    aura_cmd_t c;
    char line[96];
    snprintf(line, sizeof line, "{\"cmd\":\"intervene\",\"duration_s\":%u}", (unsigned)dur_s);
    aura_parse(line, &c);
    CHECK(aura_apply(a, &c, now));
}

static void test_state_and_expiry(void) {
    aura_t a;
    aura_init(&a);
    CHECK(a.state == AURA_STATE_IDLE);
    intervene(&a, 1000, 10);
    CHECK(a.state == AURA_STATE_INTERVENING);
    CHECK(!aura_tick(&a, 10999));
    CHECK(aura_tick(&a, 11000));
    CHECK(a.state == AURA_STATE_IDLE);
    CHECK(!aura_tick(&a, 12000));       /* fires once only */
}

static void test_restart_does_not_stack(void) {
    aura_t a;
    aura_init(&a);
    intervene(&a, 0, 10);
    intervene(&a, 5000, 10);            /* restart at t=5 s */
    CHECK(!aura_tick(&a, 10000));       /* first timer would have ended here */
    CHECK(aura_tick(&a, 15000));        /* restarted timer ends here */
}

static void test_idle_cancels(void) {
    aura_t a;
    aura_cmd_t c;
    aura_init(&a);
    intervene(&a, 0, 60);
    aura_parse("{\"cmd\":\"idle\"}", &c);
    CHECK(aura_apply(&a, &c, 100));
    CHECK(a.state == AURA_STATE_IDLE);
}

static void test_wraparound(void) {
    aura_t a;
    aura_init(&a);
    intervene(&a, 0xFFFFF000u, 10);     /* ms counter wraps mid-intervention */
    CHECK(!aura_tick(&a, 0x00000100u));
    CHECK(aura_tick(&a, 0xFFFFF000u + 10000u));
}

static void test_breathing_cycle(void) {
    aura_t a;
    aura_init(&a);
    CHECK(aura_level(&a, 0) == 0u);
    intervene(&a, 0, 120);
    CHECK(aura_phase(&a, 0) == AURA_PHASE_IN && aura_level(&a, 0) == 0u);
    CHECK(aura_level(&a, 2000) == 500u);
    CHECK(aura_phase(&a, 4000) == AURA_PHASE_HOLD_FULL && aura_level(&a, 5000) == 1000u);
    CHECK(aura_phase(&a, 8000) == AURA_PHASE_OUT && aura_level(&a, 10000) == 500u);
    CHECK(aura_phase(&a, 12000) == AURA_PHASE_HOLD_EMPTY && aura_level(&a, 13000) == 0u);
    CHECK(aura_phase(&a, 16000) == AURA_PHASE_IN);   /* cycle repeats */
}

static void test_reply(void) {
    aura_t a;
    aura_cmd_t c;
    char buf[96];
    aura_init(&a);
    aura_parse("{\"cmd\":\"ping\"}", &c);
    aura_reply(buf, sizeof buf, &a, &c);
    CHECK(strcmp(buf, "{\"ok\":true,\"state\":\"idle\"}\n") == 0);
    aura_parse("{\"cmd\":\"nope\"}", &c);
    aura_reply(buf, sizeof buf, &a, &c);
    CHECK(strcmp(buf, "{\"ok\":false,\"error\":\"unknown cmd\",\"state\":\"idle\"}\n") == 0);
}

int main(void) {
    test_parse_ping_idle();
    test_parse_intervene_full();
    test_parse_intervene_defaults();
    test_parse_errors();
    test_key_inside_value_not_matched();
    test_state_and_expiry();
    test_restart_does_not_stack();
    test_idle_cancels();
    test_wraparound();
    test_breathing_cycle();
    test_reply();
    if (failures) {
        printf("%d check(s) FAILED\n", failures);
        return 1;
    }
    printf("test_aura_cmd: all checks passed\n");
    return 0;
}
