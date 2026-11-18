import { describe, expect, it } from 'vitest';
import { assemble, BUS_ERROR, DeviceMachine, DL11, KW11L, Rom, SimpleMachine, type Cpu, type Device } from '../src/index.js';
import { assembleOk } from './helpers/asm';
import { boot as bootSimple, o, runAsm, words } from './helpers';

/** A test peripheral: a counter register and a timer that interrupts after `delay` cycles. */
class Timer implements Device {
  readonly size = 4;
  count = 0;
  resets: boolean[] = [];
  private cpu!: Cpu;
  private left = Infinity;
  constructor(readonly base: number, private readonly delay: number) {}
  attach(cpu: Cpu): void { this.cpu = cpu; }
  read(offset: number): number { return offset === 0 ? 0o1234 | (0o56 << 8) : BUS_ERROR; }
  write(offset: number, value: number, byte: boolean): boolean {
    if (offset !== 0 || byte) return false;
    this.count = value;
    this.left = this.delay; // start the timer
    return true;
  }
  reset(powerUp: boolean): void { this.resets.push(powerUp); this.left = Infinity; }
  advance(cycles: number): void {
    this.left -= cycles;
    if (this.left <= 0) { this.left = Infinity; this.cpu.interrupt(0o300, 5); }
  }
  nextEvent(): number { return this.left; }
  wakeIn(): number { return this.left; }
  canWake(): boolean { return this.left !== Infinity; }
}

const boot = (m: DeviceMachine, src: string) => m.boot(assembleOk(src));

