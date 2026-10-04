# =============================================================================
# AuraSense firmware -- one-time setup for WINDOWS (no WSL)
# =============================================================================
#
# Run from a PowerShell window in the AuraSense repo folder:
#     powershell -ExecutionPolicy Bypass -File firmware\scripts\windows\setup.ps1
# Then build, test and flash with:
#     powershell -ExecutionPolicy Bypass -File firmware\scripts\windows\flash.ps1
#
# ("-ExecutionPolicy Bypass" lets this one unsigned script run without
#  changing your system's policy.)
#
# ASSUMPTIONS -- read before running
# ----------------------------------
# * Windows 10 (1809 or later) or Windows 11, x64, with winget. winget ships
#   as "App Installer" in the Microsoft Store and is preinstalled on Windows 11.
# * The AuraSense repo is cloned on a Windows drive (e.g. C:\src\AuraSense).
#   Using WSL? Run firmware/scripts/wsl/setup.sh inside WSL instead.
# * Your Windows user folder has NO SPACES in its path (C:\Users\jsmith, not
#   C:\Users\John Smith). The toolchain installs under it, and Pico SDK builds
#   can break when the path has spaces.
# * Internet access. The first run downloads about 1.5 GB and takes 10-20
#   minutes. Later runs skip whatever is already installed, so it is safe to
#   re-run.
# * winget may show a UAC prompt when installing Git or Python.
# * No board is needed for setup.
#
# WHAT IT CHANGES
# ---------------
# * winget packages, only if missing:
#     Git.Git                           -- git (submodules, SDK clone)
#     Python.Python.3.13                -- build helpers + the flasher (py)
#     BrechtSanders.WinLibs.POSIX.UCRT  -- gcc, for the host unit tests
# * pyserial, installed for Python with pip --user
# * %USERPROFILE%\.pico-sdk\ -- the same layout the Raspberry Pi Pico VS Code
#   extension uses, and what firmware\CMakePresets.json points at. If you
#   already have the extension with these versions, nothing is downloaded.
# * The firmware\wiliOGbsp git submodule is checked out.
#
# VERSIONS are pinned to match firmware\CMakePresets.json. Change both together.
# =============================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$SdkVer       = '2.3.0'
$ToolchainDir = '15_2_Rel1'          # folder name the presets expect
$ToolchainVer = '15.2.rel1'          # Arm's name for the same release
$NinjaVer     = '1.13.2'
$CmakeVer     = '4.3.4'
$PicotoolVer  = '2.3.0'
$ToolsRelease = 'v2.3.0-1'           # github.com/raspberrypi/pico-sdk-tools release

$Pico = Join-Path $env:USERPROFILE '.pico-sdk'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$Tar  = Join-Path $env:SystemRoot 'System32\tar.exe'   # Windows' tar; it unpacks .zip too
$Curl = Join-Path $env:SystemRoot 'System32\curl.exe'

function Say($m)  { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    ok  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    warning: $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "`nerror: $m" -ForegroundColor Red; exit 1 }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Check($what) { if ($LASTEXITCODE -ne 0) { Die "$what failed (exit $LASTEXITCODE)." } }
# Run a native command silently. In Windows PowerShell 5.1, redirecting a
# native command's stderr under ErrorActionPreference=Stop throws.
function Quiet([scriptblock]$b) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $b *> $null } finally { $ErrorActionPreference = $old }
}

# Pick up PATH changes made by winget without reopening the window.
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Winget-Install($id, $cmd) {
    if (Have $cmd) { Ok "$cmd ($id already installed)"; return }
    Write-Host "    installing $id with winget"
    winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
    Refresh-Path
    if (-not (Have $cmd)) {
        Die "$id installed but '$cmd' is not on PATH yet. Close PowerShell, open a new window, and re-run this script."
    }
    Ok "$cmd ($id)"
}

# Download an archive and unpack it into $Dest, dropping the archive's single
# top-level folder if it has one.
function Fetch($Url, $Dest) {
    # A folder here means an earlier install broke partway. Don't delete it
    # on the user's behalf.
    if (Test-Path $Dest) { Die "$Dest exists but looks incomplete. Delete it and re-run." }
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
    $x = Join-Path $tmp 'x'
    New-Item -ItemType Directory -Force $x | Out-Null
    $file = Join-Path $tmp ([IO.Path]::GetFileName($Url))
    Write-Host "    downloading $Url"
    & $Curl -fL --retry 3 --progress-bar -o $file $Url; Check 'download'
    & $Tar -xf $file -C $x; Check 'unpack'
    Remove-Item (Join-Path $x '.keep') -ErrorAction SilentlyContinue
    $top = @(Get-ChildItem $x)
    New-Item -ItemType Directory -Force (Split-Path $Dest) | Out-Null
    if ($top.Count -eq 1 -and $top[0].PSIsContainer) {
        Move-Item $top[0].FullName $Dest
    } else {
        Move-Item $x $Dest
    }
    Remove-Item -Recurse -Force $tmp
}

