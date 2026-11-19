/**
 * The Blue-11 keyboard: keys for games (docs/BLUE11_KEYBOARD.md at the repository root).
 * DEC made no such device; it borrows DEC's conventions (a CSR with DONE in bit 7, IE in
 * bit 6 and an error bit in bit 15, and a buffer register read once, like the DL11's RBUF).
 *
 * Two `Device`s share one state: `keyboard.registers` (KBDCS, KBDBUF and a hole) and
 * `keyboard.map`, one byte per key (200: down). Key codes name positions on a US keyboard,
 * not characters; {@link keyCode} turns a browser `KeyboardEvent.code` into one.
 *
 * Time is CPU cycles. Live input arrives between runs, at the current cycle; scheduled
 * input (`at`) takes effect at the first instruction boundary at or after its cycle, so a
 * run with the `log` scheduled again is the same run, cycle for cycle.
 */

import { BUS_ERROR, type Cpu } from './cpu.js';
import { CSR, type Device } from './devices.js';

/** Default addresses and vector of the keyboard (octal). */
export const KBD = {
  KBDCS: 0o176700, KBDBUF: 0o176702,
  /** The key map: the byte of key k is at KBDKEY + k. */
  KBDKEY: 0o177000,
  VEC: 0o330,
} as const;

/** Codes of the keys that are not letters or digits (those have their ASCII codes). */
export const KEY = {
  UP: 0o1, DOWN: 0o2, LEFT: 0o3, RIGHT: 0o4,
  SHIFT: 0o5, CTRL: 0o6, ALT: 0o7,
  BACKSPACE: 0o10, TAB: 0o11, ENTER: 0o15, ESC: 0o33, SPACE: 0o40,
  QUOTE: 0o47, COMMA: 0o54, MINUS: 0o55, PERIOD: 0o56, SLASH: 0o57,
  SEMICOLON: 0o73, EQUAL: 0o75,
  BRACKET_LEFT: 0o133, BACKSLASH: 0o134, BRACKET_RIGHT: 0o135, BACKQUOTE: 0o140,
  DELETE: 0o177,
} as const;

const CODES: Record<string, number> = {
  ArrowUp: KEY.UP, ArrowDown: KEY.DOWN, ArrowLeft: KEY.LEFT, ArrowRight: KEY.RIGHT,
  ShiftLeft: KEY.SHIFT, ShiftRight: KEY.SHIFT, ControlLeft: KEY.CTRL, ControlRight: KEY.CTRL,
  AltLeft: KEY.ALT, AltRight: KEY.ALT,
  Backspace: KEY.BACKSPACE, Tab: KEY.TAB, Enter: KEY.ENTER, Escape: KEY.ESC, Space: KEY.SPACE,
  Quote: KEY.QUOTE, Comma: KEY.COMMA, Minus: KEY.MINUS, Period: KEY.PERIOD, Slash: KEY.SLASH,
  Semicolon: KEY.SEMICOLON, Equal: KEY.EQUAL,
  BracketLeft: KEY.BRACKET_LEFT, Backslash: KEY.BACKSLASH, BracketRight: KEY.BRACKET_RIGHT,
  Backquote: KEY.BACKQUOTE, Delete: KEY.DELETE,
};
for (let i = 0; i < 10; i++) CODES[`Digit${i}`] = 0o60 + i;
for (let i = 0; i < 26; i++) CODES[`Key${String.fromCharCode(65 + i)}`] = 0o101 + i;

/**
 * The key code of a browser `KeyboardEvent.code` (a key's position, not what it types), or 0
 * for a key the device doesn't have: `keyCode('KeyA')` is 101, as is `'A` in the assembler.
 */
export function keyCode(code: string): number {
  return Object.prototype.hasOwnProperty.call(CODES, code) ? CODES[code] : 0;
}

/**
 * A key, for {@link Keyboard.press} and friends: a key code (1–177), or a browser
 * `KeyboardEvent.code` such as `'ShiftLeft'`. With codes the left and right Shift (Ctrl,
 * Alt) are told apart, so the key stays down while either is held.
 */
export type Key = number | string;

/** An event that took effect: the key map changed. */
export interface KeyEvent {
  cycle: number;
  code: number;
  down: boolean;
}

export interface KeyboardOptions {
  /** KBDCS and KBDBUF, then a hole to +037. Default 176700. */
  base?: number;
  /** The key map (200 bytes). Default 177000. */
  map?: number;
  /** Default 330. */
  vector?: number;
  /** Bus request level. Default 4. */
  level?: number;
  /** Events the queue holds, KBDBUF's included. Default 16. */
  queue?: number;
}

