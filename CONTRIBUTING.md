# Contributing to AuraSense

Read [README.md](./README.md) for the architecture, interface contracts and
roles. The current hardware plan is in [TODO.md](./TODO.md). This file covers
how to work in the repo: setting up a machine for FREE-WILi hardware work, and
how changes are tested before they reach the board.

---

## 1. Workflow

- **Branches:** branch from `main` as `feat/<topic>`, `fix/<topic>` or
  `docs/<topic>`. Open a PR back to `main`. Never push directly to `main`.
- **Commits:** use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`. If a change could not be
  tested on hardware, say so in the commit message.
- **Contracts:** README §4 (event payload, device commands, endpoints) only
  changes with team agreement, in the same PR as the code.
- **Secrets:** never commit `.env`. Never paste real keys into code, docs,
  prompts or chat. Only placeholders go in `.env.example`.
- **Build outputs:** `build/`, `*.uf2`, `*.elf`, `*.bin` and `*.hex` are never
  committed.

### Working with coding agents

- Start the firmware agent inside `firmware/`, and make sure
  `firmware/CLAUDE.md` contains `@wiliOGbsp/AGENTS.md` so the agent loads the
  BSP's hardware rules.
- **A human reviews every firmware diff before it is flashed.** Use the
  pre-flash checklist in §4.3.
- Agents may build and run host tests. Only a human should approve flashing
  and on-board tests, because a bad flash can take a CPU off USB.

---

## 2. Repository: the firmware piece

```text
firmware/
├── CMakeLists.txt         # AuraSense project; consumes wiliOGbsp/bsp
├── CMakePresets.json      # "target" (Windows) / "target-posix" (macOS/Linux)
├── display/main.c         # Display CPU: LCD, LEDs, buttons, audio, command listener
├── main/main.c            # Main CPU: brings the display up, kicks the watchdog
└── wiliOGbsp/             # git submodule: FREE-WILi OG board support package
```

The FREE-WILi OG has **two RP2040s**. Only the main CPU's image is flashed:
`AuraSense_main.uf2` carries the display image inside it and pushes it over the
link between the CPUs at boot. See `firmware/wiliOGbsp/AGENTS.md`.

---

## 3. Hardware setup

Pick the section for your OS. All three end with the same result: a built
`firmware/build/AuraSense_main.uf2`, and a terminal that can see the board's
serial ports and flash it.

> **Fastest path on Windows: use the scripts.** Each one lists its
> assumptions at the top. Read those before running it.
>
> | You have | One-time setup | Test, build, flash |
> |----------|----------------|--------------------|
> | Windows + WSL | `firmware/scripts/wsl/setup.sh` | `firmware/scripts/wsl/flash.sh` |
> | Windows only | `powershell -ExecutionPolicy Bypass -File firmware\scripts\windows\setup.ps1` | `powershell -ExecutionPolicy Bypass -File firmware\scripts\windows\flash.ps1` |
>
> Setup installs the toolchain into `~/.pico-sdk` without VS Code. The flash
> scripts take `--no-flash`/`-NoFlash` to build without a board. They flash
> through `firmware/tools/fw.py`, a temporary copy of the BSP's `fw.py` with a
> fix for the main CPU showing up on two COM ports. Delete that copy once the
> fix is upstream.

### 3.0 Common to every OS

1. Clone with the submodule:
   ```bash
   git clone --recurse-submodules <repo-url>
   # already cloned:
   git submodule update --init
   ```
2. Install the **Raspberry Pi Pico** extension for VS Code and use it to
   install **Pico SDK 2.3.0**. The CMake presets expect its layout under
   `~/.pico-sdk` (`%USERPROFILE%\.pico-sdk` on Windows):
   `sdk/2.3.0`, `toolchain/15_2_Rel1`, `ninja/v1.13.2`, `cmake/v*/bin`.
3. Python 3.9+.
4. ⚠️ **Before the first flash of a stock board**, check with the FREE-WILi
   mentors how to install the display serial bootloader (`fw bootloader`) and
   how to restore stock firmware afterwards.

> `cmake` not on PATH? The `fw` tool finds the extension's copy on its own.
> For direct `cmake` calls, use `~/.pico-sdk/cmake/v4.3.4/bin/cmake`
> (Windows: `%USERPROFILE%\.pico-sdk\cmake\v4.3.4\bin\cmake.exe`). The version
> folder may differ on your machine.

### 3.1 Linux (native)

```bash
# Tools
sudo apt install build-essential git python3-venv