describe('blue11 DeviceMachine', () => {
  it('routes reads and writes to devices; byte reads take half the word', () => {
    const t = new Timer(o('170000'), 100);
    const m = new DeviceMachine().add(t);
    expect(m.read(o('170000'), false)).toBe(0o1234 | (0o56 << 8));
    expect(m.read(o('170000'), true)).toBe(0o1234 & 0xff);
    expect(m.read(o('170001'), true)).toBe(0o56);
    expect(m.read(o('170002'), false)).toBe(BUS_ERROR);
    expect(m.read(o('170004'), false)).toBe(BUS_ERROR);
    expect(m.write(o('170000'), 7, false)).toBe(true);
    expect(t.count).toBe(7);
  });

  it('refuses overlapping or misplaced devices', () => {
    const m = new DeviceMachine().add(new Timer(o('170000'), 1));
    expect(() => m.add(new Timer(o('170002'), 1))).toThrow(/overlaps another device/);
    expect(() => m.add(new Timer(o('150000'), 1))).toThrow(/overlaps RAM/);
    expect(() => m.add(new Timer(o('170001'), 1))).toThrow(/even/);
    expect(() => m.add(new Timer(o('177774'), 1))).toThrow(/PSW/);
  });

  it('a sleeping CPU wakes on a device interrupt; RESET and boot reach the devices', () => {
    const t = new Timer(o('170000'), 500);
    const m = new DeviceMachine().add(t);
    boot(m, `
        MOV #ISR, @#300
        MOV #240, @#302
        RESET
        MOV #5, @#170000   ; start the timer
        WAIT
        HALT
ISR:    INC R1
        RTI`);
    const r = m.run(10000);
    expect(r.reason).toBe('halt');
    expect(m.cpu.r[1]).toBe(1);
    expect(m.cycles).toBeGreaterThanOrEqual(500);
    expect(m.cycles).toBeLessThan(600);
    expect(t.resets).toEqual([true, false]);
  });

  it('boot reports the parts of a program outside RAM, by source line, and loads the rest', () => {
    const m = new DeviceMachine({ memory: o('1010') });
    const asm = assembleOk(' MOV #1, R0\n HALT\n .=1006\n .WORD 6, 7, 10\n .=170000\n .WORD 11\n .BLKW 2');
    const r = m.boot(asm);
    expect(r.notLoaded).toEqual([
      { start: o('1010'), end: o('1014'), line: 4 },
      { start: o('170000'), end: o('170002'), line: 6 },
      { start: o('170002'), end: o('170006'), line: 7 },
    ]);
    expect(m.notLoaded(asm)).toEqual(r.notLoaded);
    expect(m.read(o('1006'), false)).toBe(6); // the part inside RAM is loaded
    expect(m.cpu.r[7]).toBe(o('1000'));
    expect(m.boot(assembleOk(' HALT')).notLoaded).toEqual([]);
  });

  it('without lines, boot reports one range from the end of RAM to the end of the program', () => {
    const m = new DeviceMachine({ memory: o('1010') });
    const { origin, bytes, start } = assembleOk(' HALT\n .=1020\n .WORD 1');
    expect(m.boot({ origin, bytes, start }).notLoaded).toEqual([{ start: o('1010'), end: o('1022') }]);
    const high = assembleOk(' .=170000\n .WORD 1');
    expect(m.notLoaded({ origin: high.origin, bytes: high.bytes, start: high.start })).toEqual([{ start: o('170000'), end: o('170002') }]);
  });

  it('WAIT with no device able to wake it stops at once', () => {
    const m = new DeviceMachine().add(new Timer(o('170000'), 500));
    boot(m, ' WAIT\n HALT');
    expect(m.run(10000)).toMatchObject({ reason: 'wait' });
    expect(m.cycles).toBeLessThan(10);
  });

  it('the line clock counts every tick missed in a long sleep once', () => {
    const k = new KW11L(10);
    const m = new SimpleMachine({ clockCycles: 10 });
    expect(m.clock.cycles).toBe(10);
    k.attach(m.cpu);
    k.write(0, 0, false); // clear DONE
    k.advance(9);
    expect(k.read() & 0o200).toBe(0);
    k.advance(25); // 3 ticks late
    expect(k.read() & 0o200).toBe(0o200);
    expect(k.nextEvent()).toBe(6);
  });

  it('a byte write to the high byte of a device register leaves its low byte alone', () => {
    const m = new SimpleMachine();
    const csrs = { RCSR: o('177560'), XCSR: o('177564'), LKS: o('177546') };
    for (const a of Object.values(csrs)) {
      expect(m.write(a, 0o300, false)).toBe(true); // interrupts on (LKS keeps DONE)
      expect(m.write(a + 1, 0o377, true)).toBe(true); // MOVB to the high byte
    }
    expect(m.read(csrs.RCSR, false) & 0o100).toBe(0o100);
    expect(m.read(csrs.XCSR, false) & 0o100).toBe(0o100);
    expect(m.read(csrs.LKS, false) & 0o300).toBe(0o300);
    expect(m.write(o('177567'), 0o101, true)).toBe(true); // XBUF high byte: prints nothing
    expect(m.output).toBe('');
    // Odd bytes of addresses nobody answers still fault.
    expect(m.write(o('177571'), 0, true)).toBe(false);
  });

  it('host word access at the top of RAM stays inside it', () => {
    const m = new SimpleMachine({ memory: 0o1001 });
    m.write(0o1000, 0o177777, false);
    expect(m.read(0o1000, true)).toBe(0o377);
    expect(Number.isNaN(m.read(0o1000, false))).toBe(false);
    expect(m.read(0o777, false)).toBe(m.read(0o776, false));
  });

  it('a step on a sleeping CPU sleeps to the clock tick and takes its interrupt', () => {
    const { m } = bootSimple(' MOV #2000, SP\n MOV #ISR, @#100\n MOV #100, @#177546\n WAIT\n HALT\nISR: RTI', { clockCycles: 1000 });
    for (let i = 0; i < 3; i++) m.step();
    const wait = m.step(); // WAIT itself
    expect(wait).toMatchObject({ reason: 'wait', instructions: 1 });
    const before = m.cycles;
    const r = m.step(); // asleep: to the tick, then the interrupt
    expect(r.reason).toBe('budget');
    expect(r.instructions).toBe(0);
    expect(m.cpu.waiting).toBe(false);
    expect(m.cpu.r[7]).toBe(m.read(0o100, false));
    expect(m.cycles - before).toBe(r.cycles);
    expect(m.cycles).toBeGreaterThanOrEqual(1000);
    expect(m.step().instructions).toBe(1); // RTI, back after the WAIT
    expect(m.step()).toMatchObject({ reason: 'halt' });
  });

  it('a step on a sleeping CPU sleeps at most maxCycles', () => {
    const { m } = bootSimple(' MOV #2000, SP\n MOV #ISR, @#100\n MOV #100, @#177546\n WAIT\n HALT\nISR: RTI', { clockCycles: 1000 });
    for (let i = 0; i < 4; i++) m.step();
    const start = m.cycles;
    expect(m.step(100)).toEqual({ reason: 'wait', cycles: 100, instructions: 0 });
    expect(m.cycles).toBe(start + 100);
    expect(m.cpu.waiting).toBe(true);
    expect(m.step().reason).toBe('budget');
    expect(m.cpu.waiting).toBe(false);
  });

  it('a step on a CPU only host input can wake returns wait with no time passed', () => {
    const { m } = bootSimple(' MOV #2000, SP\n MOV #100, @#177560\n WAIT\n HALT');
    for (let i = 0; i < 3; i++) m.step();
    const start = m.cycles;
    expect(m.step()).toEqual({ reason: 'wait', cycles: 0, instructions: 0 });
    expect(m.step(500)).toEqual({ reason: 'wait', cycles: 500, instructions: 0 });
    expect(m.cycles).toBe(start + 500);
  });

  it('a step on a CPU nobody can wake returns wait at once', () => {
    const m = new DeviceMachine().add(new Timer(o('170000'), 500));
    boot(m, ' WAIT\n HALT');
    m.step();
    expect(m.step(1000)).toEqual({ reason: 'wait', cycles: 0, instructions: 0 });
  });

  it('WAIT with only keyboard interrupts sleeps out the budget in one go', () => {
    const { m, result } = runAsm(' MOV #2000, SP\n MOV #100, @#177560\n WAIT\n HALT', { budget: 50000 });
    expect(result.reason).toBe('wait');
    expect(result.cycles).toBe(50000);
    expect(m.cycles).toBe(50000);
  });
});

