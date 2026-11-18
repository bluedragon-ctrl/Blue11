/**
 * The Blue-11 sound device: a one-bit speaker (docs/BLUE11_SOUND.md at the repository root).
 * DEC made no such device. `SNDCS` bit 0 is the speaker (the beeper); `SNDDIV`, when not 0,
 * is a half period in cycles, and a tone generator then drives the speaker by itself.
 *
 * The device makes no sound. It records *edges*, the cycles at which the speaker moved, each at
 * the exact cycle of the bus write that made it (through the clock {@link DeviceMachine} gives
 * its devices), and the host plays them. Time is CPU cycles; the state survives JSON.
 */

import { BUS_ERROR } from './cpu.js';
import type { Device } from './devices.js';

/** Default addresses of the sound device (octal). */
export const SND = { SNDCS: 0o176740, SNDDIV: 0o176742 } as const;

/** The speaker moved at `cycle` (counted from power-up) to `level`: 1 out, 0 in. */
export interface Edge {
  cycle: number;
  level: 0 | 1;
}

/**
 * The speaker from cycle `from` to `to`: at `level` at `from`, then moving at each edge
 * (in order, `from` < cycle ≤ `to`). Consecutive {@link Sound.take} calls follow each other
 * with no gap, unless the oldest edges were dropped (`dropped`): `from` then starts later.
 */
export interface SoundChunk {
  from: number;
  to: number;
  level: 0 | 1;
  edges: Edge[];
  /** Edges lost since the last take, because more than `maxEdges` were waiting. */
  dropped: number;
}

export interface SoundOptions {
  /** `SNDCS`, `SNDDIV`, then a hole to +037. Default 176740. */
  base?: number;
  /** Edges kept until the host takes them; past this, the oldest are dropped. Default 65536. */
  maxEdges?: number;
}

/** A sound device saved as plain data (survives `JSON.stringify`). */
export interface SoundState {
  /** Cycles since power-up, as far as the machine has advanced the device. */
  cycle: number;
  out: 0 | 1;
  div: number;
  /** The speaker now (the generator's level while it runs, else `out`). */
  level: 0 | 1;
  /** The generator: running, the half period in force, the cycle of its next switch. */
  running: boolean;
  half: number;
  next: number;
  /** Where the edges waiting for the host start. */
  from: number;
  fromLevel: 0 | 1;
  edges: Edge[];
  dropped: number;
}

const SIZE = 0o40;

export class Sound implements Device {
  readonly base: number;
  readonly size = SIZE;
  readonly maxEdges: number;

  private clock: (() => number) | null = null;
  private t = 0;
  private out: 0 | 1 = 0;
  private div = 0;
  private lvl: 0 | 1 = 0;
  private running = false;
  private half = 0;
  private next = 0;
  private from = 0;
  private fromLevel: 0 | 1 = 0;
  private edges: Edge[] = [];
  /** Index of the first edge kept in `edges` (the ones before it are dropped). */
  private head = 0;
  private dropped = 0;

  constructor(opts: SoundOptions = {}) {
    this.base = opts.base ?? SND.SNDCS;
    this.maxEdges = opts.maxEdges ?? 65536;
    if (!Number.isInteger(this.base) || this.base & 1 || this.base < 0 || this.base + SIZE > 0x10000) {
      throw new Error(`Sound: registers at ${this.base.toString(8)} must be even, with 40 bytes below 200000`);
    }
    if (!Number.isInteger(this.maxEdges) || this.maxEdges < 1) throw new Error('Sound: maxEdges must be a whole number, at least 1');
  }

  /** The speaker now: 1 out, 0 in. */
  get level(): 0 | 1 {
    this.catchUp(this.now());
    return this.lvl;
  }

  /**
   * The speaker since the last take (or power-up) up to the cycle now, with its edges; the
   * waiting edges are then forgotten. A host calls it after each frame and plays the result.
   */
  take(): SoundChunk {
    const to = this.now();
    this.catchUp(to);
    const chunk: SoundChunk = {
      from: this.from, to, level: this.fromLevel, edges: this.edges.slice(this.head), dropped: this.dropped,
    };
    this.edges = [];
    this.head = 0;
    this.dropped = 0;
    this.from = to;
    this.fromLevel = this.lvl;
    return chunk;
  }

  /** Save the device as plain data. */
  state(): SoundState {
    return {
      cycle: this.t, out: this.out, div: this.div, level: this.lvl, running: this.running, half: this.half,
      next: this.next, from: this.from, fromLevel: this.fromLevel, edges: this.edges.slice(this.head).map((e) => ({ ...e })),
      dropped: this.dropped,
    };
  }

