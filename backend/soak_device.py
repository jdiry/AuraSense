#!/usr/bin/env python3
"""Device soak test (CONTRIBUTING.md §4.4, H5 + H6).

Each cycle: ping -> intervene -> wait -> intervene again (must restart, not
stack) -> idle. Every reply must arrive within 1 s with the expected state.

    python soak_device.py [--cycles 10] [--wait 5] [--port COM7]
"""
import argparse
import sys
import time

import serial

from device import Device, DeviceError


def expect(reply, state, step):
    if not reply.get("ok") or reply.get("state") != state:
        raise AssertionError(f"{step}: expected ok/{state}, got {reply}")


def cycle(dev, wait_s):
    expect(dev.ping(), "idle", "ping")
    expect(dev.intervene(duration_s=30), "intervening", "intervene")
    time.sleep(wait_s)
    expect(dev.ping(), "intervening", "ping during intervention")
    expect(dev.intervene(duration_s=30), "intervening", "restart")
    expect(dev.idle(), "idle", "idle")
    expect(dev.ping(), "idle", "ping after idle")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cycles", type=int, default=10)
    ap.add_argument("--wait", type=float, default=5.0)
    ap.add_argument("--port")
    args = ap.parse_args(argv)

    passed = 0
    try:
        dev = Device(args.port)
    except (DeviceError, serial.SerialException) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    with dev:
        print(f"# soak on {dev.port}: {args.cycles} cycles")
        dev.idle()
        for i in range(1, args.cycles + 1):
            try:
                cycle(dev, args.wait)
                passed += 1
                print(f"cycle {i}: PASS")
            except (AssertionError, DeviceError) as e:
                print(f"cycle {i}: FAIL  {e}")
    print(f"{passed}/{args.cycles} PASS")
    return 0 if passed == args.cycles else 1


if __name__ == "__main__":
    sys.exit(main())