describe('blue11 DL11', () => {
  // A receive request waits behind priority 7; then IE is cleared, or RBUF read.
  it.each([['IE is cleared', 'CLR @#177560'], ['RBUF is read', 'MOV @#177562, R0']])('its receive request goes away when %s', (_, line) => {
    const { m } = bootSimple(`
        MOV #H, @#60
        CLR @#62
        MOV #340, @#177776
        MOV #100, @#177560
        ${line}
        CLR @#177776
        NOP
        HALT
H:      MOV #1, R5
        HALT`);
    m.type('x');
    m.run(1000);
    expect(m.cpu.r[5]).toBe(0);
  });

  it('RBUF reads the character typed', () => {
    const { m } = bootSimple(' MOV @#177562, R0\n HALT');
    m.type('x');
    m.run(100);
    expect(m.cpu.r[0]).toBe('x'.charCodeAt(0));
  });

  it('maxOutput keeps the end of the output', () => {
    const m = new SimpleMachine();
    const d = new DL11({ base: 0o176500, vector: 0o70, maxOutput: 3 });
    m.add(d);
    boot(m, `
        MOV #M, R1
1$:     MOVB (R1)+, @#176506
        BNE 1$
        HALT
M:      .ASCIZ /abcdef/`);
    m.run(10_000);
    expect(d.output).toBe('ef\0');
    expect(() => new DL11({ maxOutput: 0 })).toThrow();
  });
});

describe('blue11 Cpu.onInstruction', () => {
  it('sees every instruction once, with its address and first word', () => {
    const { m } = bootSimple(`
        MOV #3, R0
1$:     DEC R0
        BNE 1$
        HALT`);
    const seen: Array<[number, number]> = [];
    m.cpu.onInstruction = (pc, op) => seen.push([pc, op]);
    const r = m.run(1000);
    expect(r.instructions).toBe(seen.length);
    expect(seen[0]).toEqual([0o1000, 0o012700]);
    expect(seen.filter(([pc]) => pc === 0o1004)).toHaveLength(3);
    expect(seen.at(-1)).toEqual([0o1010, 0]);
  });
});

