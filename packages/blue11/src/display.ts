/**
 * The Blue-11 display: a memory-mapped framebuffer for teaching (docs/BLUE11_DISPLAY.md at
 * the repository root). DEC made no such device; it borrows DEC's conventions (a CSR with
 * DONE in bit 7 and IE in bit 6, a vector, a bus level).
 *
 * Two `Device`s share one state: `display.memory`, the 16 KB pixel window, and
 * `display.control`, the registers. The library keeps only the pixels: at every vertical
 * blank it hands the host a {@link Frame} of colour indexes and palettes to paint.
 *
 * Time is CPU cycles. A frame of `frameCycles` starts with the vertical blank
 * (`blankCycles`), then the beam passes the rows evenly: row r from cycle
 * `T(r) = blankCycles + floor(r * (frameCycles - blankCycles) / H)` to `T(r + 1)`
 * (`T(H) = frameCycles`). `DSPLIN` shows the row the beam is on. With the scanning beam a
 * row is latched when the beam has passed it, at `T(r + 1)`.
 */

import { BUS_ERROR, type Cpu } from './cpu.js';
import { CSR, type Device } from './devices.js';

/** Default addresses and vector of the display (octal), and its predefined names. */
export const DSP = {
  /** Pixel memory: page 0. */
  SCREEN: 0o120000,
  DSPCS: 0o176600, DSPFRM: 0o176602, DSPLIN: 0o176604,
  /** Palette entry n at DSPPAL + 2n. */
  DSPPAL: 0o176620,
  VEC: 0o320,
} as const;

/** The power-up palette (RGB 3-3-3, octal `RGB`): a classic 16-colour set. */
export const DEFAULT_PALETTE: readonly number[] = [
  0o000, 0o003, 0o030, 0o033, 0o300, 0o303, 0o320, 0o555,
  0o333, 0o337, 0o373, 0o377, 0o733, 0o737, 0o770, 0o777,
];

/** Each 3-bit level 0–7 as 8 bits: 0, 44, 111, 155, 222, 266, 333, 377 (octal). */
const LEVELS = [0, 36, 73, 109, 146, 182, 219, 255];

/** An RGB 3-3-3 palette value as 8-bit `[red, green, blue]`: `rgb333to888(0o770)` is `[255, 255, 0]`. */
export function rgb333to888(v: number): [number, number, number] {
  return [LEVELS[(v >> 6) & 7], LEVELS[(v >> 3) & 7], LEVELS[v & 7]];
}

export type Beam = 'instant' | 'scan';

export interface DisplayOptions {
  /** Pixel window base: 16 KB, starting at a multiple of 020000 (8 KB). Default 120000. */
  memory?: number;
  /** Registers (060 bytes). Default 176600. */
  base?: number;
  /** Default 320. */
  vector?: number;
  /** Bus request level. Default 4. */
  level?: number;
  /** CPU cycles per frame. Default 20000. */
  frameCycles?: number;
  /** Cycles of vertical blank at the start of each frame. Default `frameCycles / 8`, rounded down. */
  blankCycles?: number;
  /** `'instant'` (default): the page is latched at the blank. `'scan'`: rows as the beam passes them (tearing). */
  beam?: Beam;
}

/** A latched picture, handed to the host at a vertical blank. */
export interface Frame {
  /** 64 or 128: the mode latched with this frame. */
  width: number;
  height: number;
  /** Colour indexes 0–17, row by row. */
  pixels: Uint8Array;
  /**
   * The palette each row was latched with (RGB 3-3-3): row y's 16 entries start at `16 * y`.
   * With the instant beam every row has the same palette.
   */
  palette: Uint16Array;
  /** The `DSPFRM` value of this frame. */
  number: number;
}

