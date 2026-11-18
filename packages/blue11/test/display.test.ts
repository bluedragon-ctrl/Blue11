import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE, DeviceMachine, Display, DSP, frameToRgba, rgb333to888, SimpleMachine,
  type DisplayOptions, type Frame,
} from '../src/index.js';
import { DISPLAY_EXAMPLES, SIM_SYMBOLS, SKY } from '../examples/examples.js';
import { assembleOk } from './helpers/asm';
import { uncommentedLines } from './helpers/comments';
import { o } from './helpers';

const SYMBOLS: Record<string, number> = {
  SCREEN: DSP.SCREEN, DSPCS: DSP.DSPCS, DSPFRM: DSP.DSPFRM, DSPLIN: DSP.DSPLIN, DSPPAL: DSP.DSPPAL, DSPVEC: DSP.VEC,
};

const VSYNC = `
VSYNC:  BIC  #200, @#DSPCS
1$:     TSTB @#DSPCS
        BPL  1$
        RTS  PC`;

/** A SimpleMachine with a display, booted with `src` (not run yet). */
function boot(src: string, display: DisplayOptions = {}) {
  const m = new SimpleMachine({ display });
  const asm = assembleOk(src, { symbols: SYMBOLS });
  m.boot(asm);
  const d = m.display!;
  return { m, d, asm };
}

/** A machine with a display and no program: the host pokes the bus itself. */
function bare(display: DisplayOptions = {}) {
  const m = new SimpleMachine({ display });
  m.boot(assembleOk(' HALT'));
  return { m, d: m.display! };
}

const px = (f: Frame, x: number, y: number) => f.pixels[y * f.width + x];
const pal = (f: Frame, y: number, i: number) => f.palette[16 * y + i];
/** Let `n` cycles pass with the CPU halted (devices still run). */
const idle = (m: SimpleMachine, n: number) => (m.display!.control.advance!(n), m.clock.advance(n));

describe('blue11 Display: setup', () => {
  it('has the documented defaults', () => {
    const d = new Display();
    expect([d.memoryBase, d.base, d.vector, d.level, d.frameCycles, d.blankCycles, d.beam])
      .toEqual([o('120000'), o('176600'), o('320'), 4, 20000, 2500, 'instant']);
    expect(d.memory.size).toBe(o('40000'));
    expect(d.control.size).toBe(o('60'));
    expect(d.frame).toMatchObject({ width: 64, height: 64, number: 0 });
    expect(d.frame.pixels.every((p) => p === 0)).toBe(true);
    expect([...d.palette]).toEqual(DEFAULT_PALETTE);
  });

  it('throws on host mistakes', () => {
    expect(() => new Display({ memory: o('110000') })).toThrow(/8 KB/);
    expect(() => new Display({ base: o('176601') })).toThrow(/even/);
    expect(() => new Display({ frameCycles: 0 })).toThrow(/frameCycles/);
    expect(() => new Display({ blankCycles: 20000 })).toThrow(/blankCycles/);
    expect(() => new Display({ beam: 'slow' as 'scan' })).toThrow(/beam/);
    expect(() => new SimpleMachine({ display: true, memory: o('140000') })).toThrow(/overlaps RAM/);
  });

  it('SimpleMachine with a display: RAM to 117777, the clock ticks once a frame', () => {
    const m = new SimpleMachine({ display: true });
    expect(m.ram.length).toBe(o('120000'));
    expect(m.clockCycles).toBe(20000);
    expect(new SimpleMachine().display).toBeNull();
  });

  it('rgb333to888 and frameToRgba', () => {
    expect(rgb333to888(0o770)).toEqual([255, 255, 0]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((c) => rgb333to888(c)[2].toString(8))).toEqual(['0', '44', '111', '155', '222', '266', '333', '377']);
    const { m, d } = bare();
    m.write(o('120001'), 0o16, true);
    idle(m, 20000);
    const rgba = frameToRgba(d.frame);
    expect([...rgba.subarray(0, 8)]).toEqual([0, 0, 0, 255, 255, 255, 0, 255]);
  });
});

