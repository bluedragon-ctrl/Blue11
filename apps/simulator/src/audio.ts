/**
 * The speaker's sound, without the DOM (so it is tested): the sound device's edges turned into
 * audio samples, the last frame's edges kept for the waveform view, and when the page plays
 * (docs/BLUE11_SOUND.md §7.1). The page (src/speaker.ts) hands the samples to Web Audio.
 *
 * Time comes in as cycles; only here, in the host, do cycles become seconds.
 */

import type { Edge, SoundChunk } from 'blue11';
import { CPU_HZ } from './time';

/** The share of `[a, b)` the speaker was out, given its level at `from` and the edges after it. */
function outShare(level: 0 | 1, edges: readonly Edge[], start: number, a: number, b: number): { share: number; level: 0 | 1; start: number } {
  // `start`: the index of the first edge after a; `level`: the level at a.
  let out = 0;
  let t = a;
  let i = start;
  let l = level;
  while (i < edges.length && edges[i].cycle < b) {
    if (l) out += edges[i].cycle - t;
    t = edges[i].cycle;
    l = edges[i].level;
    i++;
  }
  if (l) out += b - t;
  return { share: out / (b - a), level: l, start: i };
}

/**
 * Edges to samples at `sampleRate`: each sample is the share of its cycles the speaker was out
 * (a box filter), then a gentle high-pass filter, so a speaker left out or in is silence.
 * Samples run on from chunk to chunk; `skip` jumps over time not played.
 */
export class Resampler {
  /** Cycles per sample: 25 at 48 kHz and the machine's native speed. */
  private stepCycles: number;
  /** The cycle where the next sample starts (fractional). */
  private pos = 0;
  /** The filter's last input and output: it starts with the speaker in, in silence. */
  private prevIn = -1;
  private prevOut = 0;
  private readonly a: number;

  constructor(readonly sampleRate: number, cyclesPerSecond = CPU_HZ, cutoffHz = 20) {
    this.stepCycles = cyclesPerSecond / sampleRate;
    const rc = 1 / (2 * Math.PI * cutoffHz);
    this.a = rc / (rc + 1 / sampleRate);
  }

  get step(): number { return this.stepCycles; }

  /**
   * The machine's speed against the wall clock, in cycles per second: away from its native speed
   * (1200000) the sound plays slower and lower, or faster and higher, like a tape.
   */
  set cyclesPerSecond(c: number) { this.stepCycles = c / this.sampleRate; }
  get cyclesPerSecond(): number { return this.stepCycles * this.sampleRate; }

  /** The samples for a chunk (values about −1 to 1). After a gap, it starts again at the chunk. */
  push(chunk: SoundChunk): Float32Array<ArrayBuffer> {
    // Following on, the last sample ended at most one sample before the chunk starts; the
    // speaker's level there is the chunk's `level`.
    if (chunk.dropped || this.pos > chunk.from || this.pos < chunk.from - this.step) {
      this.pos = chunk.from;
      this.prevIn = 2 * chunk.level - 1; // start in silence, not with a click
      this.prevOut = 0;
    }
    const n = Math.max(0, Math.floor((chunk.to - this.pos) / this.step));
    const out = new Float32Array(n);
    let level = chunk.level;
    let i = 0;
    for (let k = 0; k < n; k++) {
      const a = this.pos;
      const b = a + this.step;
      const r = outShare(level, chunk.edges, i, a, b);
      level = r.level;
      i = r.start;
      this.pos = b;
      const x = 2 * r.share - 1;
      const y = this.a * (this.prevOut + x - this.prevIn);
      this.prevIn = x;
      this.prevOut = y;
      out[k] = y;
    }
    return out;
  }

  /** Nothing is played up to cycle `to` (paused, stepping): start from there, in silence. */
  skip(to: number, level: 0 | 1): void {
    // Less than a sample not played is no gap: the next push goes on from here.
    if (this.pos > to - this.step) return;
    this.pos = to;
    this.prevIn = 2 * level - 1;
    this.prevOut = 0;
  }
}

/** The speaker over a stretch of time: the level at `from`, then the edges up to `to`. */
export interface Trace {
  from: number;
  to: number;
  level: 0 | 1;
  edges: Edge[];
}

/** The last `length` cycles of the speaker, for the waveform view. */
export class History {
  private trace: Trace = { from: 0, to: 0, level: 0, edges: [] };

  constructor(readonly length: number) {}

  /** Forget everything (a new run). */
  clear(): void { this.trace = { from: 0, to: 0, level: 0, edges: [] }; }

  push(chunk: SoundChunk): void {
    const t = this.trace;
    // A gap (dropped edges, or the first chunk): start again from the chunk.
    const base: Trace = chunk.from === t.to && !chunk.dropped ? t : { from: chunk.from, to: chunk.from, level: chunk.level, edges: [] };
    const edges = base.edges.concat(chunk.edges);
    const from = Math.max(base.from, chunk.to - this.length);
    let level = base.level;
    let i = 0;
    while (i < edges.length && edges[i].cycle <= from) { level = edges[i].level; i++; }
    this.trace = { from, to: chunk.to, level, edges: edges.slice(i) };
  }

  get(): Trace { return this.trace; }
}

/**
 * What the waveform view says about the last edges: the cycles between the last two, and the
 * frequency they make, or null with fewer than two.
 */
export function lastHalfPeriod(t: Trace, cyclesPerSecond = CPU_HZ): { cycles: number; hz: number } | null {
  const e = t.edges;
  if (e.length < 2) return null;
  const cycles = e[e.length - 1].cycle - e[e.length - 2].cycle;
  return { cycles, hz: cyclesPerSecond / (2 * cycles) };
}