# Serial port access (log out and back in afterwards)
sudo usermod -aG dialout $USER      # Arch/Fedora: uucp or dialout

# BSP tool dependencies
cd firmware/wiliOGbsp
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# Build AuraSense
cd ..
cmake --preset target-posix
cmake --build --preset target-posix
```

Notes:

- `fw flash` looks for the `RPI-RP2` volume under `/media` and `/run/media`.
  Desktop environments auto-mount it there. On a headless machine, mount it
  yourself when it appears: `udisksctl mount -b /dev/sdX1`.
- If a port is busy right after plugging in, ModemManager may be probing it:
  `sudo systemctl stop ModemManager`.
- Ports show up as `/dev/ttyACM*`.

Command forms on Linux (run from `firmware/`):

| Task | Command |
|------|---------|
| Flash | `./wiliOGbsp/tools/fw flash AuraSense_main --uf2 build/AuraSense_main.uf2` |
| Console | `./wiliOGbsp/tools/fw console --port /dev/ttyACMx` |
| List ports | `python3 -m serial.tools.list_ports -v` |

### 3.2 Windows (native)

In **PowerShell**:

```powershell
# BSP tool dependencies
py -m pip install -r firmware\wiliOGbsp\requirements.txt

# Build AuraSense
cd firmware
cmake --preset target
cmake --build --preset target
```

Notes:

- Host unit tests (`fw test`) also need **MSYS2 MinGW GCC** on PATH.
- `fw flash` finds the `RPI-RP2` drive letter by itself. Ports show up as
  `COMx`, and `fw` identifies them by USB product string, so you don't need to
  guess COM numbers.

Command forms on Windows (run from `firmware\`):

| Task | Command |
|------|---------|
| Flash | `wiliOGbsp\tools\fw.cmd flash AuraSense_main --uf2 build\AuraSense_main.uf2` |
| Console | `wiliOGbsp\tools\fw.cmd console --port COMx` |
| List ports | `py -m serial.tools.list_ports -v` |

### 3.3 Windows + WSL2 (build in Linux, USB from Windows)

WSL2 does not see USB devices by default. The simplest setup is to **build
in WSL** and **do all USB work in Windows PowerShell**: flashing, the console,
and the backend's serial link.

1. In WSL, follow §3.1 up to the build (skip `dialout`).
2. In PowerShell: `py -m pip install pyserial`
3. Flash from PowerShell, pointing at the WSL files (distro name from
   `echo $WSL_DISTRO_NAME`):
   ```powershell
   python \\wsl.localhost\Ubuntu\home\<user>\AuraSense\firmware\wiliOGbsp\tools\fw.py flash AuraSense_main --uf2 \\wsl.localhost\Ubuntu\home\<user>\AuraSense\firmware\build\AuraSense_main.uf2
   ```

Optional: [usbipd-win](https://github.com/dorssel/usbipd-win) can pass the
serial port into WSL (`usbipd list`, `usbipd bind --busid <id>`,
`usbipd attach --wsl --busid <id> --auto-attach`). While attached, Windows
loses the port. The `RPI-RP2` volume will not auto-mount in WSL, so keep
flashing on the Windows side.

### 3.4 Check your setup

| # | Command | Where | Expected output |
|---|---------|-------|-----------------|
| 1 | List ports (see your OS table) | Terminal on the OS that owns USB | `FWOG main …` / `FWOG display …` entries with VID `093C` (stock firmware shows other names) |
| 2 | `./tools/fw test` (Windows: `tools\fw.cmd test`) | `firmware/wiliOGbsp` | `100% tests passed`, then Python unittest `OK` |
| 3 | Build (see your OS section) | `firmware/` | Build finishes with no errors and a fresh `build/AuraSense_main.uf2` |

---

## 4. Testing

Changes move up four levels. Don't flash anything that fails a lower level.

### 4.1 Host unit tests (no hardware)

```bash
firmware/tests/run.sh    # AuraSense logic (display/aura_cmd.c). Windows: run from WSL or MSYS2
cd firmware/wiliOGbsp
./tools/fw test          # BSP tests. Windows: tools\fw.cmd test
```

**Expected:** `test_aura_cmd: all checks passed`, then for the BSP
`100% tests passed, 0 tests failed` and the Python unittest summary `OK`. Pure logic you add (command parsing, the breathing-phase timer)
should be written so it can be tested here, without the SDK or a board.

### 4.2 Build check

Build with your OS's preset (§3). The BSP runs `check_uf2_info.py` after every
build and **fails the build** if the UF2 info record is missing or wrong, so a
green build means the image is well-formed. Bump `VERSION` (three digits) in
`firmware/CMakeLists.txt` when behaviour changes.

### 4.3 Pre-flash review checklist

A human checks the diff for every item before flashing:

- [ ] `firmware/main/main.c` still calls `board_watchdog_kick()` on **every**
      loop iteration. Without it, the board resets every 8.3 s and the display
      never runs.
- [ ] `firmware/display/main.c` still calls `fwog_power_poll()` once per loop,
      and takes button state from its return value.
- [ ] No `printf` and no stdio on UART0 (it is the link between the CPUs).
      Use `DIAG()`.
- [ ] No watchdog added to the display CPU.
- [ ] Only `AuraSense_main` gets flashed. **Never `fw flash` a display app.** It
      will not boot and it takes the display CPU off USB.
- [ ] No `-DPICO_BOARD` on any cmake command line.

### 4.4 On-hardware tests

Run after every flash. Record the results in the test log (§4.5).

| # | Test | How | Pass |
|---|------|-----|------|
| H1 | Boot | Console on the `FWOG main AuraSense` port | `[AuraSense_main] display: …` for ~10 s, then `[AuraSense_main] alive` twice a second |
| H2 | Power off | Hold **red** 6 s | LED countdown, board powers off; holding gray or plugging in USB wakes it |
| H3 | Ping | `device.py ping` | `{"ok": true, "state": "idle"}` within 1 s |
| H4 | Intervene | `device.py intervene` | 4-4-4-4 circle, LEDs follow it, clip plays, returns to idle after `duration_s` |
| H5 | Restart, no stacking | `intervene` twice, 5 s apart | Timer restarts; one sequence only |
| H6 | Soak | `soak_device.py` | `10/10 PASS`, no board reset |
| H7 | End to end | `POST /simulate` ×10 | `202` each time; full sequence 10/10, no reset (README §8.1) |

**H2 must pass before any feature work** (BSP bring-up rule). A board that
can't power itself off can't be recovered without a human.

Use `python3` / `/dev/ttyACMx` on Linux, and `python` / `COMx` from
PowerShell on Windows and WSL2.

### 4.5 Test log

Add a row to `firmware/TESTLOG.md` after every flash:

```markdown
| Date/time | Who | Firmware VERSION | Commit | H1 | H2 | H3 | H4 | H5 | H6 | H7 | Notes |
|-----------|-----|------------------|--------|----|----|----|----|----|----|----|-------|
```

### 4.6 Recovery

- **The main CPU won't enumerate or keeps resetting:** hold **red** through a
  reset to drop the main CPU into BOOTSEL, then flash a known-good
  `AuraSense_main.uf2`.
- **A display app was UF2-flashed by mistake:** flash any main app that carries
  the display image you want. It streams the image over the link and repairs
  the metadata. Details in `firmware/wiliOGbsp/AGENTS.md`.
- **Two `RPI-RP2` volumes are mounted:** unplug, replug, and put only one CPU
  in BOOTSEL. The two can't be told apart.
