import { describe, expect, it } from 'vitest';
import { Simulator } from '../src/sim';

const F = 20000;

const COUNT = `
        CLR  R0
1$:     INC  R0
        BR   1$
`;

describe('Simulator', () => {
  it('reports assembler errors and loads nothing', () => {
    const s = new Simulator();
    expect(s.load(' MOV R0')[0]).toMatchObject({ line: 1 });
    expect(s.program).toBeNull();
    expect(s.canRun).toBe(false);
  });

  it('refuses a program that runs into the display memory', () => {
    const s = new Simulator();
    const errors = s.load(' HALT\n .=117776\n .WORD 1, 2\n .WORD 3');
    expect(errors).toEqual([
      { line: 3, column: 0, message: "120000–120001 is past the end of RAM (117777), in the display's memory or above: it can't be loaded" },
      { line: 4, column: 0, message: "120002–120003 is past the end of RAM (117777), in the display's memory or above: it can't be loaded" },
    ]);
    expect(s.program).toBeNull();
  });

  it('runs whole frames of 20000 cycles', () => {
    const s = new Simulator();
    s.load(COUNT);
    expect(s.runFrame()).toMatchObject({ stop: 'frame', cycles: F });
    expect(s.runFrame()).toMatchObject({ stop: 'frame', cycles: F });
    expect(s.machine.cycles).toBe(2 * F);
    expect(s.display.frame.number).toBe(2);
  });

  it('stops at a breakpoint, and Continue passes it', () => {
    const s = new Simulator();
    s.load(COUNT);
    const inc = s.addressOfLine(3)!;
    s.breakpoints = new Set([inc]);
    expect(s.runFrame().stop).toBe('breakpoint');
    expect(s.cpu.r[7]).toBe(inc);
    expect(s.runFrame().stop).toBe('breakpoint'); // a plain run stays
    expect(s.cpu.r[0]).toBe(0);
    expect(s.runFrame(true).stop).toBe('breakpoint'); // Continue: once round the loop
    expect(s.cpu.r[0]).toBe(1);
  });

  it('steps one instruction; after HALT it goes on with the next', () => {
    const s = new Simulator();
    s.load(' MOV #5, R0\n HALT\n INC R0\n HALT');
    expect(s.step().stop).toBe('step');
    expect(s.cpu.r[0]).toBe(5);
    expect(s.step().stop).toBe('halt');
    expect(s.step().stop).toBe('step');
    expect(s.cpu.r[0]).toBe(6);
    expect(s.runFrame().stop).toBe('halt');
  });

  it('a trap through an empty vector stops the CPU and says why', () => {
    const s = new Simulator();
    s.load(' MOV #1, @#FONT\n HALT');
    expect(s.runFrame()).toMatchObject({ stop: 'trap', trap: { cause: 'bus-error', detail: 0o162000 } });
  });

  it('WAIT with nothing that can wake the CPU is reported as asleep', () => {
    const s = new Simulator();
    s.load(' WAIT\n HALT');
    expect(s.runFrame().stop).toBe('asleep');
  });

  it('a step in WAIT sleeps to the next input and takes its interrupt', () => {
    const s = new Simulator();
    s.load(' MOV #ISR, @#60\n MOV #100, @#177560\n WAIT\n HALT\nISR: MOVB @#177562, R0\n RTI');
    s.replay([{ cycle: 5000, kind: 'console', ch: 65 }]);
    for (let i = 0; i < 3; i++) expect(s.step().stop).toBe('step'); // up to and with the WAIT
    expect(s.cpu.waiting).toBe(true);
    expect(s.step().stop).toBe('step');
    expect(s.cpu.waiting).toBe(false);
    expect(s.cpu.r[7]).toBe(s.addressOfLine(5));
    expect(s.machine.cycles).toBeGreaterThanOrEqual(5000);
    expect(s.machine.cycles).toBeLessThan(5100);
  });

  it('a step in WAIT with nothing due sleeps out the frame in one go', () => {
    const s = new Simulator();
    s.load(' MOV #100, @#177560\n WAIT\n HALT');
    s.step();
    s.step();
    const r = s.step();
    expect(r.stop).toBe('frame');
    expect(r.cycles).toBe(s.frameCycles);
    expect(s.cpu.waiting).toBe(true);
  });

  it('a step in WAIT with nothing that can wake the CPU is reported as asleep', () => {
    const s = new Simulator();
    s.load(' WAIT\n HALT');
    s.step();
    expect(s.step()).toMatchObject({ stop: 'asleep', cycles: 0 });
  });

  it('counts instructions per address (the heat map)', () => {
    const s = new Simulator();
    s.load(' MOV #3, R0\n1$: SOB R0, 1$\n HALT');
    s.runFrame();
    expect(s.heat[s.addressOfLine(2)! >> 1]).toBe(3);
  });

  it('the EIS option and the beam are settings; changing one boots the program again', () => {
    const s = new Simulator();
    expect(s.load(' MOV #6, R1\n MUL #7, R1\n HALT')).toEqual([]);
    s.runFrame();
    expect(s.trap?.cause).toBe('illegal');
    s.configure({ eis: true });
    expect(s.runFrame().stop).toBe('halt');
    expect(s.cpu.r[1]).toBe(42);
    s.configure({ beam: 'scan' });
    expect(s.display.beam).toBe('scan');
    expect(s.cpu.r[1]).toBe(0);
  });
});

