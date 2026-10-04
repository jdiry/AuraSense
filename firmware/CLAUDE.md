@wiliOGbsp/AGENTS.md

AuraSense firmware consumes the BSP above. Flash only `AuraSense_main`; the
display image rides inside it. Pure logic lives in `display/aura_cmd.c` and is
host-tested by `tests/run.sh` -- run it before every build you intend to flash.
