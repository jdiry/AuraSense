/* AuraSense device protocol (README §4.2) and intervention state machine.
 *
 * Pure C: no SDK, no hardware. display/main.c owns the I/O; this file owns
 * every decision, so it is host-tested by tests/test_aura_cmd.c.
 *
 * Wire format: one JSON object per line in, one per line out.
 *   {"cmd":"ping"}
 *   {"cmd":"idle"}
 *   {"cmd":"intervene","pattern":"box","phase_ms":4000,"duration_s":120,"clip":"calm_01.wav"}
 * Reply: {"ok":true,"state":"idle"|"intervening"}
 *    or: {"ok":false,"error":"<reason>","state":...}
 *
 * The parser is deliberately not a general JSON parser: it finds known keys
 * in a flat object. Nested objects and escaped quotes are not supported. */
#ifndef AURA_CMD_H
#define AURA_CMD_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define AURA_DEFAULT_PHASE_MS    4000u
#define AURA_DEFAULT_DURATION_S  120u
#define AURA_MIN_PHASE_MS        500u
#define AURA_MAX_PHASE_MS        20000u
#define AURA_MAX_DURATION_S      3600u
#define AURA_CLIP_MAX            32u

typedef enum {
    AURA_CMD_INVALID = 0,
    AURA_CMD_PING,
    AURA_CMD_IDLE,
    AURA_CMD_INTERVENE,
} aura_cmd_kind_t;

typedef struct {
    aura_cmd_kind_t kind;
    uint32_t phase_ms;
    uint32_t duration_s;
    char clip[AURA_CLIP_MAX];      /* empty when absent */
    const char *error;             /* set when kind == AURA_CMD_INVALID */
} aura_cmd_t;

typedef enum {
    AURA_STATE_IDLE = 0,
    AURA_STATE_INTERVENING,
} aura_state_t;

/* Box breathing: four equal phases. */
typedef enum {
    AURA_PHASE_IN = 0,
    AURA_PHASE_HOLD_FULL,
    AURA_PHASE_OUT,
    AURA_PHASE_HOLD_EMPTY,
} aura_phase_t;

typedef struct {
    aura_state_t state;
    uint32_t start_ms;
    uint32_t phase_ms;
    uint32_t duration_ms;
    char clip[AURA_CLIP_MAX];
} aura_t;

void aura_init(aura_t *a);

/* Parse one line (no trailing newline needed). Never fails to fill `out`. */
void aura_parse(const char *line, aura_cmd_t *out);

/* Apply a parsed command. An intervene while intervening restarts the timer;
 * it never stacks. Returns true when the command was accepted. */
bool aura_apply(aura_t *a, const aura_cmd_t *cmd, uint32_t now_ms);

/* Advance time. Returns true on the call that ends an intervention because
 * duration_s elapsed. Wrap-safe for the 49-day ms counter. */
bool aura_tick(aura_t *a, uint32_t now_ms);

/* Where in the breathing cycle we are. Only meaningful while intervening. */
aura_phase_t aura_phase(const aura_t *a, uint32_t now_ms);

/* Lung "fullness", 0..1000: ramps up during IN, 1000 during HOLD_FULL, ramps
 * down during OUT, 0 during HOLD_EMPTY. 0 when idle. Drives LEDs and screen. */
unsigned aura_level(const aura_t *a, uint32_t now_ms);

const char *aura_state_name(aura_state_t s);
const char *aura_phase_label(aura_phase_t p);

/* Format the reply line for `cmd` into `buf` (with trailing '\n').
 * Returns the length written, as snprintf does. */
int aura_reply(char *buf, size_t n, const aura_t *a, const aura_cmd_t *cmd);

#endif
