/**
 * The speaker in the browser: queues the samples src/audio.ts makes into Web Audio, a little
 * ahead of the audio clock, and rings the console's bell. The audio starts on a click (Run),
 * as browsers require. Wall-clock time is used only here, to schedule the samples.
 */

import type { SoundChunk } from 'blue11';
import { Resampler } from './audio';

/** How far ahead of the audio clock samples are queued (seconds), and the most allowed. */
const LEAD = 0.05;
const MAX_LEAD = 0.25;

export class Speaker {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private resampler: Resampler | null = null;
  private next = 0;
  /** The buffers queued and not yet ended, so a pause or a change of speed can cut them off. */
  private queued = new Set<AudioBufferSourceNode>();
  private lastBell = -1;
  private vol = 0.25;
  private muted = false;

  /** Make the audio context: call it from a click. Does nothing without Web Audio. */
  start(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      this.resampler = new Resampler(this.ctx.sampleRate);
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** The volume, 0–1, and mute. */
  set volume(v: number) { this.vol = v; this.applyVolume(); }
  set mute(on: boolean) { this.muted = on; this.applyVolume(); }

  private applyVolume(): void {
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.vol;
  }

  /**
   * Play a chunk of the speaker, right after the last one, with the machine running at
   * `cyclesPerSecond` of wall time: away from real time it is slower and lower, or faster and higher.
   */
  play(chunk: SoundChunk, cyclesPerSecond: number): void {
    if (!this.ctx || !this.resampler || !this.gain) return;
    this.resampler.cyclesPerSecond = cyclesPerSecond;
    const samples = this.resampler.push(chunk);
    if (!samples.length) return;
    const now = this.ctx.currentTime;
    // Fallen behind (a hidden tab, a slow frame) or too far ahead: start again from now.
    // At a slow speed a frame lasts longer than MAX_LEAD, so the limit counts from the queue's end.
    const most = now + Math.max(MAX_LEAD, samples.length / this.ctx.sampleRate + LEAD);
    if (this.next < now || this.next > most) { this.cut(); this.next = now + LEAD; }
    const buf = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buf.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    src.start(this.next);
    this.queued.add(src);
    src.onended = () => this.queued.delete(src);
    this.next += samples.length / this.ctx.sampleRate;
  }

  /** Stop what is queued (paused, the speed changed): at a slow speed that can be seconds. */
  cut(): void {
    for (const src of this.queued) { try { src.stop(); } catch { /* not started */ } }
    this.queued.clear();
    this.next = 0;
  }

  /** Not playing this chunk (paused, stepping): the next one starts in silence. */
  skip(chunk: SoundChunk): void {
    const last = chunk.edges.at(-1);
    this.resampler?.skip(chunk.to, last ? last.level : chunk.level);
  }

  /** The console's bell: a short tone, at most one every 100 ms. */
  bell(): void {
    if (!this.ctx || !this.gain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastBell < 0.1) return;
    this.lastBell = now;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    env.gain.setValueAtTime(0.5, now);
    env.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
    osc.connect(env).connect(this.gain);
    osc.start(now);
    osc.stop(now + 0.12);
  }
}