/** A display saved as plain data (survives `JSON.stringify`). */
export interface DisplayState {
  memory: number[];
  palette: number[];
  csr: number;
  frameNumber: number;
  /** Cycles since the start of the current frame (its blank). */
  phase: number;
  /** PAGE and MODE latched at the last blank: what the beam reads. */
  page: number;
  mode: number;
  /** Scanning beam: rows latched so far in this frame, and the picture being composed. */
  rows: number;
  scanPixels: number[];
  scanPalette: number[];
  frame: { width: number; height: number; number: number; pixels: number[]; palette: number[] };
}

const WINDOW = 0o40000; // 16 KB
const REGS = 0o60;
const PAL = 0o20;
const PAGE = 3;
const MODE = 4;
const CS_BITS = PAGE | MODE | CSR.IE;

export class Display {
  readonly memoryBase: number;
  readonly base: number;
  readonly vector: number;
  readonly level: number;
  readonly frameCycles: number;
  readonly blankCycles: number;
  readonly beam: Beam;

  /** The pixel window, a `Device` (plug it in with `machine.add`). */
  readonly memory: Device;
  /** The registers, a `Device`. */
  readonly control: Device;
  /** Pixel memory, as the program sees it. The host may read it (no side effects). */
  readonly bytes = new Uint8Array(WINDOW);
  /** The 16 palette entries now (RGB 3-3-3). */
  readonly palette = new Uint16Array(16);
  /** The last latched frame. */
  frame!: Frame;
  /** Called at each vertical blank with the new frame. */
  onFrame: ((frame: Frame) => void) | null = null;

  private cpu: Cpu | null = null;
  private csr = 0;
  private frameNumber = 0;
  private phase = 0;
  private page = 0;
  private mode = 0;
  private rows = 0;
  private readonly scanPixels = new Uint8Array(128 * 128);
  private readonly scanPalette = new Uint16Array(16 * 128);

  constructor(opts: DisplayOptions = {}) {
    this.memoryBase = opts.memory ?? DSP.SCREEN;
    this.base = opts.base ?? DSP.DSPCS;
    this.vector = opts.vector ?? DSP.VEC;
    this.level = opts.level ?? 4;
    this.frameCycles = opts.frameCycles ?? 20000;
    this.blankCycles = opts.blankCycles ?? Math.floor(this.frameCycles / 8);
    this.beam = opts.beam ?? 'instant';
    const mb = this.memoryBase;
    if (!Number.isInteger(mb) || mb < 0 || mb % 0o20000 || mb + WINDOW > 0x10000) {
      throw new Error(`Display: pixel memory at ${mb.toString(8)} must start at a multiple of 020000 (8 KB) and end by 177777`);
    }
    if (!Number.isInteger(this.base) || this.base & 1 || this.base < 0 || this.base + REGS > 0x10000) {
      throw new Error(`Display: registers at ${this.base.toString(8)} must be even, with 060 bytes below 200000`);
    }
    if (!Number.isInteger(this.frameCycles) || this.frameCycles < 1) throw new Error('Display: frameCycles must be a whole number, at least 1');
    if (!Number.isInteger(this.blankCycles) || this.blankCycles < 0 || this.blankCycles >= this.frameCycles) {
      throw new Error('Display: blankCycles must be a whole number from 0 to frameCycles - 1');
    }
    if (this.beam !== 'instant' && this.beam !== 'scan') throw new Error(`Display: beam must be 'instant' or 'scan'`);

    const d = this;
    const bytes = this.bytes;
    this.memory = {
      base: mb,
      size: WINDOW,
      read: (offset) => bytes[offset] | (bytes[offset + 1] << 8),
      write: (offset, value, byte) => {
        bytes[offset] = value & 0xff;
        if (!byte) bytes[offset + 1] = value >> 8;
        return true;
      },
    };
    this.control = {
      base: this.base,
      size: REGS,
      attach: (cpu) => { d.cpu = cpu; },
      read: (offset) => d.readReg(offset),
      write: (offset, value, byte) => d.writeReg(offset, value, byte),
      reset: (powerUp) => d.reset(powerUp),
      advance: (cycles) => d.advance(cycles),
      nextEvent: () => d.nextChange() - d.phase,
      wakeIn: () => (d.csr & CSR.IE ? d.frameCycles - d.phase : Infinity),
      canWake: () => (d.csr & CSR.IE) !== 0,
    };
    this.reset(true);
  }

