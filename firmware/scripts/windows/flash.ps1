# =============================================================================
# AuraSense firmware -- test, build and flash the FREE-WILi OG on WINDOWS
# =============================================================================
#
# Usage (PowerShell, from the AuraSense repo folder):
#     powershell -ExecutionPolicy Bypass -File firmware\scripts\windows\flash.ps1
#         ... -NoFlash      test and build only (no board needed)
#         ... -SkipTests    skip the host unit tests
#         ... -Port COM5    touch this port instead of auto-detecting main
#
# ASSUMPTIONS -- read before running
# ----------------------------------
# * firmware\scripts\windows\setup.ps1 has completed once.
# * The FREE-WILi OG is plugged in over USB and powered ON. Both CPUs appear
#   as COM ports: display = 093C:2055, main = 093C:2054. If the board is off,
#   reconnect USB or hold GRAY until it wakes.
# * No CPU is in BOOTSEL (no RPI-RP2 drive in Explorer). The script stops if
#   it finds one, because it can't tell which CPU the drive is. A main-CPU
#   image written to the display CPU is harmful.
# * Close any serial monitor (fw console, PuTTY, Arduino, ...) holding the
#   board's COM ports. The flasher must open the main CPU's port.
#
# WHAT IT DOES
# ------------
#   1. Runs the host unit tests (the same checks as firmware/tests/run.sh,
#      compiled with gcc). No board needed.
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
param(
    [switch]$NoFlash,
    [switch]$SkipTests,
    [string]$Port
)
$ErrorActionPreference = 'Stop'

$App      = 'AuraSense_main'
$Pico     = Join-Path $env:USERPROFILE '.pico-sdk'
$Cmake    = Join-Path $Pico 'cmake\v4.3.4\bin\cmake.exe'   # keep in step with setup.ps1
$Preset   = 'target'
$BootWait = 20                                             # seconds to wait for both CPUs
$Fw       = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Status   = Join-Path $Fw 'scripts\board_status.py'

function Say($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Die($m) { Write-Host "`nerror: $m" -ForegroundColor Red; exit 1 }
function Check($what) { if ($LASTEXITCODE -ne 0) { Die "$what failed (exit $LASTEXITCODE)." } }
# Run a native command silently. In Windows PowerShell 5.1, redirecting a
# native command's stderr under ErrorActionPreference=Stop throws.
function Quiet([scriptblock]$b) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $b *> $null } finally { $ErrorActionPreference = $old }
}

# Pick up programs setup.ps1 just installed (gcc, py). Without this, a window
# opened before setup ran still has the old PATH.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path

if (-not (Test-Path $Cmake)) { Die "CMake not found at $Cmake. Run firmware\scripts\windows\setup.ps1 first." }
if (-not (Get-Command py -ErrorAction SilentlyContinue)) { Die 'py not found. Run firmware\scripts\windows\setup.ps1 first.' }

# -----------------------------------------------------------------------------
if ($SkipTests) {
    Say '1/5 Host unit tests -- SKIPPED (-SkipTests)'
} else {
    Say '1/5 Host unit tests'
    # Mirrors firmware/tests/run.sh, which needs a POSIX shell.
    if (-not (Get-Command gcc -ErrorAction SilentlyContinue)) {
        Die 'gcc not found. Run setup.ps1 (it installs WinLibs), or pass -SkipTests.'
    }
    $out = Join-Path $Fw 'build-tests'
    New-Item -ItemType Directory -Force $out | Out-Null
    $exe = Join-Path $out 'test_aura_cmd.exe'
    gcc -std=c11 -Wall -Wextra -Werror "-I$Fw\display" -o $exe `
        "$Fw\tests\test_aura_cmd.c" "$Fw\display\aura_cmd.c"; Check 'compiling the host tests'
    & $exe; Check 'host tests'
}

# -----------------------------------------------------------------------------
Say "2/5 Build $App"
Push-Location $Fw
try {
    if (-not (Test-Path 'build\CMakeCache.txt')) {
        $python = (py -c 'import sys; print(sys.executable)')
        & $Cmake --preset $Preset `
            "-Dpicotool_DIR=$Pico\picotool\2.3.0\picotool" `
            "-Dpioasm_DIR=$Pico\tools\2.3.0\pioasm" `
            "-DPython3_EXECUTABLE=$python"; Check 'CMake configure'
    }
    & $Cmake --build --preset $Preset --target $App; Check 'build'
} finally {
    Pop-Location
}
$Uf2 = Join-Path $Fw "build\$App.uf2"
if (-not (Test-Path $Uf2)) { Die "build finished but $Uf2 is missing." }

if ($NoFlash) {
    Say "Done. Built $Uf2 (not flashed: -NoFlash)"
    exit 0
}

# -----------------------------------------------------------------------------
Say '3/5 Board check'
py $Status --require-both --require-no-bootsel
if ($LASTEXITCODE -ne 0) { Die 'fix the board state above, then re-run. (-NoFlash builds without a board.)' }

# -----------------------------------------------------------------------------
Say "4/5 Flash $App"
$flashArgs = @((Join-Path $Fw 'tools\fw.py'), 'flash', $App, '--uf2', $Uf2)
if ($Port) { $flashArgs += @('--port', $Port) }
py @flashArgs; Check 'flash'

# -----------------------------------------------------------------------------
Say "5/5 Waiting up to ${BootWait}s for both CPUs to come back"
for ($i = 0; $i -lt $BootWait; $i++) {
    Start-Sleep -Seconds 1
    Quiet { py $Status --require-both }
    if ($LASTEXITCODE -eq 0) {
        py $Status
        Say 'Done. Flashed and both CPUs are running.'
        Write-Host '    Now check by hand:'
        Write-Host '      1. Watch for 30 s: the board should NOT keep rebooting (screen blanking, USB sounds every ~8 s).'
        Write-Host '      2. Hold RED for 6 s: the LEDs fill red. Then unplug USB: the board should go dark. Hold GRAY 2-3 s to turn it back on.'
        exit 0
    }
}
py $Status
Die "both CPUs did not come back within ${BootWait}s. Reconnect USB; if they still don't show up, read the main CPU's log with: py $Fw\tools\fw.py console"
