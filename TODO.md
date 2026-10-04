# TODO — Hardware (FREE-WILi OG)

Hardware work plan for two people sharing one machine, working with coding
agents. Setup, OS-specific commands and testing rules live in
[CONTRIBUTING.md](./CONTRIBUTING.md); this file is the checklist.

Command format used below: **1.** command · **2.** where to run it · **3.** what to expect.

Windows paths assume the WSL distro is `Ubuntu` and the repo is at
`~/AuraSense`. On native Linux or native Windows, see CONTRIBUTING.md for the
equivalent command.

---

## What is already decided

- [x] Record in README §3: **D3 = custom C firmware on `wiliOGbsp`** (this
      branch, `feat/freewili-og-bsp`). **D2 = USB serial via `pyserial`**, a
      line protocol like `tools/bench.py`. The `freewili` Python package targets
      the stock firmware and does not apply once our firmware is flashed.
- The device logic runs on the **display CPU** (LCD, LEDs, speaker, buttons).
  It enumerates its own USB serial port: `FWOG display AuraSense <version>`. The
  main CPU only brings the display up and kicks its watchdog.
- Audio is **8 kHz**, played from arrays compiled into the firmware (see
  `apps/ogvegas`). ElevenLabs clips must be converted and embedded. Fallback
  (D4): play on the laptop.
- [ ] ⚠️ **Ask the FREE-WILi mentors before the first flash:** how a stock
      board gets the display serial bootloader (`fw bootloader`), and how to
      restore stock firmware afterwards.

---

## Roles

Driver/navigator on one machine. **Swap the keyboard at every phase.**

| | **A — Firmware Pilot** | **B — Host & Test Lead** |
|---|---|---|
| Owns | `firmware/display/main.c`, `firmware/main/main.c` | `backend/device.py`, `backend/soak_device.py`, test log |
| Agent session | Claude Code started in `firmware/` | Claude Code started in `backend/` (or repo root) |
| Driving | Prompts the agent, builds, flashes | Writes the serial adapter and soak test |
| Navigating | Watches the console, checks diffs against `AGENTS.md` | Reviews the agent's diff before every flash |
| Signs off | README §4.2 contract running on the board | README §8.1 "done": 10/10 with no reset |

- [x] Create `firmware/CLAUDE.md` containing `@wiliOGbsp/AGENTS.md`, so the
      firmware agent loads the BSP's hardware rules. Several of them can brick
      a CPU.

---

## Phase 0 — Setup (both, ~30 min)

Follow CONTRIBUTING.md → "Hardware setup" for your OS, then:

- [ ] **0.1** Install the BSP tool dependencies
  1. `cd ~/AuraSense/firmware/wiliOGbsp && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`
  2. WSL / Linux terminal
  3. Ends with `Successfully installed pyserial-3.5` (or "Requirement already satisfied").

- [ ] **0.2** Install pyserial on Windows (WSL users only)
  1. `py -m pip install pyserial`
  2. Windows PowerShell
  3. `Successfully installed pyserial-...`