describe('blue11 Display: addresses', () => {
  it('mode 0: (x, y) at page + y*100 + x; high 4 bits kept in memory, masked in the frame', () => {
    const { m, d } = bare();
    m.write(o('123412'), 0o364, true); // (12, 34), colour 4, flags 360
    idle(m, 20000);
    expect(px(d.frame, o('12'), o('34'))).toBe(4);
    expect(m.read(o('123412'), true)).toBe(0o364);
    expect(d.frame.pixels.filter((p) => p).length).toBe(1);
  });

  it('mode 0: pages are 10000 apart', () => {
    const { m, d } = bare();
    for (let p = 0; p < 4; p++) m.write(o('120000') + p * o('10000') + p, p + 1, true);
    for (let p = 0; p < 4; p++) {
      m.write(DSP.DSPCS, p, false);
      idle(m, 20000);
      expect(d.frame.pixels.findIndex((v) => v !== 0)).toBe(p);
      expect(px(d.frame, p, 0)).toBe(p + 1);
    }
  });

  it('words are two pixels, little-endian', () => {
    const { m, d } = bare();
    m.write(o('120000'), 0o1403, false);
    idle(m, 20000);
    expect([px(d.frame, 0, 0), px(d.frame, 1, 0)]).toEqual([3, 3]);
    m.write(o('120002'), 0o401, false);
    expect(m.read(o('120002'), true)).toBe(1);
    expect(m.read(o('120003'), true)).toBe(1);
  });

  it('mode 1: (x, y) at page + y*100 + x/2, even x in the low half; pages 20000 apart; bit 1 of PAGE ignored', () => {
    const { m, d } = bare();
    m.write(DSP.DSPCS, 4, false);
    m.write(o('120000') + 5 * o('100') + 3, 0x52, true); // y 5: x 6 = 2, x 7 = 5
    m.write(o('140000'), 0o17, true); // page 1, (0, 0) = 17
    idle(m, 20000);
    expect(d.frame).toMatchObject({ width: 128, height: 128 });
    expect([px(d.frame, 6, 5), px(d.frame, 7, 5)]).toEqual([2, 5]);
    expect(d.frame.pixels.filter((p) => p).length).toBe(2);
    m.write(DSP.DSPCS, 4 | 3, false); // page 3: bit 1 ignored, so page 1
    idle(m, 20000);
    expect(px(d.frame, 0, 0)).toBe(0o17);
    expect(m.read(DSP.DSPCS, false) & 3).toBe(3); // bit 1 is stored
  });

  it('the same memory in mode 0 and then mode 1', () => {
    const { m, d } = bare();
    m.write(o('120000'), 0x21, true); // mode 0: colour 1; mode 1: (0, 0) = 1, (1, 0) = 2
    m.write(o('120100'), 0o3, true); // mode 0: (0, 1) = 3; mode 1: (0, 1) = 3
    idle(m, 20000);
    expect([px(d.frame, 0, 0), px(d.frame, 0, 1)]).toEqual([1, 3]);
    m.write(DSP.DSPCS, 4, false);
    idle(m, 20000);
    expect([px(d.frame, 0, 0), px(d.frame, 1, 0), px(d.frame, 0, 1)]).toEqual([1, 2, 3]);
  });
});

