import type { SoundChunk } from 'blue11';
import { describe, expect, it } from 'vitest';
import { History, lastHalfPeriod, Resampler, shouldPlay } from '../src/audio';
import { Simulator } from '../src/sim';

const chunk = (from: number, to: number, level: 0 | 1, edges: Array<[number, 0 | 1]> = []): SoundChunk =>
  ({ from, to, level, edges: edges.map(([cycle, l]) => ({ cycle, level: l })), dropped: 0 });

describe('edges to samples', () => {
  it('a frame of 20000 cycles is 800 samples at 48 kHz, 735 at 44.1 kHz', () => {
    expect(new Resampler(48000).push(chunk(0, 20000, 0)).length).toBe(800);
    expect(new Resampler(48000).step).toBe(25);
    const r = new Resampler(44100);
    let n = 0;
    for (let f = 0; f < 60; f++) n += r.push(chunk(f * 20000, (f + 1) * 20000, 0)).length;
    expect(Math.abs(n - 44100)).toBeLessThanOrEqual(1); // frames follow on: a second is a second
  });

  it('a sample is the share of its cycles the speaker was out (before the filter)', () => {
    // no filter to speak of: a very low cutoff
    const r = new Resampler(48000, 1_200_000, 0.0001);
    // out for cycles 25–38: 13 of the second sample's 25
    const s = r.push(chunk(0, 100, 0, [[25, 1], [38, 0]]));
    expect(s[0]).toBeCloseTo(0, 3); // in, as at the start: silence
    expect(s[1]).toBeCloseTo(2 * (13 / 25), 2); // 13 of 25 cycles out: the step up from in
  });

  it('a level that never changes is silence after the filter', () => {
    const r = new Resampler(48000);
    let last = 1;
    for (let f = 0; f < 30; f++) {
      const s = r.push(chunk(f * 20000, (f + 1) * 20000, 1, f === 0 ? [[1, 1]] : []));
      last = s[s.length - 1];
    }
    expect(Math.abs(last)).toBeLessThan(0.01);
  });

  it('a square wave comes out as one, at its pitch', () => {
    const r = new Resampler(48000);
    const edges: Array<[number, 0 | 1]> = [];
    for (let c = 1364, l: 0 | 1 = 1; c < 20000 * 10; c += 1364, l = (l ^ 1) as 0 | 1) edges.push([c, l]);
    const s = r.push(chunk(0, 200000, 0, edges));
    // the sign changes about every 1364 / 25 = 54.6 samples
    let changes = 0;
    for (let i = 1000; i < s.length; i++) if (Math.sign(s[i]) !== Math.sign(s[i - 1])) changes++;
    expect(changes).toBeGreaterThan(((s.length - 1000) / 54.56) * 0.9);
    expect(changes).toBeLessThan(((s.length - 1000) / 54.56) * 1.1);
  });

  it('after a skip, or a restart from cycle 0, it starts at the new chunk', () => {
    const r = new Resampler(48000);
    r.push(chunk(0, 20000, 0));
    r.skip(100000, 0);
    expect(r.push(chunk(100000, 120000, 0)).length).toBe(800);
    expect(r.push(chunk(0, 20000, 0)).length).toBe(800); // boot: cycles start again
  });
});

describe('when sound plays', () => {
  it('only while running at 60 frames a second', () => {
    expect(shouldPlay(true, 60)).toBe(true);
    for (const fps of [1, 30, 120, 600]) expect(shouldPlay(true, fps)).toBe(false);
    expect(shouldPlay(false, 60)).toBe(false);
  });
});

describe('the waveform history', () => {
  it('keeps the last frame of edges, with the level where it starts', () => {
    const h = new History(20000);
    h.push(chunk(0, 20000, 0, [[100, 1], [15000, 0]]));
    h.push(chunk(20000, 40000, 0, [[30000, 1]]));
    const t = h.get();
    expect(t).toEqual({ from: 20000, to: 40000, level: 0, edges: [{ cycle: 30000, level: 1 }] });
    h.push(chunk(40000, 45000, 1));
    expect(h.get().from).toBe(25000);
    expect(h.get().edges).toHaveLength(1);
  });

  it('starts again after a gap', () => {
    const h = new History(20000);
    h.push(chunk(0, 20000, 0, [[100, 1]]));
    h.push(chunk(0, 5000, 0, [[10, 1]])); // a new boot
    expect(h.get()).toEqual({ from: 0, to: 5000, level: 0, edges: [{ cycle: 10, level: 1 }] });
  });

  it('measures the last half period', () => {
    expect(lastHalfPeriod({ from: 0, to: 9, level: 0, edges: [] })).toBeNull();
    const t = { from: 0, to: 5000, level: 0 as const, edges: [{ cycle: 100, level: 1 as const }, { cycle: 1464, level: 0 as const }] };
    expect(lastHalfPeriod(t)!.cycles).toBe(1364);
    expect(lastHalfPeriod(t)!.hz).toBeCloseTo(439.88, 1);
  });
});

describe('the simulator and the speaker', () => {
  it('takeSound gives the edges since the last call, and the history keeps them', () => {
    const sim = new Simulator();
    expect(sim.load(' MOV #100., @#SNDDIV\n1$: BR 1$')).toEqual([]);
    sim.runFrame();
    const c = sim.takeSound();
    expect(c.from).toBe(0);
    expect(c.to).toBe(20000);
    expect(c.edges.length).toBe(200);
    expect(sim.history.get().edges.length).toBe(200);
    expect(sim.takeSound().edges).toEqual([]);
    sim.restart();
    expect(sim.history.get().edges).toEqual([]);
    expect(sim.takeSound().to).toBe(0);
  });

  it('counts the BELs the program prints', () => {
    const sim = new Simulator();
    expect(sim.load(' MOVB #7, @#XBUF\n1$: TSTB @#XCSR\n BPL 1$\n MOVB #7, @#XBUF\n HALT')).toEqual([]);
    sim.runFrame();
    expect(sim.bells).toBe(2);
    sim.restart();
    expect(sim.bells).toBe(0);
  });

  it('replays make the same sound', () => {
    const sim = new Simulator();
    expect(sim.load(`
1$:     TSTB @#KBDKEY+'A    ; A down: the generator plays
        BPL  2$
        MOV  #500., @#SNDDIV
        BR   1$
2$:     CLR  @#SNDDIV
        BR   1$
`)).toEqual([]);
    const edges: number[] = [];
    for (let f = 0; f < 6; f++) {
      if (f === 1) sim.press('KeyA');
      if (f === 3) sim.release('KeyA');
      sim.runFrame();
      edges.push(...sim.takeSound().edges.map((e) => e.cycle));
    }
    sim.replay();
    const again: number[] = [];
    for (let f = 0; f < 6; f++) { sim.runFrame(); again.push(...sim.takeSound().edges.map((e) => e.cycle)); }
    expect(edges.length).toBeGreaterThan(50);
    expect(again).toEqual(edges);
  });
});