/** A keyboard saved as plain data (survives `JSON.stringify`). */
export interface KeyboardState {
  /** Cycles since power-up. */
  cycle: number;
  /** IE and OVR. */
  csr: number;
  /** Events waiting, oldest (KBDBUF) first: the code, plus 200 for a release. */
  queue: number[];
  /** The keys held down: codes, and `KeyboardEvent.code`s for the left and right modifiers. */
  held: Key[];
  /** Input waiting for its cycle, in order. */
  scheduled: Array<{ cycle: number; key: Key; down: boolean }>;
  log: KeyEvent[];
}

/** The modifiers with a left and a right key. */
const SIDES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight']);

const REGS = 0o40;
const MAP = 0o200;
const OVR = 0o100000;
const DOWN = 0o200;

export class Keyboard {
  readonly base: number;
  readonly mapBase: number;
  readonly vector: number;
  readonly level: number;
  readonly queueSize: number;

  /** KBDCS, KBDBUF and the hole up to +037, a `Device` (plug it in with `machine.add`). */
  readonly registers: Device;
  /** The key map, a `Device`: one byte per key code, 200 while the key is down. */
  readonly map: Device;
  /** The key map as the program sees it (index: key code). The host may read it. */
  readonly keys = new Uint8Array(MAP);
  /** Every event that took effect since power-up, with its cycle: schedule them again with `at` to replay. */
  log: KeyEvent[] = [];

  private cpu: Cpu | null = null;
  private now = 0;
  private csr = 0;
  private queue: number[] = [];
  private held: Key[] = [];
  private scheduled: Array<{ cycle: number; key: Key; down: boolean }> = [];

  constructor(opts: KeyboardOptions = {}) {
    this.base = opts.base ?? KBD.KBDCS;
    this.mapBase = opts.map ?? KBD.KBDKEY;
    this.vector = opts.vector ?? KBD.VEC;
    this.level = opts.level ?? 4;
    this.queueSize = opts.queue ?? 16;
    const range = (what: string, at: number, size: number) => {
      if (!Number.isInteger(at) || at & 1 || at < 0 || at + size > 0x10000) {
        throw new Error(`Keyboard: ${what} at ${at.toString(8)} must be even, with ${size.toString(8)} bytes below 200000`);
      }
    };
    range('registers', this.base, REGS);
    range('key map', this.mapBase, MAP);
    if (!Number.isInteger(this.queueSize) || this.queueSize < 1) throw new Error('Keyboard: queue must be a whole number, at least 1');

    const k = this;
    this.registers = {
      base: this.base,
      size: REGS,
      attach: (cpu) => { k.cpu = cpu; },
      read: (offset) => k.readReg(offset),
      write: (offset, value, byte) => k.writeReg(offset, value, byte),
      reset: (powerUp) => k.reset(powerUp),
      advance: (cycles) => k.advance(cycles),
      nextEvent: () => (k.scheduled.length ? k.scheduled[0].cycle - k.now : Infinity),
      wakeIn: () => (k.csr & CSR.IE && k.scheduled.length ? k.scheduled[0].cycle - k.now : Infinity),
      canWake: () => (k.csr & CSR.IE) !== 0,
    };
    const keys = this.keys;
    this.map = {
      base: this.mapBase,
      size: MAP,
      read: (offset) => keys[offset] | (keys[offset + 1] << 8),
      write: () => true, // read only: writes are ignored, with no trap
    };
  }

  /** The cycle the keyboard is at: the machine's cycles since boot. */
  get cycle(): number { return this.now; }

  /** Press a key now. A key already down is ignored. */
  press(key: Key): void { this.apply(key, true); }

  /** Let a key go now. A key that is up is ignored. */
  release(key: Key): void { this.apply(key, false); }

  /** Let every key go now (when the page loses focus, say). */
  releaseAll(): void {
    for (const key of [...this.held]) this.apply(key, false);
  }

  /**
   * Press (`down`) or release a key at `cycle`: it takes effect at the first instruction
   * boundary at or after it. Throws for a cycle in the past.
   */
  at(cycle: number, key: Key, down: boolean): void {
    if (!Number.isInteger(cycle) || cycle < this.now) {
      throw new Error(`Keyboard: cycle ${cycle} is in the past (the keyboard is at ${this.now})`);
    }
    this.check(key);
    if (cycle === this.now) { this.apply(key, down); return; }
    let i = this.scheduled.length;
    while (i > 0 && this.scheduled[i - 1].cycle > cycle) i--;
    this.scheduled.splice(i, 0, { cycle, key, down });
  }

