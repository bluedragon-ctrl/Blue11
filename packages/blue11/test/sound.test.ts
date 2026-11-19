import { describe, expect, it } from 'vitest';
import { DeviceMachine, SimpleMachine, SND, Sound, type Edge, type SoundChunk, type SoundOptions } from '../src/index.js';
import { SCALE, SIM_SYMBOLS, SOUND_EXAMPLES } from '../examples/examples.js';
import { assembleOk } from './helpers/asm';
import { uncommentedLines } from './helpers/comments';

const SYMBOLS = { SNDCS: SND.SNDCS, SNDDIV: SND.SNDDIV, LKS: 0o177546 };

/** A SimpleMachine with the sound device, booted with `src` at 1000 (not run yet). */
function boot(src: string, sound: SoundOptions = {}, opts: { flat?: boolean } = {}) {
  const m = new SimpleMachine({ sound, clockCycles: 20000, cycles: opts.flat ? 'flat' : undefined });
  m.boot(assembleOk(src, { symbols: SYMBOLS, origin: 0o1000 }));
  return { m, s: m.sound! };
}

/** A machine with the sound device and no program: the host writes the bus itself. */
function bare(sound: SoundOptions = {}) {
  const m = new SimpleMachine({ sound });
  m.boot(assembleOk(' HALT'));
  return { m, s: m.sound! };
}

const gaps = (edges: Edge[]) => edges.slice(1).map((e, i) => e.cycle - edges[i].cycle);
const levels = (edges: Edge[]) => edges.map((e) => e.level);

const BEEPER = `
        MOV  #SNDCS, R2
        MOV  #1, R1
TONE:   XOR  R1, (R2)
        MOV  #1358., R0
1$:     SOB  R0, 1$
        BR   TONE
`;

describe('blue11 Sound: the bit', () => {
  it('sits at 176740 with a hole to 176777, and is in SimpleMachine only when asked for', () => {
    const { s } = bare();
    expect([s.base, s.size]).toEqual([0o176740, 0o40]);
    expect(new SimpleMachine().sound).toBeNull();
    const { m } = bare();
    for (let a = 0o176744; a < 0o177000; a += 2) {
      expect(m.read(a, false)).toBeLessThan(0);
      expect(m.write(a, 0, false)).toBe(false);
    }
  });

  it('keeps only bit 0 of SNDCS; the high byte takes nothing', () => {
    const { m, s } = bare();
    m.write(SND.SNDCS, 0o177777, false);
    expect(m.read(SND.SNDCS, false)).toBe(1);
    m.write(SND.SNDCS + 1, 0o377, true);
    expect(m.read(SND.SNDCS, false)).toBe(1);
    m.write(SND.SNDCS, 0o376, true);
    expect(m.read(SND.SNDCS, false)).toBe(0);
    expect(s.level).toBe(0);
  });

  it('XOR, INC, COM, BIS and BIC each switch or set it', () => {
    const { m, s } = boot(`
        MOV  #1, R1
        XOR  R1, @#SNDCS
        XOR  R1, @#SNDCS
        INC  @#SNDCS
        COM  @#SNDCS
        BIS  #1, @#SNDCS
        BIC  #1, @#SNDCS
        BIC  #1, @#SNDCS
        HALT
`);
    m.run(1000);
    // the second BIC writes the level the speaker already has: no edge
    expect(levels(s.take().edges)).toEqual([1, 0, 1, 0, 1, 0]);
  });

  it('a program in a hole traps to 4', () => {
    const { m } = boot(' CLR @#176744\n HALT');
    m.cpu.onTrap = () => 'stop';
    const r = m.run(100);
    expect(r.reason).toBe('trap');
    expect(r.trap?.vector).toBe(4);
  });
});