describe('blue11 Cpu.onAccess', () => {
  it('sees the fetches, reads and writes of an instruction in order', () => {
    const { m } = bootSimple(`
        MOV #5, R0
        MOV R0, -(SP)
        MOVB @#BYTE, R1
        HALT
BYTE:   .BYTE 7, 0`);
    const seen: Array<[number, number, boolean, boolean]> = [];
    m.cpu.onAccess = (a, v, w, b) => seen.push([a, v, w, b]);
    m.step();
    expect(seen).toEqual([[0o1000, 0o012700, false, false], [0o1002, 5, false, false]]);
    seen.length = 0;
    const sp = m.cpu.r[6];
    m.step();
    expect(seen).toEqual([[0o1004, 0o010046, false, false], [sp - 2, 5, true, false]]);
    seen.length = 0;
    m.step();
    expect(seen).toEqual([[0o1006, 0o113701, false, false], [0o1010, 0o1014, false, false], [0o1014, 7, false, true]]);
  });

  it('is not called for an access that faults', () => {
    const { m } = bootSimple(' MOV @#1, R0');
    const seen: number[] = [];
    m.cpu.onAccess = (a) => seen.push(a);
    m.step();
    expect(seen.slice(0, 2)).toEqual([0o1000, 0o1002]);
    expect(seen).not.toContain(1); // then the trap through vector 4
    expect(seen).toContain(4);
  });
});

describe('blue11 assembler ^X (opt-in)', () => {
  it('is an error by default, a hexadecimal number with hex: true', () => {
    expect(assemble(' .WORD ^XFF').errors[0].message).toMatch(/not standard syntax/);
    expect(words(' .WORD ^XFF, ^x1f+1', { hex: true })).toEqual([0xff, 0x20]);
    expect(words(' MOV #^X8000, R0', { hex: true })).toEqual([0o012700, 0x8000]);
    expect(assemble(' .WORD ^XG', { hex: true }).errors[0].message).toMatch(/hexadecimal digits/);
  });

  it('leaves standard programs alone', () => {
    const { cpu } = runAsm(' MOV #^D10, R0\n HALT', { asm: { hex: true } });
    expect(cpu.r[0]).toBe(10);
  });
});

describe('blue11 Rom', () => {
  it('reads what was loaded, as bytes and words', () => {
    const rom = new Rom({ base: o('160000'), size: o('10000') });
    rom.load([0o12, 0o34, 0o56], 2);
    const m = new DeviceMachine({ memory: o('160000') }).add(rom);
    expect(m.read(o('160002'), false)).toBe(0o12 | (0o34 << 8));
    expect(m.read(o('160003'), true)).toBe(0o34);
    expect(m.read(o('160004'), true)).toBe(0o56);
    expect(m.read(o('167776'), false)).toBe(0);
    expect(m.read(o('170000'), false)).toBe(BUS_ERROR);
  });

  it('a write from the program is a bus error (trap 4)', () => {
    const rom = new Rom({ base: o('160000'), size: 2 });
    rom.load([1, 2]);
    const m = new DeviceMachine({ memory: o('160000') }).add(rom);
    boot(m, ' MOVB #7, @#160001\n HALT');
    m.cpu.onTrap = () => 'stop';
    expect(m.run(100)).toMatchObject({ reason: 'trap', trap: { vector: 4 } });
    expect(m.read(o('160000'), false)).toBe(1 | (2 << 8));
  });

  it('throws when a load does not fit, or on a bad base or size', () => {
    const rom = new Rom({ base: o('160000'), size: 4 });
    expect(() => rom.load([1, 2, 3, 4, 5])).toThrow(/don't fit/);
    expect(() => rom.load([1, 2], 3)).toThrow(/don't fit/);
    expect(() => rom.load([1], -1)).toThrow(/don't fit/);
    expect(() => new Rom({ base: o('160001'), size: 2 })).toThrow(/even/);
    expect(() => new Rom({ base: o('160000'), size: 0 })).toThrow(/even/);
    expect(() => new Rom({ base: o('177000'), size: o('2000') })).toThrow(/177777/);
  });
});
