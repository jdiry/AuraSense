/* Copy to secrets.h (git-ignored) and fill in. Never commit secrets.h. */
#ifndef AURA_SECRETS_H
#define AURA_SECRETS_H

/* 2.4 GHz network only: the ESP32-C6 has no 5 GHz radio. Open networks and
 * WPA2/WPA3 Personal work. Enterprise (eduroam-style) logins and networks
 * behind a captive-portal sign-in page do not.
 * Leave the password "" for an open network (no password). */
#define AURA_WIFI_SSID     "Alex’s Phone"
#define AURA_WIFI_PASSWORD "fordsync"

/* Shared secret the backend sends as "Authorization: Bearer <token>".
 * Set the same value as DEVICE_TOKEN in the root .env. Generate one with:
 *   python3 -c "import secrets; print(secrets.token_urlsafe(24))" */
#define AURA_API_TOKEN     "B9UWzpBvyCgkrA-QAtWTxy-4YDdqfWk5"

#endif