- [x] **0.3** Build AuraSense
  1. `cd ~/AuraSense/firmware && cmake --preset target-posix && cmake --build --preset target-posix`
     (if `cmake` isn't found: `~/.pico-sdk/cmake/v4.3.4/bin/cmake`)
  2. WSL / Linux terminal
  3. Ninja build lines with no errors. `build/AuraSense_main.uf2` gets a fresh timestamp.

- [ ] **0.4** Host unit tests (no hardware)
  1. `./tools/fw test`
  2. WSL / Linux, in `firmware/wiliOGbsp`
  3. `100% tests passed, 0 tests failed`, then the Python unittest summary `OK`.

---

## Phase 1 — Learning FREE-WILi (B drives, A navigates, ~1 h)

Read in order: `firmware/wiliOGbsp/README.md` → `AGENTS.md` (Bring-up order,
Invariants, FwOGapp contract) → `docs/hardware/pinmap.md` → `apps/template/` →
`apps/bench/display/main.c`.

Suggested agent prompt: *"Explain the boot sequence between the main and
display CPUs and list every rule in AGENTS.md that can brick a CPU."*

- [ ] **1.1** List the board's ports
  1. `py -m serial.tools.list_ports -v` (Linux: `python3 -m serial.tools.list_ports -v`)
  2. PowerShell (Linux: terminal)
  3. `COMx` / `/dev/ttyACMx` entries. BSP firmware shows `FWOG main …` / `FWOG display …`, VID `093C`. Stock firmware shows other names.

- [ ] **1.2** Build the bench app (a console for exercising every driver)
  1. `./tools/fw build bench_main`
  2. WSL / Linux, in `firmware/wiliOGbsp`
  3. The build succeeds. `find build -name bench_main.uf2` finds the image.

- [ ] **1.3** Flash it (after the mentor check)
  1. `python \\wsl.localhost\Ubuntu\home\sandr\AuraSense\firmware\wiliOGbsp\tools\fw.py flash bench_main --uf2 \\wsl.localhost\Ubuntu\home\sandr\AuraSense\firmware\wiliOGbsp\build\apps\bench\bench_main.uf2`
  2. PowerShell (Linux: `./tools/fw flash bench_main`)
  3. Identifies the main CPU, touches it at 1200 baud, waits for `RPI-RP2`, then copies the image. The board reboots and the display updates over the link between the CPUs.

- [ ] **1.4** Watch the bench heartbeat
  1. `python \\wsl.localhost\Ubuntu\home\sandr\AuraSense\firmware\wiliOGbsp\tools\bench.py --watch 10`
  2. PowerShell (Linux: `python3 tools/bench.py --watch 10`)
  3. An `HB …` line every 2 s with driver status. Then try `bench.py help` and the LED, LCD and audio commands by hand.

---

## Phase 2 — Bring-up milestone (A drives)

- [ ] **2.1** Flash AuraSense
  1. `python \\wsl.localhost\Ubuntu\home\sandr\AuraSense\firmware\wiliOGbsp\tools\fw.py flash AuraSense_main --uf2 \\wsl.localhost\Ubuntu\home\sandr\AuraSense\firmware\build\AuraSense_main.uf2`
  2. PowerShell (Linux: `./wiliOGbsp/tools/fw flash AuraSense_main --uf2 build/AuraSense_main.uf2` from `firmware/`)
  3. Same flow as 1.3. Afterwards, pressing a front button turns the LED bar that button's color.

- [ ] **2.2** Watch the main CPU's console
  1. `python \\wsl.localhost\Ubuntu\home\sandr\AuraSense\firmware\wiliOGbsp\tools\fw.py console --port COMx` (the `FWOG main AuraSense` port)
  2. PowerShell (Linux: `./wiliOGbsp/tools/fw console --port /dev/ttyACMx`)
  3. ~10 s of `[AuraSense_main] display: <result>`, then `[AuraSense_main] alive` twice a second.

- [ ] **2.3** Required power-off check
  1. Hold the **red** button for 6 s.
  2. On the board
  3. The LED bar counts down and the board powers off. Holding gray or plugging in USB wakes it. **B logs pass/fail.** Nothing else is safe to build until this passes.

---

## Phase 3 — Command listener (A on firmware, B on backend)

- [x] **3.A** Firmware listener. Agent prompt:
      *"In firmware/display/main.c, add a non-blocking line reader using
      getchar_timeout_us(0), following apps/bench/display. Parse the README
      §4.2 JSON commands (ping/idle/intervene) and reply
      `{"ok":true,"state":...}`. Keep fwog_power_poll on every loop. An
      intervene while already intervening restarts the timer and doesn't
      stack. Bump VERSION to 002."*
- [x] **3.B** Host adapter. Agent prompt:
      *"Write backend/device.py: find the port whose USB product starts with
      'FWOG display AuraSense' (Windows needs fw._cpu_ports, see tools/bench.py),
      set DTR, send one JSON line, read one reply with a 1 s timeout. Add a
      CLI: python device.py ping|idle|intervene."*

- [ ] **3.1** Rebuild and flash
  1. Step 0.3, then step 2.1
  2. WSL / Linux, then PowerShell (or Linux)
  3. As before, with the new version in the console and USB product string.

- [ ] **3.2** Ping the board
  1. `python backend\device.py ping` (Linux: `python3 backend/device.py ping`)
  2. PowerShell (Linux: terminal)
  3. `{"ok": true, "state": "idle"}` within 1 s.

---

## Phase 4 — Breathing, LEDs and audio (swap drivers)

- [ ] 4-4-4-4 breathing circle with `st7789_fill_rect` (or LVGL, which is opt-in and costs ~390 KB of flash).
- [ ] LED brightness follows the circle.
- [x] Idle state: dim, slow LED glow, "AuraSense" on screen.
- [ ] Convert clips to 8 kHz (pattern: `tools/gen_ogvegas_assets.py`). Play them with `i2s_audio_start` and call `i2s_audio_process()` every loop (see `apps/ogvegas`).

- [ ] **4.1** Trigger an intervention
  1. `python backend\device.py intervene`
  2. PowerShell (Linux: terminal)
  3. The circle grows for 4 s, holds 4 s, shrinks for 4 s and holds 4 s. LEDs follow it and the clip plays. After `duration_s`, the board returns to dim idle with "AuraSense" on screen.

---

## Phase 5 — Testing and sign-off (B drives)

- [x] **5.A** Soak script. Agent prompt:
      *"Write backend/soak_device.py: 10 cycles of ping → intervene → wait
      5 s → intervene again (must restart the timer, not stack) → idle.
      Assert each reply and print PASS/FAIL per cycle."*

- [ ] **5.1** Device soak test
  1. `python backend\soak_device.py`
  2. PowerShell (Linux: terminal)
  3. `10/10 PASS`. No board reset (a reset means a missing watchdog kick or a hung CPU), and every reply arrives within 1 s.

- [ ] **5.2** Final README §8.1 test (needs the backend)
  1. `curl.exe -X POST localhost:8000/simulate`, 10 times (Linux: `curl -X POST localhost:8000/simulate`)
  2. PowerShell with uvicorn running on Windows (Linux: same machine as uvicorn)
  3. `202` each time, and the full sequence runs on the board 10/10 with no reset.

---

## Timeline (vs. README §10)

| By hour | Done |
|---------|------|
| 2 | Phases 0–2. D2/D3 recorded in README. |
| 6 | Phase 3: `/simulate` → device changes state. |
| 18 | Phase 4: breathing, LEDs, audio. |
| 22 | Phase 5 passes. Firmware frozen. |
