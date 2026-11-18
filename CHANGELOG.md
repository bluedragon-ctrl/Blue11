# Changelog

The npm package `blue11` follows [semantic versioning](https://semver.org): before 1.0, a
minor version may break the API, and a patch never does. The public API is everything
exported from `blue11` and `blue11/codemirror`, plus the JSON form of saved states
(`cpu.save()`, `display.state()`, `keyboard.state()`).

## 0.3.0 (2026-11-18)

- `Keyboard`: keys for games (docs/BLUE11_KEYBOARD.md). A key map at `177000` (a byte per key,
  `200` while down), and a queue of 16 press and release events at `176700` (`KBDCS`, `KBDBUF`)
  with `OVR` and an interrupt at vector `330`. The host calls `press` / `release` (live) or `at`
  (scheduled, for exact replays), and gets a `log`; `state()` / `load()`. Also `KBD`, `KEY` and
  `keyCode` (a browser `KeyboardEvent.code` to a key code).
- `SimpleMachine({ keyboard })` adds a keyboard.
- Keyboard example programs (`KEYBOARD_EXAMPLES` and `KEY_SYMBOLS` in `examples/examples.ts`, not
  part of the API).

## 0.2.0 (2026-11-18)

- `Display`: the Blue-11 framebuffer (docs/BLUE11_DISPLAY.md). Pixel memory at `120000`, registers
  at `176600`, vector `320`; modes 0 (64 × 64) and 1 (128 × 128), 16 colours from a palette, a
  frame every 20000 cycles, and an optional scanning beam (`beam: 'scan'`) that tears. Frames
  are handed to the host as colour indexes with a palette per row; `state()` / `load()`.
  Also `DSP`, `DEFAULT_PALETTE`, `rgb333to888`, `frameToRgba`.
- `Rom`: read-only memory whose contents the host loads; writes are bus errors.
- `SimpleMachine({ display })` adds a display (RAM then ends at `120000`, and the clock ticks
  once a frame).
- Display example programs (`DISPLAY_EXAMPLES` in `examples/examples.ts`, not part of the API).

## 0.1.0 (2026-11-18)

The first release. The library was built in HackCode, and moved here with its history:

- The CPU: the PDP-11 /40 model's instruction set, with EIS as an option. Cycles are counted
  per bus access (or flat), and there are traps, interrupts, `WAIT`, `protectModes`,
  `stackLimit`, and hooks (`onTrap`, `onInstruction`, `onAccess`, `onModeChange`).
- The assembler: a subset of MACRO-11, with errors and warnings as values, a listing, and a
  source line map. Also a disassembler, and the ISA tables.
- `DeviceMachine` with the `Device` interface, DEC's `DL11` console and `KW11L` line clock,
  and `SimpleMachine`.
- `blue11/codemirror`: syntax highlighting for CodeMirror 6.
