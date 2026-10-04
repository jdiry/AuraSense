#!/usr/bin/env bash
# =============================================================================
# AuraSense firmware -- test, build and flash the FREE-WILi OG from WSL
# =============================================================================
#
# Usage (from anywhere inside your WSL terminal):
#     firmware/scripts/wsl/flash.sh               test, build, flash, verify
#     firmware/scripts/wsl/flash.sh --no-flash    test and build only
#     firmware/scripts/wsl/flash.sh --skip-tests  skip the host unit tests
#     firmware/scripts/wsl/flash.sh --port COM5   touch this port instead of
#                                                 auto-detecting the main CPU
#
# ASSUMPTIONS -- read before running
# ----------------------------------
# * firmware/scripts/wsl/setup.sh has completed once.
# * The FREE-WILi OG is plugged into the Windows PC over USB and powered ON.
#   Both CPUs appear as COM ports: display = 093C:2055, main = 093C:2054.
#   If the board is off, reconnect USB or hold GRAY until it wakes.
# * No CPU is in BOOTSEL (no RPI-RP2 drive in Windows Explorer). The script
#   stops if it finds one, because it can't tell which CPU the drive is. A
#   main-CPU image written to the display CPU is harmful.
# * Close any serial monitor (fw console, PuTTY, Arduino, ...) holding the
#   board's COM ports. The flasher must open the main CPU's port.
#
# WHAT IT DOES
# ------------
#   1. Runs the host unit tests (firmware/tests/run.sh). No board needed.
#   2. Configures (first time only) and builds AuraSense_main. The display
#      image is embedded inside it.
#   3. Checks that Windows sees both CPUs and no BOOTSEL drive.
#   4. Flashes ONLY AuraSense_main. It reboots the main CPU into BOOTSEL over
#      USB (a 1200-baud touch; no button) and copies the .uf2. On boot, main
#      sends the display its image. Never flash a *_display.uf2 by hand: the
#      display CPU has no BOOTSEL button and will drop off USB.
#   5. Waits for both CPUs to come back on USB.
#
# AFTER FLASHING, CHECK BY HAND
# -----------------------------
# * Watch the board for 30 s. It should NOT keep rebooting itself. A reboot
#   loop looks like the screen blanking or restarting and Windows playing
#   the USB disconnect/connect sound every ~8 s. It means the main loop is
#   missing board_watchdog_kick().
# * Hold RED for 6 s: the LEDs fill red one at a time. If they don't, the
#   display loop is missing fwog_power_poll(). With USB plugged in the board
#   STAYS ON (USB powers it); the red hold disconnects the battery, so it
#   goes dark when you then UNPLUG USB. Hold GRAY 2-3 s to turn it back on.
#   (Only meaningful with a battery fitted: without one, unplugging always
#   turns it off.)
# =============================================================================
set -euo pipefail

APP=AuraSense_main
PICO="$HOME/.pico-sdk"
CMAKE="$PICO/cmake/v4.3.4/bin/cmake"     # keep in step with setup.sh
PRESET=target-posix
BOOT_WAIT=20                              # seconds to wait for both CPUs

here="$(cd "$(dirname "$0")" && pwd)"
fw="$(cd "$here/../.." && pwd)"

do_tests=1; do_flash=1; port=()
while [ $# -gt 0 ]; do
    case "$1" in
        --no-flash)   do_flash=0 ;;
        --skip-tests) do_tests=0 ;;
        --port)       shift; port=(--port "${1:?--port needs a value, e.g. COM5}") ;;
        -h|--help)    awk 'NR>1 && !/^#/{exit} NR>1{sub(/^# ?/,""); print}' "$0"; exit 0 ;;
        *)            echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
    shift
done

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
winpy() { py.exe "$@"; }
status() { winpy "$(wslpath -w "$here/../board_status.py")" "$@"; }

[ -x "$CMAKE" ] || die "CMake not found at $CMAKE. Run firmware/scripts/wsl/setup.sh first."
command -v py.exe >/dev/null || die "py.exe not reachable. Run firmware/scripts/wsl/setup.sh first."

# ---------------------------------------------------------------------------
if [ $do_tests = 1 ]; then
    say "1/5 Host unit tests"
    "$fw/tests/run.sh"
else
    say "1/5 Host unit tests -- SKIPPED (--skip-tests)"
fi

# ---------------------------------------------------------------------------
say "2/5 Build $APP"
cd "$fw"
if [ ! -f build/CMakeCache.txt ]; then
    "$CMAKE" --preset "$PRESET" \
        -Dpicotool_DIR="$PICO/picotool/2.3.0/picotool" \
        -Dpioasm_DIR="$PICO/tools/2.3.0/pioasm"
fi
"$CMAKE" --build --preset "$PRESET" --target "$APP"
uf2="$fw/build/$APP.uf2"
[ -f "$uf2" ] || die "build finished but $uf2 is missing."

if [ $do_flash = 0 ]; then
    say "Done. Built $uf2 (not flashed: --no-flash)"
    exit 0
fi

# ---------------------------------------------------------------------------
say "3/5 Board check"
status --require-both --require-no-bootsel \
    || die "fix the board state above, then re-run. (--no-flash builds without a board.)"

# ---------------------------------------------------------------------------
say "4/5 Flash $APP"
winpy "$(wslpath -w "$fw/tools/fw.py")" flash "$APP" --uf2 "$(wslpath -w "$uf2")" "${port[@]}"

# ---------------------------------------------------------------------------
say "5/5 Waiting up to ${BOOT_WAIT}s for both CPUs to come back"
for _ in $(seq "$BOOT_WAIT"); do
    sleep 1
    if status --require-both >/dev/null 2>&1; then
        status
        say "Done. Flashed and both CPUs are running."
        echo "    Now check by hand:"
        echo "      1. Watch for 30 s: the board should NOT keep rebooting (screen blanking, USB sounds every ~8 s)."
        echo "      2. Hold RED for 6 s: the LEDs fill red. Then unplug USB: the board should go dark. Hold GRAY 2-3 s to turn it back on."
        exit 0
    fi
done
status || true
die "both CPUs did not come back within ${BOOT_WAIT}s. Reconnect USB; if they still don't show up, read the main CPU's log with: py.exe \"\$(wslpath -w $fw/tools/fw.py)\" console"
