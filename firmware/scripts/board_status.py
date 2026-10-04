#!/usr/bin/env python3
"""Report which FREE-WILi OG CPUs Windows can see, and refuse unsafe states.

Run with WINDOWS Python (py / py.exe): only Windows sees the board's COM
ports and RPI-RP2 drives. Needs pyserial. Used by flash.sh and flash.ps1.

  --require-both        exit 1 unless both the display and main CPU are listed
  --require-no-bootsel  exit 1 if any RPI-RP2 (BOOTSEL) drive is mounted

Why the BOOTSEL check: if a drive is already mounted, fw.py copies to it
without knowing which CPU it is. If it is the DISPLAY CPU, it receives the
main image -- which drives a pin against the microphone's output.
"""
import argparse
import os
import string
import sys

VID = 0x093C          # Intrepid Control Systems
PID_MAIN = 0x2054
PID_DISPLAY = 0x2055


def bootsel_drives():
    """Drive letters holding an RPI-RP2 volume (it always has INFO_UF2.TXT)."""
    if os.name != "nt":
        return []
    return [f"{d}:" for d in string.ascii_uppercase
            if os.path.exists(f"{d}:\\INFO_UF2.TXT")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--require-both", action="store_true")
    ap.add_argument("--require-no-bootsel", action="store_true")
    a = ap.parse_args()

    try:
        from serial.tools import list_ports
    except ImportError:
        print("error: pyserial is missing from this Python. "
              "Run: py -m pip install --user pyserial")
        return 2

    seen = {"display": [], "main": []}
    for p in sorted(list_ports.comports(), key=lambda p: p.device):
        role = "other"
        if p.vid == VID and p.pid == PID_DISPLAY:
            role = "display"
        elif p.vid == VID and p.pid == PID_MAIN:
            role = "main"
        if role in seen:
            seen[role].append(p.device)
        label = f"{role} CPU" if role in seen else "(not the board)"
        print(f"  {p.device:<6} {p.vid or 0:04x}:{p.pid or 0:04x} "
              f"{p.serial_number or '-':<18} {label}")
    drives = bootsel_drives()
    for d in drives:
        print(f"  {d:<6} RPI-RP2 volume (a CPU is in BOOTSEL)")
    if not any(seen.values()) and not drives:
        print("  (no FREE-WILi ports or BOOTSEL drives found)")

    ok = True
    if a.require_both and not (seen["display"] and seen["main"]):
        missing = [r for r in ("display", "main") if not seen[r]]
        print(f"FAIL: {' and '.join(missing)} CPU not found. Is the board on? "
              "Reconnect USB or hold GRAY to wake it.")
        ok = False
    if a.require_no_bootsel and drives:
        print("FAIL: an RPI-RP2 drive is already mounted, so the flasher cannot "
              "tell which CPU it would write to. Unplug/replug USB (press no "
              "buttons) and try again.")
        ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