describe('blue11 Sound: the cycle of an edge', () => {
  it('is the cycle of the bus write: the beeper loop gives edges 1364 cycles apart', () => {
    const { m, s } = boot(BEEPER);
    m.run(20000);
    const c = s.take();
    // MOV #, R2 (2) + MOV #, R1 (2), then XOR's fetch and read: the write is cycle 6
    expect(c.edges[0]).toEqual({ cycle: 6, level: 1 });
    expect(new Set(gaps(c.edges))).toEqual(new Set([1364]));
    expect(levels(c.edges).slice(0, 4)).toEqual([1, 0, 1, 0]);
  });

  it('is the same whether the machine runs in one go, in frames, a cycle at a time, or by step', () => {
    const want = (() => { const { m, s } = boot(BEEPER); m.run(100000); return s.take().edges.filter((e) => e.cycle <= 90000); })();
    const ways: Array<(m: SimpleMachine) => void> = [
      (m) => { for (let i = 0; i < 5; i++) m.run(20000); },
      (m) => { while (m.cycles < 100000) m.run(1); },
      (m) => { while (m.cycles < 100000) m.step(); },
    ];
    for (const go of ways) {
      const { m, s } = boot(BEEPER);
      go(m);
      expect(s.take().edges.filter((e) => e.cycle <= 90000)).toEqual(want);
    }
  });

  it('XOR R1, @#SNDCS costs a cycle more: 1365 apart', () => {
    const { m, s } = boot(BEEPER.replace('XOR  R1, (R2)', 'XOR  R1, @#SNDCS'));
    m.run(20000);
    expect(new Set(gaps(s.take().edges))).toEqual(new Set([1365]));
  });

  it("with cycles: 'flat' it is the cycle the instruction starts at", () => {
    const { m, s } = boot(' MOV #1, R1\n XOR R1, @#SNDCS\n XOR R1, @#SNDCS\n HALT', {}, { flat: true });
    m.run(100);
    expect(s.take().edges).toEqual([{ cycle: 1, level: 1 }, { cycle: 2, level: 0 }]);
  });

  it('DeviceMachine.now is the cycle of the access in progress, and cycles between runs', () => {
    const m = new DeviceMachine();
    const seen: number[] = [];
    let clock: () => number = () => -1;
    m.add({ base: 0o176000, size: 2, attach: (_c, k) => { clock = k!; }, read: () => 0, write: () => { seen.push(clock()); return true; } });
    // MOV #1, @#176000: fetch 0, immediate 1, address 2, write 3; then the same again from 4
    m.boot(assembleOk(' MOV #1, @#176000\n MOV #1, @#176000\n HALT', { origin: 0o1000 }));
    m.run(100);
    expect(seen).toEqual([3, 7]);
    expect(m.now).toBe(m.cycles);
    expect(m.cpu.elapsed).toBe(0);
  });
});

describe('blue11 Sound: the tone generator', () => {
  it('starts out at the write, switches every SNDDIV cycles, and costs the CPU nothing', () => {
    const { m, s } = boot(' MOV #100., @#SNDDIV\n1$: BR 1$');
    m.run(1000);
    const c = s.take();
    expect(c.edges[0]).toEqual({ cycle: 3, level: 1 }); // MOV #, @#: fetch, immediate, address, then the write
    expect(new Set(gaps(c.edges))).toEqual(new Set([100]));
    expect(c.edges.at(-1)!.cycle).toBeLessThanOrEqual(c.to);
    expect(m.read(SND.SNDDIV, false)).toBe(100);
    expect(s.nextEvent()).toBe(Infinity);
  });

  it('ignores OUT while it runs; 0 stops it and the speaker goes back to OUT', () => {
    const { m, s } = bare();
    m.write(SND.SNDCS, 1, false); // out at cycle 0
    m.write(SND.SNDDIV, 10, false); // already out: no edge
    m.run(25); // HALT: the CPU stops, but time passes only as far as the run went
    m.write(SND.SNDCS, 0, false); // ignored while it runs
    expect(s.level).toBe(m.cycles % 20 < 10 ? 1 : 0);
    m.write(SND.SNDDIV, 0, false);
    expect(s.level).toBe(0); // OUT is 0 now
    expect(m.read(SND.SNDCS, false)).toBe(0);
  });

  it('a new half period takes effect at the next switch', () => {
    const { m, s } = boot(`
        MOV  #100., @#SNDDIV
        MOV  #50., R0
1$:     SOB  R0, 1$
        MOV  #30., @#SNDDIV
2$:     BR   2$
`);
    m.run(400);
    const c = s.take().edges.map((e) => e.cycle);
    // started at 3; the switch at 103 ends the half that was running, then every 30
    expect(c.slice(0, 5)).toEqual([3, 103, 133, 163, 193]);
  });

  it('a byte write changes one byte of SNDDIV', () => {
    const { m } = bare();
    m.write(SND.SNDDIV, 0o1234, false);
    m.write(SND.SNDDIV + 1, 0o7, true);
    expect(m.read(SND.SNDDIV, false)).toBe(0o3634);
    m.write(SND.SNDDIV, 0o0, true);
    expect(m.read(SND.SNDDIV, false)).toBe(0o3400);
  });
});