  /** Save the device as plain data. */
  state(): KeyboardState {
    return {
      cycle: this.now, csr: this.csr, queue: [...this.queue], held: [...this.held],
      scheduled: this.scheduled.map((e) => ({ ...e })), log: this.log.map((e) => ({ ...e })),
    };
  }

  /** Restore a saved state (of a keyboard with the same options). Pending interrupts are the CPU's. */
  load(s: KeyboardState): void {
    this.now = s.cycle;
    this.csr = s.csr;
    this.queue = [...s.queue];
    this.held = [...s.held];
    this.scheduled = s.scheduled.map((e) => ({ ...e }));
    this.log = s.log.map((e) => ({ ...e }));
    this.keys.fill(0);
    for (const key of this.held) this.keys[this.code(key)] = DOWN;
  }

  // ---------------------------------------------------------------- input

  private code(key: Key): number {
    return typeof key === 'number' ? key : keyCode(key);
  }

  private check(key: Key): void {
    if (typeof key === 'number' && !(Number.isInteger(key) && key >= 1 && key <= 0o177)) {
      throw new Error(`Keyboard: key code ${key} is not 1–177 (octal)`);
    }
  }

  /**
   * The physical key held: the left and right modifiers are told apart by their
   * `KeyboardEvent.code`; every other key is its code, however it was named.
   */
  private ident(key: Key): Key {
    return typeof key === 'string' && SIDES.has(key) ? key : this.code(key);
  }

  private apply(key: Key, down: boolean): void {
    this.check(key);
    const code = this.code(key);
    if (!code) return; // a key the device doesn't have
    const id = this.ident(key);
    if (down) {
      if (this.held.includes(id)) return; // already down
      const others = this.held.some((h) => this.code(h) === code);
      this.held.push(id);
      if (others) return; // the other Shift is down: the code is down already
    } else {
      // A code lets go of every key with that code; a modifier's name only of that side.
      const mine = (h: Key) => (typeof key === 'number' ? this.code(h) === code : h === id);
      if (!this.held.some(mine)) return; // already up
      this.held = this.held.filter((h) => !mine(h));
      if (this.held.some((h) => this.code(h) === code)) return; // the other side is still down
    }
    this.keys[code] = down ? DOWN : 0;
    this.log.push({ cycle: this.now, code, down });
    if (this.queue.length >= this.queueSize) {
      this.csr |= OVR;
      return;
    }
    this.queue.push(down ? code : code | DOWN);
    if (this.csr & CSR.IE) this.cpu?.interrupt(this.vector, this.level);
  }

  private advance(cycles: number): void {
    this.now += cycles;
    while (this.scheduled.length && this.scheduled[0].cycle <= this.now) {
      const e = this.scheduled.shift()!;
      this.apply(e.key, e.down);
    }
  }

  // ---------------------------------------------------------------- registers

  private readReg(offset: number): number {
    if (offset === 0) return this.csr | (this.queue.length ? CSR.DONE : 0);
    if (offset !== 2) return BUS_ERROR; // the hole 176704–176736
    const v = this.queue.shift() ?? 0;
    if (!this.queue.length) this.cpu?.cancelInterrupt(this.vector);
    else if (this.csr & CSR.IE) this.cpu?.interrupt(this.vector, this.level);
    return v;
  }

  private writeReg(offset: number, value: number, byte: boolean): boolean {
    if (offset === 2 || offset === 3) return true; // KBDBUF: read only
    if (offset > 1) return false; // the hole
    if (byte && offset === 1) {
      if (!(value & 0o200)) this.csr &= ~OVR;
      return true;
    }
    this.csr = (this.csr & OVR) | (value & CSR.IE);
    if (!byte && !(value & OVR)) this.csr &= ~OVR;
    if (!(this.csr & CSR.IE)) this.cpu?.cancelInterrupt(this.vector);
    else if (this.queue.length) this.cpu?.interrupt(this.vector, this.level);
    return true;
  }

  private reset(powerUp: boolean): void {
    this.cpu?.cancelInterrupt(this.vector);
    this.csr &= ~CSR.IE;
    if (!powerUp) return;
    this.now = 0;
    this.csr = 0;
    this.queue = [];
    this.held = [];
    this.scheduled = [];
    this.log = [];
    this.keys.fill(0);
  }
}
