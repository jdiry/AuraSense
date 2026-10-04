#!/bin/sh
# Host tests for AuraSense firmware logic. Needs only a host C compiler.
# Run from anywhere: firmware/tests/run.sh
set -e
here="$(cd "$(dirname "$0")" && pwd)"
fw="$here/.."
out="$fw/build-tests"
mkdir -p "$out"
${CC:-cc} -std=c11 -Wall -Wextra -Werror -I"$fw/display" \
    -o "$out/test_aura_cmd" "$here/test_aura_cmd.c" "$fw/display/aura_cmd.c"
"$out/test_aura_cmd"
