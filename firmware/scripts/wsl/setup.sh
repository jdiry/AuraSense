#!/usr/bin/env bash
# =============================================================================
# AuraSense firmware -- one-time setup for WINDOWS + WSL
# =============================================================================
#
# Run from anywhere inside your WSL terminal:
#     firmware/scripts/wsl/setup.sh
# Then build, test and flash with:
#     firmware/scripts/wsl/flash.sh
#
# ASSUMPTIONS -- read before running
# ----------------------------------
# * Windows 10/11 with WSL 2 running Ubuntu or Debian on an x86_64 PC. Other
#   distros need apt swapped for their package manager.
# * The AuraSense repo is cloned INSIDE WSL (e.g. ~/AuraSense), not under
#   /mnt/c. Builds on /mnt/c work, but they are many times slower.
# * You can use sudo. It is only needed if apt packages are missing.
# * Internet access. The first run downloads about 1 GB (Pico SDK, Arm GCC,
#   CMake, Ninja, picotool) and takes 5-15 minutes. Later runs skip whatever
#   is already installed, so it is safe to re-run.
# * Building happens in WSL; FLASHING happens through WINDOWS Python. WSL
#   cannot see USB COM ports or the RPI-RP2 drive, so flash.sh calls py.exe.
#   This script installs Python on the Windows side (with winget) if py.exe is
#   missing, then installs pyserial for it.
# * No board is needed for setup.
#
# WHAT IT CHANGES
# ---------------
# * apt packages: git curl unzip xz-utils python3 gcc g++ make
# * ~/.pico-sdk/  -- the same layout the Raspberry Pi Pico VS Code extension
#   uses, and what firmware/CMakePresets.json points at. If you already have
#   the extension installed with these versions, nothing is downloaded.
# * The firmware/wiliOGbsp git submodule is checked out.
# * Windows: Python 3.13 (only if py.exe is missing) and pyserial (pip --user).
# * Nothing is added to your ~/.bashrc.
#
# VERSIONS are pinned to match firmware/CMakePresets.json. Change both together.
# =============================================================================
set -euo pipefail

SDK_VER=2.3.0
TOOLCHAIN_DIR=15_2_Rel1          # folder name the presets expect
TOOLCHAIN_VER=15.2.rel1          # Arm's name for the same release
NINJA_VER=1.13.2
CMAKE_VER=4.3.4
PICOTOOL_VER=2.3.0
TOOLS_RELEASE=v2.3.0-1           # github.com/raspberrypi/pico-sdk-tools release