describe('Simulator: input and replays', () => {
  const ECHO_KEYS = `
1$:     TSTB @#KBDCS            ; a key event?
        BPL  2$
        MOVB @#KBDBUF, R0
        MOVB R0, (R5)+          ; keep it
2$:     TSTB @#RCSR             ; a console character?
        BPL  1$
        MOVB @#RBUF, R0
        BIS  #200, R0
        MOVB R0, (R5)+          ; keep it too
        BR   1$
`;
  const start = (s: Simulator) => { s.load(ECHO_KEYS); s.cpu.r[5] = 0o10000; };

  it('logs live keys and console characters with their cycles', () => {
    const s = new Simulator();
    start(s);
    s.runFrame();
    s.press('KeyA');
    s.type('x');
    s.runFrame();
    s.release('KeyA');
    expect(s.inputs).toEqual([
      { cycle: F, kind: 'key', code: 0o101, down: true },
      { cycle: F, kind: 'console', ch: 0o170 },
      { cycle: 2 * F, kind: 'key', code: 0o101, down: false },
    ]);
  });

  it('a replay runs again exactly: the same memory, registers, frames and cycles', () => {
    const s = new Simulator();
    start(s);
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < i; k++) s.step();
      if (i % 2) s.press(i === 1 ? 'ShiftLeft' : 'KeyB'); else s.release('ShiftLeft');
      if (i === 3) s.type('q');
      s.runFrame();
    }
    const inputs = s.inputs;
    const want = JSON.stringify({ ram: [...s.machine.ram], r: [...s.cpu.r], cycles: s.machine.cycles, kbd: s.keyboard.state() });
    s.replay();
    s.cpu.r[5] = 0o10000; // as start() does: before the first instruction
    while (s.machine.cycles < JSON.parse(want).cycles) s.runFrame();
    expect(s.inputs).toEqual(inputs);
    expect(JSON.stringify({ ram: [...s.machine.ram], r: [...s.cpu.r], cycles: s.machine.cycles, kbd: s.keyboard.state() })).toBe(want);
  });
});

describe('recordings (replays saved to a file)', () => {
  it('a recording through JSON replays the run exactly', async () => {
    const { record, parseRecording } = await import('../src/sim');
    const a = new Simulator({ eis: true });
    a.load(' MOV #10000, R5\n1$: TSTB @#KBDCS\n BPL 1$\n MOVB @#KBDBUF, (R5)+\n BR 1$');
    a.runFrame();
    a.press('KeyZ');
    a.type('z');
    a.runFrame();
    a.release('KeyZ');
    a.runFrame();
    const rec = parseRecording(JSON.stringify(record(a)));
    if (typeof rec === 'string') throw new Error(rec);
    const b = new Simulator({ beam: rec.beam, eis: rec.eis });
    b.load(rec.source);
    b.replay(rec.inputs);
    b.runFrame(); b.runFrame(); b.runFrame();
    expect([...b.machine.ram.subarray(0o10000, 0o10004)]).toEqual([0o132, 0o332, 0, 0]);
    expect(b.inputs).toEqual(a.inputs);
    expect(b.eis).toBe(true);
  });

  it('says what is wrong with a file that is not a recording', async () => {
    const { parseRecording } = await import('../src/sim');
    const ok = { format: 'blue11-replay', version: 1, source: '', beam: 'instant', eis: false, inputs: [] };
    expect(typeof parseRecording(JSON.stringify(ok))).toBe('object');
    expect(parseRecording('{')).toMatch(/not JSON/);
    expect(parseRecording('{"format":"x"}')).toMatch(/not a Blue-11/);
    expect(parseRecording(JSON.stringify({ ...ok, beam: 'slow' }))).toMatch(/broken/);
    expect(parseRecording(JSON.stringify({ ...ok, inputs: [{ cycle: 5, kind: 'key', code: 1, down: true }, { cycle: 4, kind: 'console', ch: 1 }] }))).toMatch(/input log/);
    expect(parseRecording(JSON.stringify({ ...ok, inputs: [{ cycle: 5, kind: 'key', code: 400, down: true }] }))).toMatch(/input log/);
  });
});
