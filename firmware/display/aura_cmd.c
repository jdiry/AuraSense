#include "aura_cmd.h"

#include <stdio.h>
#include <string.h>

/* ---- Minimal flat-JSON key lookup ---- */

/* Pointer to the first character of the value for "key", or NULL. */
static const char *find_value(const char *s, const char *key) {
    const size_t klen = strlen(key);
    for (const char *p = strchr(s, '"'); p; p = strchr(p + 1, '"')) {
        if (strncmp(p + 1, key, klen) != 0 || p[1 + klen] != '"') continue;
        const char *v = p + 2 + klen;
        while (*v == ' ' || *v == '\t') v++;
        if (*v != ':') continue;          /* matched a value, not a key */
        v++;
        while (*v == ' ' || *v == '\t') v++;
        return v;
    }
    return NULL;
}

/* 1 = found, 0 = absent, -1 = present but not a string or too long. */
static int get_string(const char *s, const char *key, char *out, size_t n) {
    const char *v = find_value(s, key);
    if (!v) return 0;
    if (*v != '"') return -1;
    v++;
    size_t i = 0;
    while (v[i] && v[i] != '"') {
        if (i + 1 >= n) return -1;
        out[i] = v[i];
        i++;
    }
    if (v[i] != '"') return -1;
    out[i] = '\0';
    return 1;
}

/* 1 = found, 0 = absent, -1 = present but not a non-negative integer. */
static int get_uint(const char *s, const char *key, uint32_t *out) {
    const char *v = find_value(s, key);
    if (!v) return 0;
    if (*v < '0' || *v > '9') return -1;
    uint64_t x = 0;
    while (*v >= '0' && *v <= '9') {
        x = x * 10u + (uint64_t)(*v - '0');
        if (x > 0xFFFFFFFFu) return -1;
        v++;
    }
    *out = (uint32_t)x;
    return 1;
}

static void invalid(aura_cmd_t *out, const char *why) {
    out->kind = AURA_CMD_INVALID;
    out->error = why;
}

void aura_parse(const char *line, aura_cmd_t *out) {
    memset(out, 0, sizeof *out);
    out->phase_ms = AURA_DEFAULT_PHASE_MS;
    out->duration_s = AURA_DEFAULT_DURATION_S;

    char cmd[16];
    const int c = get_string(line, "cmd", cmd, sizeof cmd);
    if (c == 0) { invalid(out, "missing cmd"); return; }
    if (c < 0)  { invalid(out, "bad cmd"); return; }

    if (strcmp(cmd, "ping") == 0) { out->kind = AURA_CMD_PING; return; }
    if (strcmp(cmd, "idle") == 0) { out->kind = AURA_CMD_IDLE; return; }
    if (strcmp(cmd, "intervene") != 0) { invalid(out, "unknown cmd"); return; }

    char pattern[16];
    const int p = get_string(line, "pattern", pattern, sizeof pattern);
    if (p < 0 || (p > 0 && strcmp(pattern, "box") != 0)) {
        invalid(out, "unsupported pattern");
        return;
    }
    if (get_uint(line, "phase_ms", &out->phase_ms) < 0 ||
        out->phase_ms < AURA_MIN_PHASE_MS || out->phase_ms > AURA_MAX_PHASE_MS) {
        invalid(out, "bad phase_ms");
        return;
    }
    if (get_uint(line, "duration_s", &out->duration_s) < 0 ||
        out->duration_s == 0u || out->duration_s > AURA_MAX_DURATION_S) {
        invalid(out, "bad duration_s");
        return;
    }
    if (get_string(line, "clip", out->clip, sizeof out->clip) < 0) {
        invalid(out, "bad clip");
        return;
    }
    out->kind = AURA_CMD_INTERVENE;
}

/* ---- State machine ---- */

void aura_init(aura_t *a) {
    memset(a, 0, sizeof *a);
    a->state = AURA_STATE_IDLE;
}

bool aura_apply(aura_t *a, const aura_cmd_t *cmd, uint32_t now_ms) {
    switch (cmd->kind) {
    case AURA_CMD_PING:
        return true;
    case AURA_CMD_IDLE:
        aura_init(a);
        return true;
    case AURA_CMD_INTERVENE:
        /* Restart, never stack: overwrite the one running timer. */
        a->state = AURA_STATE_INTERVENING;
        a->start_ms = now_ms;
        a->phase_ms = cmd->phase_ms;
        a->duration_ms = cmd->duration_s * 1000u;
        memcpy(a->clip, cmd->clip, sizeof a->clip);
        return true;
    default:
        return false;
    }
}

bool aura_tick(aura_t *a, uint32_t now_ms) {
    if (a->state != AURA_STATE_INTERVENING) return false;
    if ((uint32_t)(now_ms - a->start_ms) < a->duration_ms) return false;
    aura_init(a);
    return true;
}

aura_phase_t aura_phase(const aura_t *a, uint32_t now_ms) {
    if (a->state != AURA_STATE_INTERVENING || a->phase_ms == 0u) return AURA_PHASE_HOLD_EMPTY;
    const uint32_t t = (uint32_t)(now_ms - a->start_ms) % (4u * a->phase_ms);
    return (aura_phase_t)(t / a->phase_ms);
}

unsigned aura_level(const aura_t *a, uint32_t now_ms) {
    if (a->state != AURA_STATE_INTERVENING || a->phase_ms == 0u) return 0u;
    const uint32_t t = (uint32_t)(now_ms - a->start_ms) % (4u * a->phase_ms);
    const uint32_t in_phase = t % a->phase_ms;
    const unsigned ramp = (unsigned)((uint64_t)in_phase * 1000u / a->phase_ms);
    switch ((aura_phase_t)(t / a->phase_ms)) {
    case AURA_PHASE_IN:        return ramp;
    case AURA_PHASE_HOLD_FULL: return 1000u;
    case AURA_PHASE_OUT:       return 1000u - ramp;
    default:                   return 0u;
    }
}

const char *aura_state_name(aura_state_t s) {
    return s == AURA_STATE_INTERVENING ? "intervening" : "idle";
}

const char *aura_phase_label(aura_phase_t p) {
    switch (p) {
    case AURA_PHASE_IN:   return "Breathe in";
    case AURA_PHASE_OUT:  return "Breathe out";
    default:              return "Hold";
    }
}

int aura_reply(char *buf, size_t n, const aura_t *a, const aura_cmd_t *cmd) {
    if (cmd->kind == AURA_CMD_INVALID) {
        return snprintf(buf, n, "{\"ok\":false,\"error\":\"%s\",\"state\":\"%s\"}\n",
                        cmd->error ? cmd->error : "invalid",
                        aura_state_name(a->state));
    }
    return snprintf(buf, n, "{\"ok\":true,\"state\":\"%s\"}\n",
                    aura_state_name(a->state));
}
