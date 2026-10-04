cmake_minimum_required(VERSION 3.13)

# AuraSense firmware for the FREE-WILi OG, built on the wiliOGbsp submodule.
# See wiliOGbsp/AGENTS.md, "Consuming this BSP from another project".

# RP2040 board header. Do NOT pass -DPICO_BOARD on the command line.
set(PICO_BOARD freewili_og CACHE STRING "Board type" FORCE)
list(APPEND PICO_BOARD_HEADER_DIRS "${CMAKE_CURRENT_LIST_DIR}/wiliOGbsp/bsp/boards")

# UART0 is the inter-CPU link on both CPUs and must never carry stdio.
set(PICO_STDIO_UART 0 CACHE BOOL "stdio over UART (forced off: UART0 is the link)" FORCE)

include(pico_sdk_import.cmake)
project(AuraSense C CXX ASM)
set(CMAKE_C_STANDARD 11)
# The BSP runs Python helpers at build time (display image embed, UF2 info).
find_package(Python3 COMPONENTS Interpreter REQUIRED)

pico_sdk_init()

# Version and commit time stamped into the main UF2's info record. The BSP's
# own top-level CMakeLists.txt normally sets these; a consumer must too.
execute_process(
    COMMAND git describe --always --dirty
    WORKING_DIRECTORY ${CMAKE_CURRENT_LIST_DIR}
    OUTPUT_VARIABLE FWOG_GIT_DESCRIBE
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET)
if(FWOG_GIT_DESCRIBE STREQUAL "")
    set(FWOG_GIT_DESCRIBE "dev")
endif()
execute_process(
    COMMAND git log -1 --format=%ct
    WORKING_DIRECTORY ${CMAKE_CURRENT_LIST_DIR}
    OUTPUT_VARIABLE FWOG_GIT_COMMIT_TS
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET)
if(NOT FWOG_GIT_COMMIT_TS MATCHES "^[0-9]+$")
    set(FWOG_GIT_COMMIT_TS 0)
endif()

add_subdirectory(wiliOGbsp/bsp)

# Display CPU: screen, buttons, LEDs, audio. Declared first -- the main
# image embeds it.
add_executable(AuraSense_display display/main.c display/aura_cmd.c)
target_link_libraries(AuraSense_display fwog_display_bsp)
fwog_display_app(AuraSense_display
    VERSION 002
    DESCRIPTION "AuraSense display: JSON command listener (ping/idle/intervene), box-breathing LEDs and screen")

# Main CPU: brings the display up and carries its image. Flash THIS one.
add_executable(AuraSense_main main/main.c)
target_link_libraries(AuraSense_main fwog_main_bsp)
fwog_embed_display_image(AuraSense_main)
fwog_main_app(AuraSense_main
    VERSION 002
    DESCRIPTION "AuraSense main: brings the display up, then a DIAG heartbeat")