PICO="$HOME/.pico-sdk"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
fw="$repo/firmware"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m  %s\n' "$*"; }
warn() { printf '    \033[33mwarning:\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# fetch URL DEST_DIR -- download an archive and unpack it into DEST_DIR,
# dropping the archive's single top-level folder if it has one.
fetch() {
    local url="$1" dest="$2" tmp
    # A folder here means an earlier install broke partway. Don't delete it
    # on the user's behalf.
    [ ! -e "$dest" ] || die "$dest exists but looks incomplete. Delete it and re-run."
    tmp="$(mktemp -d)"
    echo "    downloading $url"
    curl -fL --retry 3 --progress-bar -o "$tmp/archive" "$url"
    mkdir -p "$tmp/x"
    case "$url" in
        *.zip) unzip -q "$tmp/archive" -d "$tmp/x" ;;
        *)     tar -xf "$tmp/archive" -C "$tmp/x" ;;
    esac
    rm -f "$tmp/x/.keep"
    local top=("$tmp/x"/*)
    if [ ${#top[@]} -eq 1 ] && [ -d "${top[0]}" ]; then
        mkdir -p "$(dirname "$dest")"; mv "${top[0]}" "$dest"
    else
        mkdir -p "$dest"; mv "$tmp/x"/* "$dest"/
    fi
    rm -rf "$tmp"
}

# ---------------------------------------------------------------------------
say "Checking the environment"
grep -qi microsoft /proc/version 2>/dev/null \
    || die "this is not WSL. On plain Windows use firmware\\scripts\\windows\\setup.ps1."
[ "$(uname -m)" = x86_64 ] || die "only x86_64 is supported (found $(uname -m))."
command -v apt-get >/dev/null || die "apt-get not found; install the packages listed at the top by hand."
case "$repo" in /mnt/*) warn "repo is on the Windows drive ($repo); builds will be slow." ;; esac
ok "WSL on x86_64, repo at $repo"

# ---------------------------------------------------------------------------
say "Linux packages"
pkgs=(git curl unzip xz-utils python3 gcc g++ make)
missing=()
for p in "${pkgs[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
if [ ${#missing[@]} -gt 0 ]; then
    echo "    installing: ${missing[*]} (sudo will ask for your password)"
    sudo apt-get update -qq
    sudo apt-get install -y "${missing[@]}"
fi
ok "${pkgs[*]}"

# ---------------------------------------------------------------------------
say "BSP submodule (firmware/wiliOGbsp)"
git -C "$repo" submodule update --init firmware/wiliOGbsp
ok "$(git -C "$fw/wiliOGbsp" log --oneline -1)"

# ---------------------------------------------------------------------------
say "Pico toolchain in $PICO"
if [ -f "$PICO/sdk/$SDK_VER/pico_sdk_init.cmake" ]; then
    ok "Pico SDK $SDK_VER (already installed)"
else
    git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$SDK_VER" \
        https://github.com/raspberrypi/pico-sdk.git "$PICO/sdk/$SDK_VER"
    git -C "$PICO/sdk/$SDK_VER" submodule update --init --depth 1 --quiet
    ok "Pico SDK $SDK_VER"
fi

if [ -x "$PICO/toolchain/$TOOLCHAIN_DIR/bin/arm-none-eabi-gcc" ]; then
    ok "Arm GCC $TOOLCHAIN_VER (already installed)"
else
    fetch "https://developer.arm.com/-/media/Files/downloads/gnu/$TOOLCHAIN_VER/binrel/arm-gnu-toolchain-$TOOLCHAIN_VER-x86_64-arm-none-eabi.tar.xz" \
        "$PICO/toolchain/$TOOLCHAIN_DIR"
    ok "Arm GCC $TOOLCHAIN_VER"
fi

if [ -x "$PICO/ninja/v$NINJA_VER/ninja" ]; then
    ok "Ninja $NINJA_VER (already installed)"
else
    fetch "https://github.com/ninja-build/ninja/releases/download/v$NINJA_VER/ninja-linux.zip" \
        "$PICO/ninja/v$NINJA_VER"
    chmod +x "$PICO/ninja/v$NINJA_VER/ninja"
    ok "Ninja $NINJA_VER"
fi

if [ -x "$PICO/cmake/v$CMAKE_VER/bin/cmake" ]; then
    ok "CMake $CMAKE_VER (already installed)"
else
    fetch "https://github.com/Kitware/CMake/releases/download/v$CMAKE_VER/cmake-$CMAKE_VER-linux-x86_64.tar.gz" \
        "$PICO/cmake/v$CMAKE_VER"
    ok "CMake $CMAKE_VER"
fi

# Prebuilt picotool and pioasm. Without them, every fresh build/ folder
# compiles both from source, which is slow.
if [ -x "$PICO/picotool/$PICOTOOL_VER/picotool/picotool" ]; then
    ok "picotool $PICOTOOL_VER (already installed)"
else
    fetch "https://github.com/raspberrypi/pico-sdk-tools/releases/download/$TOOLS_RELEASE/picotool-$PICOTOOL_VER-x86_64-lin.tar.gz" \
        "$PICO/picotool/$PICOTOOL_VER/picotool"
    ok "picotool $PICOTOOL_VER"
fi
if [ -x "$PICO/tools/$SDK_VER/pioasm/pioasm" ]; then
    ok "pioasm $SDK_VER (already installed)"
else
    fetch "https://github.com/raspberrypi/pico-sdk-tools/releases/download/$TOOLS_RELEASE/pico-sdk-tools-$SDK_VER-x86_64-lin.tar.gz" \
        "$PICO/tools/$SDK_VER/pioasm"
    ok "pioasm $SDK_VER"
fi

# ---------------------------------------------------------------------------
say "Windows Python (used for flashing)"
command -v winget.exe >/dev/null || command -v py.exe >/dev/null \
    || die "neither py.exe nor winget.exe is reachable from WSL. Check that WSL interop is enabled (/etc/wsl.conf [interop] enabled=true)."
if ! command -v py.exe >/dev/null; then
    echo "    py.exe not found; installing Python 3.13 on Windows with winget"
    winget.exe install --id Python.Python.3.13 -e --silent \
        --accept-package-agreements --accept-source-agreements
    hash -r
    command -v py.exe >/dev/null \
        || die "Python was installed but py.exe is not on PATH yet. Close and reopen the WSL terminal, then re-run this script."
fi
if py.exe -c "import serial" 2>/dev/null; then
    ok "$(py.exe --version), pyserial already installed"
else
    py.exe -m pip install --user --quiet pyserial
    ok "$(py.exe --version), pyserial installed"
fi

# ---------------------------------------------------------------------------
say "Done"
cat <<EOF
    Everything is installed. Next, with the board plugged in and powered on:

        firmware/scripts/wsl/flash.sh            # test, build, flash, verify
        firmware/scripts/wsl/flash.sh --no-flash # test and build only (no board)
EOF
