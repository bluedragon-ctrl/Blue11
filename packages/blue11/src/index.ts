/**
 * Blue-11: a CPU, assembler and disassembler as a standalone library.
 *
 * Its first users are HackCode (a game) and the Blue-11 simulator: nothing in this folder
 * imports from a host (a test enforces it). Deterministic, integer-only, no DOM. Design: docs/BLUE11_MACHINE.md §9 (at the repository root).
 *
 * API reference, conventions (octal, 16-bit words, cycles), recipes and pitfalls:
 * README.md in this folder; its examples are run by test/readme-examples.test.ts.
 */

export { Cpu, BUS_ERROR, VEC, PSW, PSW_ADDRESS } from './cpu.js';
export type { Bus, CpuOptions, CpuState, CycleModel, RunResult, StopReason, TrapCause, TrapInfo } from './cpu.js';
export { assemble, commentStart } from './assembler.js';
export type { AsmError, AsmLine, AssembleOptions, AssembleResult, NameStyle, Program } from './assembler.js';
export { disassemble } from './disassembler.js';
export type { Disassembled, DisassembleOptions } from './disassembler.js';
export { INSTRUCTIONS, BY_NAME, decodeOp, octal, REGISTER_NAMES, REGISTERS } from './isa.js';
export type { Format, OpInfo } from './isa.js';
export { DeviceMachine, DL11, KW11L, Rom } from './devices.js';
export type { Device, DeviceMachineOptions, DL11Options, RomOptions } from './devices.js';
export { Display, DSP, DEFAULT_PALETTE, rgb333to888, frameToRgba } from './display.js';
export type { Beam, DisplayOptions, DisplayState, Frame } from './display.js';
export { Keyboard, KBD, KEY, keyCode } from './keyboard.js';
export type { Key, KeyboardOptions, KeyboardState, KeyEvent } from './keyboard.js';
export { SimpleMachine, DEV, CSR } from './machine.js';
export type { MachineOptions } from './machine.js';