  /** Rows of the mode the beam reads now (latched at the last blank). */
  get height(): number { return this.mode ? 128 : 64; }

  /** What `DSPLIN` reads: the row the beam is on, or 177777 during the vertical blank. */
  get line(): number {
    const p = this.phase;
    const B = this.blankCycles;
    if (p < B) return 0o177777;
    const H = this.height;
    // The largest r with T(r) <= p, i.e. r * (F - B) < (p - B + 1) * H.
    return Math.min(H - 1, Math.floor(((p - B + 1) * H - 1) / (this.frameCycles - B)));
  }

  /** Save the device as plain data. */
  state(): DisplayState {
    const f = this.frame;
    return {
      memory: [...this.bytes], palette: [...this.palette], csr: this.csr, frameNumber: this.frameNumber,
      phase: this.phase, page: this.page, mode: this.mode, rows: this.rows,
      scanPixels: [...this.scanPixels], scanPalette: [...this.scanPalette],
      frame: { width: f.width, height: f.height, number: f.number, pixels: [...f.pixels], palette: [...f.palette] },
    };
  }

  /** Restore a saved state (of a display with the same options). Pending interrupts are the CPU's. */
  load(s: DisplayState): void {
    this.bytes.set(s.memory);
    this.palette.set(s.palette);
    this.csr = s.csr;
    this.frameNumber = s.frameNumber;
    this.phase = s.phase;
    this.page = s.page;
    this.mode = s.mode;
    this.rows = s.rows;
    this.scanPixels.set(s.scanPixels);
    this.scanPalette.set(s.scanPalette);
    const f = s.frame;
    this.frame = { width: f.width, height: f.height, number: f.number, pixels: Uint8Array.from(f.pixels), palette: Uint16Array.from(f.palette) };
  }

  // ---------------------------------------------------------------- registers

  private readReg(offset: number): number {
    if (offset === 0) return this.csr;
    if (offset === 2) return this.frameNumber;
    if (offset === 4) return this.line;
    if (offset >= PAL) return this.palette[(offset - PAL) >> 1];
    return BUS_ERROR; // the hole 176606–176616
  }

  private writeReg(offset: number, value: number, byte: boolean): boolean {
    if (offset >= PAL) {
      const i = (offset - PAL) >> 1;
      const p = this.palette[i];
      if (!byte) this.palette[i] = value & 0o777;
      else if (offset & 1) this.palette[i] = (p & 0xff) | ((value & 1) << 8);
      else this.palette[i] = (p & 0x100) | value;
      return true;
    }
    if (offset >= 6) return false; // the hole
    if (offset >= 2) return true; // DSPFRM, DSPLIN: read only
    if (byte && offset & 1) return true; // the high byte of DSPCS
    this.csr = (this.csr & CSR.DONE) | (value & CS_BITS);
    if (!(value & CSR.DONE)) this.csr &= ~CSR.DONE;
    if (!(this.csr & CSR.IE)) this.cpu?.cancelInterrupt(this.vector);
    return true;
  }

  private reset(powerUp: boolean): void {
    this.cpu?.cancelInterrupt(this.vector);
    if (!powerUp) {
      this.csr &= ~CSR.IE;
      return;
    }
    this.bytes.fill(0);
    this.palette.set(DEFAULT_PALETTE);
    this.csr = 0;
    this.frameNumber = 0;
    this.phase = 0;
    this.page = 0;
    this.mode = 0;
    this.rows = 0;
    this.scanPixels.fill(0);
    for (let r = 0; r < 128; r++) this.scanPalette.set(DEFAULT_PALETTE, 16 * r);
    this.frame = {
      width: 64, height: 64, number: 0, pixels: new Uint8Array(64 * 64), palette: this.scanPalette.slice(0, 16 * 64),
    };
  }

  // ---------------------------------------------------------------- time