# -----------------------------------------------------------------------------
Say 'Checking the environment'
if ($env:OS -ne 'Windows_NT') { Die 'this script is for Windows.' }
if (-not [Environment]::Is64BitOperatingSystem) { Die 'a 64-bit Windows is required.' }
if (-not (Have winget)) { Die 'winget not found. Install "App Installer" from the Microsoft Store, then re-run.' }
foreach ($t in $Tar, $Curl) { if (-not (Test-Path $t)) { Die "$t not found. Windows 10 1809 or later is required." } }
if ($Repo -like '\\wsl*') { Die "the repo is inside WSL ($Repo). Use firmware/scripts/wsl/setup.sh from WSL instead." }
if ($env:USERPROFILE -match ' ') { Warn "your user folder has a space ($env:USERPROFILE). Builds may fail; see the assumptions at the top." }
Ok "Windows x64, repo at $Repo"

# -----------------------------------------------------------------------------
Say 'Programs (winget)'
Winget-Install 'Git.Git' 'git'
Winget-Install 'Python.Python.3.13' 'py'
Winget-Install 'BrechtSanders.WinLibs.POSIX.UCRT' 'gcc'

Quiet { py -c 'import serial' }
if ($LASTEXITCODE -eq 0) {
    Ok 'pyserial already installed'
} else {
    py -m pip install --user --quiet pyserial; Check 'pip install pyserial'
    Ok 'pyserial installed'
}

# -----------------------------------------------------------------------------
Say 'BSP submodule (firmware\wiliOGbsp)'
git -C $Repo submodule update --init firmware/wiliOGbsp; Check 'git submodule update'
Ok (git -C (Join-Path $Repo 'firmware\wiliOGbsp') log --oneline -1)

# -----------------------------------------------------------------------------
Say "Pico toolchain in $Pico"
$sdk = Join-Path $Pico "sdk\$SdkVer"
if (Test-Path (Join-Path $sdk 'pico_sdk_init.cmake')) {
    Ok "Pico SDK $SdkVer (already installed)"
} else {
    # core.longpaths: some SDK submodule paths pass Windows' 260-char limit.
    git -c core.longpaths=true -c advice.detachedHead=false clone --quiet --depth 1 --branch $SdkVer `
        https://github.com/raspberrypi/pico-sdk.git $sdk; Check 'Pico SDK clone'
    git -C $sdk config core.longpaths true
    git -C $sdk submodule update --init --depth 1 --quiet; Check 'Pico SDK submodules'
    Ok "Pico SDK $SdkVer"
}

$gcc = Join-Path $Pico "toolchain\$ToolchainDir\bin\arm-none-eabi-gcc.exe"
if (Test-Path $gcc) { Ok "Arm GCC $ToolchainVer (already installed)" } else {
    Fetch "https://developer.arm.com/-/media/Files/downloads/gnu/$ToolchainVer/binrel/arm-gnu-toolchain-$ToolchainVer-mingw-w64-x86_64-arm-none-eabi.zip" `
        (Join-Path $Pico "toolchain\$ToolchainDir")
    Ok "Arm GCC $ToolchainVer"
}

if (Test-Path (Join-Path $Pico "ninja\v$NinjaVer\ninja.exe")) { Ok "Ninja $NinjaVer (already installed)" } else {
    Fetch "https://github.com/ninja-build/ninja/releases/download/v$NinjaVer/ninja-win.zip" `
        (Join-Path $Pico "ninja\v$NinjaVer")
    Ok "Ninja $NinjaVer"
}

if (Test-Path (Join-Path $Pico "cmake\v$CmakeVer\bin\cmake.exe")) { Ok "CMake $CmakeVer (already installed)" } else {
    Fetch "https://github.com/Kitware/CMake/releases/download/v$CmakeVer/cmake-$CmakeVer-windows-x86_64.zip" `
        (Join-Path $Pico "cmake\v$CmakeVer")
    Ok "CMake $CmakeVer"
}

# Prebuilt picotool and pioasm. Without them, every fresh build folder
# compiles both from source, which is slow and needs a host C++ compiler.
if (Test-Path (Join-Path $Pico "picotool\$PicotoolVer\picotool\picotool.exe")) { Ok "picotool $PicotoolVer (already installed)" } else {
    Fetch "https://github.com/raspberrypi/pico-sdk-tools/releases/download/$ToolsRelease/picotool-$PicotoolVer-x64-win.zip" `
        (Join-Path $Pico "picotool\$PicotoolVer\picotool")
    Ok "picotool $PicotoolVer"
}
if (Test-Path (Join-Path $Pico "tools\$SdkVer\pioasm\pioasm.exe")) { Ok "pioasm $SdkVer (already installed)" } else {
    Fetch "https://github.com/raspberrypi/pico-sdk-tools/releases/download/$ToolsRelease/pico-sdk-tools-$SdkVer-x64-win.zip" `
        (Join-Path $Pico "tools\$SdkVer\pioasm")
    Ok "pioasm $SdkVer"
}

# -----------------------------------------------------------------------------
Say 'Done'
Write-Host @'
    Everything is installed. Next, with the board plugged in and powered on:

        powershell -ExecutionPolicy Bypass -File firmware\scripts\windows\flash.ps1
        powershell -ExecutionPolicy Bypass -File firmware\scripts\windows\flash.ps1 -NoFlash   # no board
'@
