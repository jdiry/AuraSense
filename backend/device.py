#!/usr/bin/env python3
"""AuraSense device adapter: README §4.2 commands over USB serial.

The FREE-WILi OG's display CPU runs the AuraSense firmware, which reads one
JSON command per line on its USB CDC port and answers with one JSON line.
Lines starting with '#' are heartbeats/diagnostics and are skipped.

Usage:
    python device.py ping
    python device.py intervene [--duration 120] [--phase-ms 4000] [--clip calm_01.wav]
    python device.py idle
    python device.py --port COM7 ping      # skip auto-detection

Set DEVICE_ADDRESS (or pass --port) to force a port, e.g. COM7 or /dev/ttyACM1.
"""
import argparse
import json
import os
import pathlib
import sys
import time

import serial

# The BSP's task runner already knows how to find a FREE-WILi CPU by USB PID
# and product string, including on Windows where pyserial hides the product.
# firmware/tools/fw.py is a patched copy of the BSP's (main CPU on two COM
# ports); use it until the fix is upstream.
_FW_TOOLS = pathlib.Path(__file__).resolve().parents[1] / "firmware" / "tools"
sys.path.insert(0, str(_FW_TOOLS))
import fw  # noqa: E402

# Any rate works for USB CDC EXCEPT 1200: opening at 1200 baud reboots the
# CPU into BOOTSEL. Never change this to 1200.
BAUD = 115200
REPLY_TIMEOUT_S = 1.0


class DeviceError(RuntimeError):
    pass


def find_port():
    """The display CPU's serial port, or raise DeviceError."""
    forced = (os.environ.get("DEVICE_ADDRESS") or "").strip()
    if forced and forced.lower() != "auto":     # "auto" = find it by USB ID
        return forced
    try:
        return fw._pick_cpu_port(fw._cpu_ports(), "display")
    except fw.CpuPortError as e:
        raise DeviceError(str(e)) from e


class Device:
    def __init__(self, port=None, timeout=REPLY_TIMEOUT_S):
        self.port = port or find_port()
        self.timeout = timeout
        # pico_stdio_usb neither sends nor accepts data until DTR is asserted.
        self._ser = serial.Serial()
        self._ser.port = self.port
        self._ser.baudrate = BAUD
        self._ser.timeout = 0.05
        self._ser.dtr = True
        self._ser.open()
        time.sleep(0.1)
        self._ser.reset_input_buffer()

    def close(self):
        self._ser.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def send(self, cmd):
        """Send one command dict, return the reply dict. Raises DeviceError."""
        self._ser.reset_input_buffer()
        self._ser.write((json.dumps(cmd, separators=(",", ":")) + "\n").encode())
        self._ser.flush()
        deadline = time.monotonic() + self.timeout
        buf = b""
        while time.monotonic() < deadline:
            buf += self._ser.read(256)
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode(errors="replace").strip()
                if not line.startswith("{"):
                    continue          # heartbeat / diagnostics
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue
        raise DeviceError(f"no reply within {self.timeout:.1f}s on {self.port}")

    def ping(self):
        return self.send({"cmd": "ping"})

    def idle(self):
        return self.send({"cmd": "idle"})

    def intervene(self, duration_s=120, phase_ms=4000, clip=None, pattern="box"):
        cmd = {"cmd": "intervene", "pattern": pattern,
               "phase_ms": phase_ms, "duration_s": duration_s}
        if clip:
            cmd["clip"] = clip
        return self.send(cmd)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", help="serial port (default: auto-detect display CPU)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ping")
    sub.add_parser("idle")
    iv = sub.add_parser("intervene")
    iv.add_argument("--duration", type=int, default=120, help="seconds (default 120)")
    iv.add_argument("--phase-ms", type=int, default=4000, help="ms per phase (default 4000)")
    iv.add_argument("--clip", default=None)
    args = ap.parse_args(argv)

    try:
        with Device(args.port) as dev:
            t0 = time.monotonic()
            if args.cmd == "intervene":
                reply = dev.intervene(args.duration, args.phase_ms, args.clip)
            else:
                reply = getattr(dev, args.cmd)()
            ms = (time.monotonic() - t0) * 1000
    except (DeviceError, serial.SerialException) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(json.dumps(reply))
    print(f"# {dev.port}, {ms:.0f} ms", file=sys.stderr)
    return 0 if reply.get("ok") else 2


if __name__ == "__main__":
    sys.exit(main())