  /** T(r): the cycle in the frame at which the beam reaches row r (T(H) = frameCycles). */
  private rowStart(r: number): number {
    const H = this.height;
    if (r >= H) return this.frameCycles;
    return this.blankCycles + Math.floor((r * (this.frameCycles - this.blankCycles)) / H);
  }

  /** The next cycle in the frame at which DSPLIN changes, a row is latched, or the blank comes. */
  private nextChange(): number {
    if (this.phase < this.blankCycles) return this.blankCycles;
    return this.rowStart(this.line + 1);
  }

  private advance(cycles: number): void {
    while (cycles > 0) {
      const step = Math.min(cycles, this.nextChange() - this.phase);
      this.phase += step;
      cycles -= step;
      this.catchUp();
    }
  }

  /** Latch the rows the beam has passed, and the blank if it has come. */
  private catchUp(): void {
    if (this.beam === 'scan') {
      while (this.rows < this.height && this.rowStart(this.rows + 1) <= this.phase) this.latchRow(this.rows++);
    }
    if (this.phase >= this.frameCycles) {
      this.phase -= this.frameCycles;
      this.blank();
      this.catchUp();
    }
  }

  /** Scanning beam: copy row r of the page being shown, with the palette as it is now. */
  private latchRow(r: number): void {
    const W = this.height;
    this.copyRow(r, this.scanPixels.subarray(r * W, r * W + W));
    this.scanPalette.set(this.palette, 16 * r);
  }

  /** Row r of the latched page, read the way the latched mode says, as colour indexes. */
  private copyRow(r: number, out: Uint8Array): void {
    const b = this.bytes;
    if (this.mode) {
      const at = (this.page & 1) * 0o20000 + r * 0o100;
      for (let i = 0; i < 64; i++) {
        const v = b[at + i];
        out[2 * i] = v & 15;
        out[2 * i + 1] = v >> 4;
      }
    } else {
      const at = this.page * 0o10000 + r * 0o100;
      for (let x = 0; x < 64; x++) out[x] = b[at + x] & 15;
    }
  }

  private blank(): void {
    const scanned = this.beam === 'scan';
    let frame: Frame;
    if (scanned) {
      // The picture the beam composed during the frame that just ended.
      const H = this.height;
      frame = { width: H, height: H, number: 0, pixels: this.scanPixels.slice(0, H * H), palette: this.scanPalette.slice(0, 16 * H) };
    }
    // PAGE and MODE take effect now.
    this.page = this.csr & PAGE;
    this.mode = this.csr & MODE ? 1 : 0;
    this.rows = 0;
    if (!scanned) {
      const H = this.height;
      const pixels = new Uint8Array(H * H);
      for (let r = 0; r < H; r++) this.copyRow(r, pixels.subarray(r * H, r * H + H));
      const palette = new Uint16Array(16 * H);
      for (let r = 0; r < H; r++) palette.set(this.palette, 16 * r);
      frame = { width: H, height: H, number: 0, pixels, palette };
    }
    this.frameNumber = (this.frameNumber + 1) & 0xffff;
    frame!.number = this.frameNumber;
    this.frame = frame!;
    this.csr |= CSR.DONE;
    if (this.csr & CSR.IE) this.cpu?.interrupt(this.vector, this.level);
    this.onFrame?.(this.frame);
  }
}

/**
 * A frame as RGBA bytes, row by row (for a canvas `ImageData`). Writes into `out` if given
 * (it must hold `width * height * 4` bytes).
 */
export function frameToRgba(frame: Frame, out = new Uint8ClampedArray(frame.width * frame.height * 4)): Uint8ClampedArray {
  const { width, height, pixels, palette } = frame;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const v = palette[16 * y + pixels[i]];
      out[4 * i] = LEVELS[(v >> 6) & 7];
      out[4 * i + 1] = LEVELS[(v >> 3) & 7];
      out[4 * i + 2] = LEVELS[v & 7];
      out[4 * i + 3] = 255;
    }
  }
  return out;
}