describe('blue11 Sound: take()', () => {
  it('covers time with no gaps; level is the level at from', () => {
    const { m, s } = boot(' MOV #300., @#SNDDIV\n1$: BR 1$');
    const chunks: SoundChunk[] = [];
    for (let i = 0; i < 5; i++) { m.run(1000); chunks.push(s.take()); }
    expect(chunks[0].from).toBe(0);
    for (let i = 1; i < 5; i++) {
      expect(chunks[i].from).toBe(chunks[i - 1].to);
      const prev = chunks[i - 1];
      expect(chunks[i].level).toBe(prev.edges.length ? prev.edges.at(-1)!.level : prev.level);
    }
    const all = chunks.flatMap((c) => c.edges);
    expect(new Set(gaps(all))).toEqual(new Set([300]));
    for (const c of chunks) for (const e of c.edges) { expect(e.cycle).toBeGreaterThan(c.from); expect(e.cycle).toBeLessThanOrEqual(c.to); }
  });

  it('past maxEdges the oldest are dropped, and from moves on to the oldest kept', () => {
    const { m, s } = boot(BEEPER.replace('1358.', '1.'), { maxEdges: 10 }); // an edge every 7 cycles
    m.run(1000);
    const c = s.take();
    expect(c.edges.length).toBe(10);
    expect(c.dropped).toBeGreaterThan(100);
    expect(c.level).toBe(c.edges[0].level ^ 1);
    expect(c.edges[0].cycle - c.from).toBe(7);
  });

  it('the generator left running for a long time keeps only the last maxEdges', () => {
    const { m, s } = boot(' MOV #1, @#SNDDIV\n WAIT', { maxEdges: 100 });
    m.run(50); // asleep, and nothing can wake it
    m.cpu.waiting = false;
    m.cpu.halted = false;
    m.cpu.r[7] = 0o1010; // spin on BR .
    m.write(0o1010, 0o777, false);
    m.run(10_000_000);
    const c = s.take();
    expect(c.edges.length).toBe(100);
    // started at cycle 3, then an edge every cycle up to `to`
    expect(c.edges.at(-1)!.cycle).toBe(c.to);
    expect(new Set(gaps(c.edges))).toEqual(new Set([1]));
    expect(c.dropped + 100).toBe(c.to - 3 + 1);
    expect(c.edges[0].cycle - c.from).toBe(1);
  });
});