  /** Restore a saved state (of a device with the same options). */
  load(s: SoundState): void {
    this.t = s.cycle;
    this.out = s.out;
    this.div = s.div;
    this.lvl = s.level;
    this.running = s.running;
    this.half = s.half;
    this.next = s.next;
    this.from = s.from;
    this.fromLevel = s.fromLevel;
    this.edges = s.edges.map((e) => ({ ...e }));
    this.head = 0;
    this.dropped = s.dropped;
  }

  // ---------------------------------------------------------------- Device

  attach(_cpu: unknown, clock?: () => number): void { this.clock = clock ?? null; }

  read(offset: number): number {
    if (offset === 0) return this.out;
    if (offset === 2) return this.div;
    return BUS_ERROR; // the hole
  }

  write(offset: number, value: number, byte: boolean): boolean {
    if (offset > 3) return false; // the hole
    const t = this.now();
    this.catchUp(t);
    if (offset < 2) {
      if (offset === 1) return true; // SNDCS's high byte keeps nothing
      this.out = (value & 1) as 0 | 1;
      if (!this.running) this.move(t, this.out);
      return true;
    }
    let v = value;
    if (byte) v = offset === 3 ? ((value & 0xff) << 8) | (this.div & 0xff) : (this.div & 0xff00) | (value & 0xff);
    this.setDiv(t, v & 0xffff);
    return true;
  }

  reset(powerUp: boolean): void {
    if (powerUp) {
      this.t = 0;
      this.out = 0;
      this.div = 0;
      this.lvl = 0;
      this.running = false;
      this.from = 0;
      this.fromLevel = 0;
      this.edges = [];
      this.head = 0;
      this.dropped = 0;
      return;
    }
    // RESET silences: the generator stops and the speaker goes in.
    const t = this.now();
    this.catchUp(t);
    this.out = 0;
    this.setDiv(t, 0);
    this.move(t, 0);
  }

  advance(cycles: number): void { this.t += cycles; }

  // The device changes nothing a program can see by itself: it never stops the CPU.
  nextEvent(): number { return Infinity; }

  // ---------------------------------------------------------------- inside

  /** The cycle now: the machine's clock, or (hosted without one) the cycles advanced. */
  private now(): number { return this.clock ? this.clock() : this.t; }

  private setDiv(t: number, v: number): void {
    this.div = v;
    if (v === 0) {
      if (!this.running) return;
      this.running = false;
      this.move(t, this.out); // back to the bit
    } else if (!this.running) {
      this.running = true;
      this.half = v;
      this.next = t + v;
      this.move(t, 1); // it starts out
    }
    // Running: the new half period takes effect at the next switch (catchUp).
  }

  /** The generator's switches up to and including cycle `t`. */
  private catchUp(t: number): void {
    if (!this.running || this.next > t) return;
    // The first switch ends the half period in force; after it, every half is `div`.
    this.move(this.next, (this.lvl ^ 1) as 0 | 1);
    this.half = this.div;
    this.next += this.half;
    if (this.next > t) return;
    // Many switches with nothing to see in between: skip those the buffer would drop anyway.
    const n = Math.floor((t - this.next) / this.half) + 1;
    const skip = n - Math.min(n, this.maxEdges);
    if (skip > 0) {
      const at = this.next + (skip - 1) * this.half;
      const level = (skip & 1 ? this.lvl ^ 1 : this.lvl) as 0 | 1;
      this.dropped += this.edges.length - this.head + skip;
      this.edges = [];
      this.head = 0;
      this.from = at;
      this.fromLevel = level;
      this.lvl = level;
      this.next = at + this.half;
    }
    while (this.next <= t) {
      this.move(this.next, (this.lvl ^ 1) as 0 | 1);
      this.next += this.half;
    }
  }

  /** The speaker goes to `level` at cycle `t` (an edge, if it moves). */
  private move(t: number, level: 0 | 1): void {
    if (level === this.lvl) return;
    this.lvl = level;
    this.edges.push({ cycle: t, level });
    if (this.edges.length - this.head > this.maxEdges) {
      const e = this.edges[this.head++];
      this.from = e.cycle;
      this.fromLevel = e.level;
      this.dropped++;
      if (this.head >= this.maxEdges) { this.edges = this.edges.slice(this.head); this.head = 0; }
    }
  }
}