describe('blue11 Display: the latch', () => {
  it('a write after a blank shows only at the next blank; PAGE and MODE too', () => {
    const { m, d } = bare();
    m.write(o('120000'), 5, true);
    m.write(DSP.DSPCS, 1, false);
    expect(d.frame.number).toBe(0);
    idle(m, 19999);
    expect(px(d.frame, 0, 0)).toBe(0);
    idle(m, 1);
    expect(d.frame.number).toBe(1);
    expect(px(d.frame, 0, 0)).toBe(0); // page 1 is shown
    m.write(DSP.DSPCS, 0, false);
    idle(m, 20000);
    expect(px(d.frame, 0, 0)).toBe(5);
    m.write(DSP.DSPCS, 4, false);
    idle(m, 10000);
    expect(d.frame.width).toBe(64);
    idle(m, 10000);
    expect(d.frame.width).toBe(128);
  });

  it('the palette is latched with the pixels', () => {
    const { m, d } = bare();
    m.write(DSP.DSPPAL + 2, 0o707, false);
    expect(pal(d.frame, 0, 1)).toBe(DEFAULT_PALETTE[1]);
    idle(m, 20000);
    expect(pal(d.frame, 0, 1)).toBe(0o707);
    expect(pal(d.frame, 63, 1)).toBe(0o707);
    m.write(DSP.DSPPAL + 2, 0o1, false);
    expect(pal(d.frame, 0, 1)).toBe(0o707);
  });

  it('onFrame is called at each blank with the new frame', () => {
    const { m, d } = bare();
    const seen: number[] = [];
    d.onFrame = (f) => { seen.push(f.number); expect(f).toBe(d.frame); };
    idle(m, 3 * 20000 + 5);
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('blue11 Display: registers', () => {
  it('DONE is set at each blank and cleared only by writing it as 0', () => {
    const { m } = bare();
    expect(m.read(DSP.DSPCS, false)).toBe(0);
    idle(m, 20000);
    expect(m.read(DSP.DSPCS, false)).toBe(0o200);
    m.write(DSP.DSPCS, 0o201, false); // writing 1 leaves it
    expect(m.read(DSP.DSPCS, false)).toBe(0o201);
    m.write(DSP.DSPCS, 0o1, true); // a byte write with bit 7 clear clears it
    expect(m.read(DSP.DSPCS, false)).toBe(0o1);
  });

  it('bit 3, the other bits and the high byte of DSPCS are ignored', () => {
    const { m } = bare();
    m.write(DSP.DSPCS, 0o177777, false);
    expect(m.read(DSP.DSPCS, false)).toBe(0o107);
    m.write(DSP.DSPCS + 1, 0o377, true);
    expect(m.read(DSP.DSPCS, false)).toBe(0o107);
  });

  it('DSPFRM counts and wraps at 16 bits; DSPFRM and DSPLIN take no writes', () => {
    const d = new Display({ frameCycles: 100, blankCycles: 10 });
    d.control.advance!(100 * 0o177777);
    expect(d.control.read(2)).toBe(0o177777);
    d.control.advance!(100);
    expect(d.control.read(2)).toBe(0);
    expect(d.control.write(2, 5, false)).toBe(true);
    expect(d.control.read(2)).toBe(0);
  });

  it('the hole 176606–176616 is a bus error', () => {
    for (const src of [' MOV @#176606, R0\n HALT', ' CLR @#176616\n HALT']) {
      const { m } = boot(src);
      m.cpu.onTrap = () => 'stop';
      expect(m.run(100)).toMatchObject({ reason: 'trap', trap: { vector: 4 } });
    }
    const { m } = bare();
    for (let a = o('176606'); a <= o('176616'); a += 2) expect(m.read(a, false)).toBeLessThan(0);
  });

  it('palette values are masked to 9 bits; a byte write to the high byte sets only bit 8', () => {
    const { m } = bare();
    const p3 = DSP.DSPPAL + 6;
    m.write(p3, 0o177777, false);
    expect(m.read(p3, false)).toBe(0o777);
    m.write(p3 + 1, 0o376, true);
    expect(m.read(p3, false)).toBe(0o377);
    m.write(p3, 0o12, true);
    expect(m.read(p3, false)).toBe(0o12);
    m.write(p3 + 1, 0o1, true);
    expect(m.read(p3, false)).toBe(0o412);
  });

  it.each([0, 4])('DSPLIN: 177777 in the blank, then the row the beam is on (MODE %i)', (mode) => {
    const opts = { frameCycles: 20000, blankCycles: 2500 };
    const { m, d } = bare(opts);
    m.write(DSP.DSPCS, mode, false);
    idle(m, 20000); // the mode is latched
    const H = mode ? 128 : 64;
    const T = (r: number) => 2500 + Math.floor((r * 17500) / H);
    for (let p = 0; p < 20000; p++) {
      const want = p < 2500 ? 0o177777 : Math.max(...Array.from({ length: H }, (_, r) => r).filter((r) => T(r) <= p));
      if (p % 37 === 0 || p === 2499 || p === 2500 || p === T(1) || p === T(1) - 1 || p === 19999) {
        expect(m.read(DSP.DSPLIN, false), `cycle ${p}`).toBe(want);
      }
      idle(m, 1);
    }
    expect(d.control.read(4)).toBe(0o177777);
  });

  it('nextEvent stops the CPU when DSPLIN changes, and at the blank', () => {
    const d = new Display();
    expect(d.control.nextEvent!()).toBe(2500);
    d.control.advance!(2500);
    expect(d.control.nextEvent!()).toBe(Math.floor(17500 / 64));
    d.control.advance!(19999 - 2500);
    expect(d.control.nextEvent!()).toBe(1); // the blank
    d.control.advance!(1);
    expect(d.control.nextEvent!()).toBe(2500);
  });
});

describe('blue11 Display: interrupts', () => {
  it('only at the blank, only with IE; WAIT wakes at the blank', () => {
    const { m } = boot(`
        MOV  #ISR, @#DSPVEC
        MOV  #340, @#DSPVEC+2
        MOV  #100, @#DSPCS      ; IE
        WAIT
        HALT
ISR:    INC  R1
        BIC  #200, @#DSPCS
        RTI`);
    expect(m.run(100000).reason).toBe('halt');
    expect(m.cpu.r[1]).toBe(1);
    expect(m.cycles).toBeGreaterThanOrEqual(20000);
    expect(m.cycles).toBeLessThan(20020);
  });

  it('setting IE while DONE is set does not interrupt; clearing IE withdraws a request', () => {
    const { m } = boot(`
        MOV  #ISR, @#DSPVEC
        CLR  @#DSPVEC+2
        MOV  #340, @#177776     ; priority 7: requests wait
1$:     TSTB @#DSPCS            ; wait for DONE
        BPL  1$
        MOV  #300, @#DSPCS      ; IE, DONE kept: no request
        CLR  @#177776           ; priority 0
        NOP
        MOV  #340, @#177776
2$:     BIT  #1, @#DSPFRM       ; wait for frame 2 (a request at its blank)
        BNE  2$
        CLR  @#DSPCS            ; IE off: withdrawn
        CLR  @#177776
        NOP
        HALT
ISR:    INC  R1
        RTI`);
    expect(m.run(100000).reason).toBe('halt');
    expect(m.cpu.r[1]).toBe(0);
    expect(m.display!.frame.number).toBe(2);
  });

  it('a polling VSYNC sees DONE in the cycle of the blank', () => {
    const { m, asm } = boot(`
        JSR  PC, VSYNC
        HALT
${VSYNC}`);
    const done = asm.symbols.get('VSYNC')! + 12; // RTS PC
    const r = m.run(100000, new Set([done]));
    expect(r.reason).toBe('breakpoint');
    // The TSTB that sees DONE starts at or right after cycle 20000 (one instruction late at most).
    expect(m.cycles).toBeGreaterThanOrEqual(20000);
    expect(m.cycles).toBeLessThanOrEqual(20000 + 3 + 2 + 2);
  });
});

describe('blue11 Display: the scanning beam', () => {
  const rowAt = (r: number) => 2500 + Math.floor((r * 17500) / 64); // T(r), mode 0

  it('a write to row r before the beam passes it shows in this frame, one after it in the next', () => {
    const { m, d } = bare({ beam: 'scan' });
    idle(m, rowAt(0o10) + 1); // the beam is on row 10
    m.write(o('121000'), 3, true); // row 10: not passed yet
    m.write(o('120700'), 4, true); // row 7: passed
    idle(m, 20000 - (rowAt(0o10) + 1));
    expect(d.frame.number).toBe(1);
    expect(px(d.frame, 0, 0o10)).toBe(3);
    expect(px(d.frame, 0, 7)).toBe(0);
    idle(m, 20000);
    expect(px(d.frame, 0, 7)).toBe(4);
  });

  it('drawing on the shown page while the beam passes tears', () => {
    // Fill the page with colour 2 by words from the top, starting in the blank, slower than the beam.
    const { m, d } = boot(`
        JSR  PC, VSYNC
        MOV  #SCREEN, R1
        MOV  #4000, R2
1$:     MOV  #1002, (R1)+       ; 2 cycles of fetch + 1 write…
        NOP
        NOP
        NOP
        NOP
        NOP
        NOP
        SOB  R2, 1$
        JSR  PC, VSYNC
        HALT
${VSYNC}`, { beam: 'scan' });
    const frames: Frame[] = [];
    d.onFrame = (f) => frames.push(f);
    expect(m.run(200000).reason).toBe('halt');
    // Frame 2 was composed during the fill: the top done, the bottom not yet.
    const f = frames[1];
    const filled = (y: number) => f.pixels.subarray(y * 64, y * 64 + 64).every((p) => p === 2);
    const empty = (y: number) => f.pixels.subarray(y * 64, y * 64 + 64).every((p) => p === 0);
    expect(f.number).toBe(2);
    expect(filled(0)).toBe(true);
    expect(empty(63)).toBe(true);
    const firstEmpty = Array.from({ length: 64 }, (_, y) => y).find(empty)!;
    expect(firstEmpty).toBeGreaterThan(40);
    expect(firstEmpty).toBeLessThan(63);
    expect(frames[2].pixels.every((p) => p === 2)).toBe(true); // frame 3: all filled
    for (let y = firstEmpty; y < 64; y++) expect(empty(y)).toBe(true);
  });

  it('a palette change at row r colours rows r onwards', () => {
    const { m, d } = bare({ beam: 'scan' });
    idle(m, rowAt(20) + 3); // DSPLIN = 20
    expect(m.read(DSP.DSPLIN, false)).toBe(20);
    m.write(DSP.DSPPAL + 2, 0o700, false);
    idle(m, 20000 - (rowAt(20) + 3));
    expect(pal(d.frame, 19, 1)).toBe(DEFAULT_PALETTE[1]);
    expect(pal(d.frame, 20, 1)).toBe(0o700);
    expect(pal(d.frame, 63, 1)).toBe(0o700);
  });

  it('a change made in the blank never tears; PAGE and MODE change only at the blank', () => {
    const { m, d } = bare({ beam: 'scan' });
    idle(m, 20000); // frame 1; now in the blank of frame 2
    m.write(o('120000'), 6, true);
    m.write(o('127700'), 6, true);
    m.write(DSP.DSPCS, 4 | 1, false); // mode 1, page 1, from the next blank on
    idle(m, 20000);
    expect(d.frame.width).toBe(64);
    expect([px(d.frame, 0, 0), px(d.frame, 0, 63)]).toEqual([6, 6]);
    idle(m, 20000); // composed in mode 1 from page 1 (empty)
    expect(d.frame.width).toBe(128);
    expect(d.frame.pixels.every((p) => p === 0)).toBe(true);
  });

  it('the instant beam does not tear', () => {
    const { m, d } = bare();
    idle(m, rowAt(10) + 1);
    m.write(o('120700'), 4, true);
    idle(m, 20000 - (rowAt(10) + 1));
    expect(px(d.frame, 0, 7)).toBe(4);
  });
});

describe('blue11 Display: reset and state', () => {
  it('power-up and RESET', () => {
    const { m, d } = boot(`
        MOVB #5, @#SCREEN
        MOV  #707, @#DSPPAL
        MOV  #105, @#DSPCS      ; IE, mode 1, page 1
        RESET
        HALT`);
    m.cpu.r[0] = 0;
    m.run(100);
    expect(m.read(DSP.DSPCS, false)).toBe(0o5);
    expect(m.read(DSP.DSPPAL, false)).toBe(0o707);
    expect(d.bytes[0]).toBe(5);
    idle(m, 20000);
    expect(d.frame.width).toBe(128);
    m.boot(assembleOk(' HALT'));
    expect(m.read(DSP.DSPCS, false)).toBe(0);
    expect(m.read(DSP.DSPFRM, false)).toBe(0);
    expect(m.read(DSP.DSPLIN, false)).toBe(0o177777);
    expect(m.read(DSP.DSPPAL, false)).toBe(0);
    expect(d.bytes.every((b) => b === 0)).toBe(true);
    expect(d.frame).toMatchObject({ width: 64, height: 64, number: 0 });
    expect(d.frame.pixels.every((p) => p === 0)).toBe(true);
  });

  it('RESET withdraws a pending request and keeps the beam going', () => {
    const { m } = boot(`
        MOV  #340, @#177776
        MOV  #100, @#DSPCS
1$:     TSTB @#DSPCS
        BPL  1$
        MOV  @#DSPFRM, R2
        RESET
        CLR  @#177776
        NOP
        MOV  @#DSPFRM, R3
        HALT`);
    expect(m.run(100000).reason).toBe('halt');
    expect(m.cpu.r[2]).toBe(1);
    expect(m.cpu.r[3]).toBe(1);
  });

  it.each(['instant', 'scan'] as const)('state() → JSON → load() gives the same run (%s beam)', (beam) => {
    const src = `
        MOV  #SCREEN, R1
1$:     MOVB R2, (R1)+
        INC  R2
        MOV  R2, @#DSPPAL+4
        CMP  R1, #SCREEN+10000
        BLO  1$
        INC  @#DSPCS
        BR   .-24
`;
    const machine = () => {
      const d = new Display({ beam });
      const m = new DeviceMachine({ memory: d.memoryBase }).add(d.memory).add(d.control);
      m.boot(assembleOk(src, { symbols: SYMBOLS }));
      return { m, d };
    };
    const a = machine();
    a.m.run(33333);
    const snap = JSON.stringify({ cpu: a.m.cpu.save(), ram: [...a.m.ram], cycles: a.m.cycles, dsp: a.d.state() });
    a.m.run(55555);
    const want = JSON.stringify(a.d.state());
    const b = machine();
    const s = JSON.parse(snap);
    b.m.cpu.load(s.cpu); b.m.ram.set(s.ram); b.m.cycles = s.cycles;
    b.d.load(s.dsp);
    b.m.run(55555);
    expect(JSON.stringify(b.d.state())).toBe(want);
    expect(a.d.frame.number).toBeGreaterThan(3);
  });

  it('two runs of the same program give the same frames', () => {
    const run = () => {
      const { m, d } = boot(`
        MOV  #SCREEN, R1
1$:     MOVB R1, (R1)+
        CMP  R1, #SCREEN+40000
        BLO  1$
        HALT`, { beam: 'scan' });
      const frames: string[] = [];
      d.onFrame = (f) => frames.push(`${f.number}:${f.pixels.join('')}:${f.palette.join(',')}`);
      m.run(200000);
      return frames;
    };
    const a = run();
    expect(a.length).toBeGreaterThan(2);
    expect(run()).toEqual(a);
  });
});

describe('blue11 Display: example programs', () => {
  const run = (name: string, beam?: 'instant' | 'scan') => {
    const ex = DISPLAY_EXAMPLES.find((e) => e.name.startsWith(name))!;
    const m = new SimpleMachine({ display: { beam: beam ?? ex.beam } });
    m.boot(assembleOk(ex.source, { symbols: SIM_SYMBOLS }));
    const frames: Frame[] = [];
    m.display!.onFrame = (f) => frames.push(f);
    const result = m.run(5_000_000);
    return { m, d: m.display!, frames, result };
  };
  /** The lit pixels of a frame as "x,y=colour" (octal), sorted. */
  const lit = (f: Frame) => {
    const out: string[] = [];
    f.pixels.forEach((p, i) => { if (p) out.push(`${(i % f.width).toString(8)},${Math.floor(i / f.width).toString(8)}=${p.toString(8)}`); });
    return out.sort();
  };
  const set = (pts: Array<[number, number, number]>) => [...new Set(pts.map(([x, y, c]) => `${x.toString(8)},${y.toString(8)}=${c.toString(8)}`))].sort();

  it.each(DISPLAY_EXAMPLES.map((e) => [e.name, e] as const))('%s has a comment on every instruction and halts', (_n, ex) => {
    expect(uncommentedLines(ex.source)).toEqual([]);
    expect(run(ex.name).result.reason).toBe('halt');
  });

  it('diagonal', () => {
    const { d } = run('Diagonal');
    expect(lit(d.frame)).toEqual(set(Array.from({ length: 64 }, (_, i) => [i, i, 0o17])));
  });

  it('filled rectangle', () => {
    const { d } = run('Filled rectangle');
    const pts: Array<[number, number, number]> = [];
    for (let y = 0o20; y < 0o40; y++) for (let x = 0o10; x < 0o30; x++) pts.push([x, y, 4]);
    expect(lit(d.frame)).toEqual(set(pts));
  });

  it('bouncing pixel: every frame shows exactly one pixel, one step further on', () => {
    const { frames } = run('Bouncing pixel');
    let x = 0, y = 5, dx = 1, dy = 1;
    const want: string[][] = [];
    for (let i = 0; i < 50; i++) {
      x += dx; if (x === 0 || x === 0o77) dx = -dx;
      y += dy; if (y === 0 || y === 0o77) dy = -dy;
      want.push(set([[x, y, 0o16]]));
    }
    expect(frames.map(lit)).toEqual(want);
  });

  it('circle: PLOT1 draws the midpoint circle in mode 1', () => {
    const { d } = run('Circle');
    const pts: Array<[number, number, number]> = [];
    let x = 50, y = 0, dd = 1 - 50;
    while (x >= y) {
      for (const [a, b] of [[x, y], [y, x]]) for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) pts.push([64 + sx * a, 64 + sy * b, 0o17]);
      y++;
      if (dd < 0) dd += 2 * y + 1;
      else { x--; dd += 2 * (y - x) + 1; }
    }
    expect(d.frame).toMatchObject({ width: 128, height: 128 });
    expect(lit(d.frame)).toEqual(set(pts));
    expect(pts.length).toBeGreaterThan(250);
  });

  it('palette cycling: the stripes stay, the palette turns once a frame', () => {
    const { frames } = run('Palette cycling');
    expect(frames.length).toBe(20);
    frames.forEach((f, k) => {
      expect(f.number).toBe(k + 1);
      for (let x = 0; x < 64; x++) expect(px(f, x, 0o40)).toBe(x >> 2);
      for (let n = 1; n < 16; n++) expect(pal(f, 0, n)).toBe(DEFAULT_PALETTE[1 + ((n - 1 + k + 1) % 15)]);
      expect(pal(f, 0, 0)).toBe(0);
    });
  });

  it('sky gradient: with the real beam each band of 10 rows has its own colour 1', () => {
    const { frames } = run('Sky gradient');
    expect(frames.length).toBe(4); // frame 1 was composed while the page was filled
    for (const f of frames.slice(1)) {
      expect(f.pixels.every((p) => p === 1)).toBe(true);
      for (let y = 0; y < 64; y++) expect(pal(f, y, 1), `row ${y}`).toBe(SKY[y >> 3]);
    }
  });

  it('sky gradient with the instant beam: one colour, the last band', () => {
    const { frames } = run('Sky gradient', 'instant');
    for (let y = 0; y < 64; y++) expect(pal(frames.at(-1)!, y, 1)).toBe(SKY[7]);
  });
});