describe('blue11 Sound: reset and state', () => {
  it('RESET silences: the generator stops and the speaker goes in', () => {
    const { m, s } = boot(' MOV #1, @#SNDCS\n MOV #100., @#SNDDIV\n RESET\n HALT');
    m.run(100);
    expect(m.read(SND.SNDDIV, false)).toBe(0);
    expect(m.read(SND.SNDCS, false)).toBe(0);
    const e = s.take().edges;
    expect(e.at(-1)!.level).toBe(0);
    expect(e.length).toBe(2);
  });

  it('power-up clears everything', () => {
    const { m, s } = boot(' MOV #100., @#SNDDIV\n1$: BR 1$');
    m.run(1000);
    m.boot(assembleOk(' HALT'));
    expect(s.take()).toEqual({ from: 0, to: 0, level: 0, edges: [], dropped: 0 });
    expect(m.read(SND.SNDDIV, false)).toBe(0);
  });

  it('state() → JSON → load() gives the same edges afterwards', () => {
    const a = boot(' MOV #1, R1\n MOV #77., @#SNDDIV\n1$: XOR R1, @#SNDCS\n BR 1$');
    a.m.run(5000);
    const cpu = a.m.cpu.save();
    const st = JSON.parse(JSON.stringify(a.s.state()));
    const cycles = a.m.cycles;
    a.m.run(5000);
    const want = a.s.take();

    const b = boot(' MOV #1, R1\n MOV #77., @#SNDDIV\n1$: XOR R1, @#SNDCS\n BR 1$');
    b.m.cpu.load(cpu);
    b.m.cycles = cycles;
    b.s.load(st);
    b.m.run(5000);
    expect(b.s.take()).toEqual(want);
  });

  it('throws for a bad base or maxEdges', () => {
    expect(() => new Sound({ base: 0o176741 })).toThrow();
    expect(() => new Sound({ maxEdges: 0 })).toThrow();
  });
});

describe('blue11 Sound: examples', () => {
  const run = (name: string, budget = 6_000_000) => {
    const ex = SOUND_EXAMPLES.find((e) => e.name.startsWith(name))!;
    const m = new SimpleMachine({ display: true, sound: true });
    m.boot(assembleOk(ex.source, { symbols: SIM_SYMBOLS }));
    const r = m.run(budget);
    return { m, r, c: m.sound!.take() };
  };

  it.each(SOUND_EXAMPLES.map((e) => [e.name, e] as const))('%s has a comment on every instruction', (_n, ex) => {
    expect(uncommentedLines(ex.source)).toEqual([]);
  });

  it('the beeper note: 880 edges, 1364 cycles apart, about a second', () => {
    const { r, c } = run('A beeper note');
    expect(r.reason).toBe('halt');
    expect(c.edges.length).toBe(880);
    expect(new Set(gaps(c.edges))).toEqual(new Set([1364]));
    expect(c.edges.at(-1)!.level).toBe(0);
  });

  it('the scale: every note at its half period', () => {
    const { r, c } = run('A scale');
    expect(r.reason).toBe('halt');
    const g = gaps(c.edges);
    for (const h of SCALE) expect(g.filter((x) => x === h).length).toBeGreaterThan(100);
    expect(c.edges.at(-1)!.level).toBe(0);
  });

  it('the tune: the generator plays each note exactly, while the CPU sleeps', () => {
    const { r, c } = run('A tune');
    expect(r.reason).toBe('halt');
    const g = new Set(gaps(c.edges));
    for (const h of [SCALE[0], SCALE[2], SCALE[4], SCALE[7]]) expect(g.has(h)).toBe(true);
    expect(c.edges.at(-1)!.level).toBe(0);
    expect(c.to).toBeGreaterThan(3 * 1_200_000 / 2); // about 2.4 s of tune
  });

  it('play and draw: the beeper slides, the generator keeps the pitch', () => {
    const { r, c } = run('Play and draw');
    expect(r.reason).toBe('halt');
    const off = c.edges.findIndex((e, i) => i > 0 && e.cycle - c.edges[i - 1].cycle === 1364 && c.edges[i + 1]?.cycle - e.cycle === 1364);
    const beeper = gaps(c.edges.slice(0, off));
    const gen = gaps(c.edges.slice(off));
    expect(Math.max(...beeper) - Math.min(...beeper)).toBeGreaterThan(60);
    expect(new Set(gen.slice(0, -1))).toEqual(new Set([1364]));
  });
});
