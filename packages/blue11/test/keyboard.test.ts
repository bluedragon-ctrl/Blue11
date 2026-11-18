import { describe, expect, it } from 'vitest';
import { assemble, DeviceMachine, KBD, KEY, keyCode, Keyboard, SimpleMachine, type Frame, type KeyboardOptions } from '../src/index.js';
import { KEY_SYMBOLS, KEYBOARD_EXAMPLES, SIM_SYMBOLS } from '../examples/examples.js';
import { assembleOk } from './helpers/asm';
import { uncommentedLines } from './helpers/comments';

const SYMBOLS: Record<string, number> = { KBDCS: KBD.KBDCS, KBDBUF: KBD.KBDBUF, KBDKEY: KBD.KBDKEY, KBDVEC: KBD.VEC, ...KEY_SYMBOLS };

/** A SimpleMachine with a keyboard, booted with `src` (not run yet). */
function boot(src: string, keyboard: KeyboardOptions = {}) {
  const m = new SimpleMachine({ keyboard });
  const asm = assembleOk(src, { symbols: SYMBOLS });
  m.boot(asm);
  return { m, k: m.keyboard!, asm };
}

/** A machine with a keyboard and no program: the host reads the bus itself. */
function bare(keyboard: KeyboardOptions = {}) {
  const m = new SimpleMachine({ keyboard });
  m.boot(assembleOk(' HALT'));
  return { m, k: m.keyboard! };
}

const csr = (m: DeviceMachine) => m.read(KBD.KBDCS, false);
const buf = (m: DeviceMachine) => m.read(KBD.KBDBUF, false);
const keyByte = (m: DeviceMachine, code: number) => m.read(KBD.KBDKEY + code, true);

describe('blue11 Keyboard: codes', () => {
  it('keyCode maps every key of the spec, left and right modifiers to one code', () => {
    const want: Record<string, number> = {
      ArrowUp: 1, ArrowDown: 2, ArrowLeft: 3, ArrowRight: 4,
      ShiftLeft: 5, ShiftRight: 5, ControlLeft: 6, ControlRight: 6, AltLeft: 7, AltRight: 7,
      Backspace: 0o10, Tab: 0o11, Enter: 0o15, Escape: 0o33, Space: 0o40,
      Quote: 0o47, Comma: 0o54, Minus: 0o55, Period: 0o56, Slash: 0o57, Semicolon: 0o73, Equal: 0o75,
      BracketLeft: 0o133, Backslash: 0o134, BracketRight: 0o135, Backquote: 0o140, Delete: 0o177,
    };
    for (let i = 0; i < 10; i++) want[`Digit${i}`] = 0o60 + i;
    for (let i = 0; i < 26; i++) want[`Key${String.fromCharCode(65 + i)}`] = 0o101 + i;
    for (const [code, k] of Object.entries(want)) expect(keyCode(code), code).toBe(k);
    expect(Object.keys(want).length).toBe(63);
  });

  it('anything else is 0', () => {
    for (const c of ['F1', 'Home', 'MetaLeft', 'Numpad1', 'NumpadEnter', 'IntlBackslash', '', 'keya', 'toString', 'constructor']) {
      expect(keyCode(c), c).toBe(0);
    }
  });

  it("'A in the assembler is the code of the A key", () => {
    const a = assemble(" .WORD 'A, '7");
    expect([a.bytes[0], a.bytes[2]]).toEqual([keyCode('KeyA'), keyCode('Digit7')]);
  });

  it('the simulator names are the codes, and at most 6 characters', () => {
    expect(KEY_SYMBOLS['K.RGHT']).toBe(KEY.RIGHT);
    expect(KEY_SYMBOLS['K.SPC']).toBe(0o40);
    for (const name of Object.keys(KEY_SYMBOLS)) expect(name.length).toBeLessThanOrEqual(6);
  });
});

describe('blue11 Keyboard: setup', () => {
  it('defaults', () => {
    const k = new Keyboard();
    expect([k.base, k.mapBase, k.vector, k.level, k.queueSize]).toEqual([0o176700, 0o177000, 0o330, 4, 16]);
    expect([k.registers.base, k.registers.size, k.map.base, k.map.size]).toEqual([0o176700, 0o40, 0o177000, 0o200]);
  });

  it('host mistakes throw at setup', () => {
    expect(() => new Keyboard({ base: 0o176701 })).toThrow(/even/);
    expect(() => new Keyboard({ base: 0o177760 })).toThrow(/registers/);
    expect(() => new Keyboard({ map: 0o177700 })).toThrow(/key map/);
    expect(() => new Keyboard({ queue: 0 })).toThrow(/queue/);
    expect(() => new Keyboard({ queue: 1.5 })).toThrow(/queue/);
    const k = new Keyboard();
    expect(() => k.press(0)).toThrow(/1–177/);
    expect(() => k.press(0o200)).toThrow(/1–177/);
  });

  it('SimpleMachine({ keyboard: true }) plugs both ranges in', () => {
    const m = new SimpleMachine({ keyboard: true });
    expect(m.keyboard).toBeInstanceOf(Keyboard);
    expect(new SimpleMachine().keyboard).toBeNull();
    m.keyboard!.press(KEY.UP);
    expect(m.read(0o177001, true)).toBe(0o200);
    expect(m.read(0o176700, false)).toBe(0o200);
  });

  it('other addresses', () => {
    const k = new Keyboard({ base: 0o170000, map: 0o170200 });
    const m = new DeviceMachine().add(k.registers).add(k.map);
    m.boot(assembleOk(' HALT'));
    k.press('KeyA');
    expect(m.read(0o170200 + 0o101, true)).toBe(0o200);
    expect(m.read(0o170002, false)).toBe(0o101);
  });
});

describe('blue11 Keyboard: the key map', () => {
  it('press sets the byte to 200, release to 0', () => {
    const { m, k } = bare();
    k.press(keyCode('KeyA'));
    expect(keyByte(m, 0o101)).toBe(0o200);
    expect(k.keys[0o101]).toBe(0o200);
    k.release('KeyA');
    expect(keyByte(m, 0o101)).toBe(0);
  });

  it('TSTB / BMI tests a key', () => {
    const { m, k } = boot(`
        TSTB @#KBDKEY+K.LEFT
        BPL  1$
        INC  R1
1$:     TSTB @#KBDKEY+'Q
        BPL  2$
        INC  R2
2$:     HALT`);
    k.press(KEY.LEFT);
    m.run(1000);
    expect([m.cpu.r[1], m.cpu.r[2]]).toEqual([1, 0]);
  });

  it('a word read gives two keys, writes are ignored, reading has no side effects', () => {
    const { m, k } = bare();
    k.press(KEY.UP); // odd: the high byte of 177000
    k.press(KEY.DOWN); // even: the low byte of 177002
    expect(m.read(0o177000, false)).toBe(0o100000);
    expect(m.read(0o177002, false)).toBe(0o200);
    expect(m.write(0o177002, 0, false)).toBe(true);
    expect(m.write(0o177001, 0, true)).toBe(true);
    expect(m.read(0o177000, false)).toBe(0o100000);
    expect(m.read(0o177002, false)).toBe(0o200);
    expect(csr(m)).toBe(0o200); // reading the map took nothing from the queue
    expect(buf(m)).toBe(KEY.UP);
  });

  it('writing the map from a program does not trap', () => {
    const { m } = boot(`
        CLR  @#KBDKEY
        MOVB #1, @#KBDKEY+101
        HALT`);
    expect(m.run(1000).reason).toBe('halt');
  });

  it('a modifier stays down while either of its keys is down', () => {
    const { m, k } = bare();
    k.press('ShiftLeft');
    k.press('ShiftRight');
    k.release('ShiftLeft');
    expect(keyByte(m, KEY.SHIFT)).toBe(0o200);
    k.release('ShiftRight');
    expect(keyByte(m, KEY.SHIFT)).toBe(0);
    // One press and one release came through.
    expect([buf(m), buf(m), buf(m)]).toEqual([KEY.SHIFT, KEY.SHIFT | 0o200, 0]);
    expect(k.log.map((e) => e.down)).toEqual([true, false]);
  });

  it('releaseAll lets every key go', () => {
    const { m, k } = bare();
    k.press('KeyW');
    k.press('ControlLeft');
    k.press('ControlRight');
    k.releaseAll();
    expect(k.keys.every((b) => b === 0)).toBe(true);
    expect([buf(m), buf(m), buf(m), buf(m), buf(m)]).toEqual([0o127, 6, 0o327, 0o206, 0]);
  });

  it('unknown browser keys are ignored', () => {
    const { m, k } = bare();
    k.press('F5');
    k.press('MetaLeft');
    expect(csr(m)).toBe(0);
    expect(k.log).toEqual([]);
  });
});

describe('blue11 Keyboard: the queue', () => {
  it('events come out in order, releases with bit 7 set; empty reads 0', () => {
    const { m, k } = bare();
    k.press('KeyA');
    k.press(KEY.SPACE);
    k.release('KeyA');
    expect(csr(m)).toBe(0o200);
    expect(buf(m)).toBe(0o101);
    expect(csr(m)).toBe(0o200); // the next came up at once
    expect(buf(m)).toBe(0o40);
    expect(buf(m)).toBe(0o301);
    expect(csr(m)).toBe(0);
    expect(buf(m)).toBe(0);
  });

  it('MOVB sign-extends a release; BIC #177600 leaves the code; a byte read takes the event', () => {
    const { m, k } = boot(`
        MOVB @#KBDBUF, R0
        MOV  R0, R1
        BIC  #177600, R1
        MOVB @#KBDBUF+1, R2     ; the high byte: 0, and the next event is gone too
        MOV  @#KBDCS, R3
        HALT`);
    k.press('KeyB');
    expect(buf(m)).toBe(0o102);
    k.release('KeyB');
    k.press('KeyC');
    m.run(1000);
    expect(m.cpu.r[0]).toBe(0o177702);
    expect(m.cpu.r[1]).toBe(0o102);
    expect(m.cpu.r[2]).toBe(0);
    expect(m.cpu.r[3]).toBe(0); // KeyC went with the byte read
    expect(buf(m)).toBe(0);
  });

  it('the 17th event is dropped and sets OVR; only writing 0 clears it', () => {
    const { m, k } = bare();
    for (let i = 0; i < 8; i++) { k.press(0o101 + i); k.release(0o101 + i); }
    expect(csr(m)).toBe(0o200);
    k.press('KeyZ');
    expect(csr(m)).toBe(0o100200);
    expect(k.keys[0o132]).toBe(0o200); // the key map is still right
    m.write(KBD.KBDCS, 0o100000, false); // writing 1: no effect
    expect(csr(m)).toBe(0o100200);
    m.write(KBD.KBDCS, 0o377, true); // the low byte: OVR stays
    expect(csr(m)).toBe(0o100300);
    m.write(KBD.KBDCS + 1, 0o200, true); // the high byte, bit 15 as 1
    expect(csr(m)).toBe(0o100300);
    m.write(KBD.KBDCS + 1, 0, true); // the high byte, bit 15 as 0: cleared
    expect(csr(m)).toBe(0o300);
    k.press('KeyY');
    m.write(KBD.KBDCS, 0o100, false); // a word with bit 15 as 0: cleared
    expect(csr(m)).toBe(0o300);
    const got: number[] = [];
    for (let i = 0; i < 17; i++) got.push(buf(m));
    expect(got.slice(0, 16)).toEqual(Array.from({ length: 16 }, (_, i) => (0o101 + (i >> 1)) | (i & 1 ? 0o200 : 0)));
    expect(got[16]).toBe(0);
  });

  it('BIC #100000, @#KBDCS clears OVR and keeps IE', () => {
    const { m, k } = boot(`
        BIS  #100, @#KBDCS
        BIC  #100000, @#KBDCS
        MOV  @#KBDCS, R1
        HALT`, { queue: 1 });
    k.press(KEY.UP);
    k.press(KEY.DOWN);
    m.cpu.psw = 0o340;
    m.run(1000);
    expect(m.cpu.r[1]).toBe(0o300);
  });

  it('a repeated press or release is ignored', () => {
    const { m, k } = bare();
    k.press('KeyA');
    k.press('KeyA');
    k.press(0o101);
    k.release('KeyB');
    k.release('KeyA');
    k.release('KeyA');
    expect([buf(m), buf(m), buf(m)]).toEqual([0o101, 0o301, 0]);
  });

  it('a key pressed by code and released by name (or the other way round) comes up', () => {
    const { m, k } = bare();
    k.press(0o101);
    k.release('KeyA');
    k.press('ArrowUp');
    k.release(KEY.UP);
    k.press('ShiftLeft');
    k.press('ShiftRight');
    k.release(KEY.SHIFT); // a code lets go of both sides
    expect(k.keys.every((b) => b === 0)).toBe(true);
    expect([buf(m), buf(m), buf(m), buf(m), buf(m), buf(m), buf(m)]).toEqual([0o101, 0o301, 1, 0o201, 5, 0o205, 0]);
  });

  it('KBDBUF ignores writes; the hole is a bus error', () => {
    const { m, k } = bare();
    k.press('KeyA');
    expect(m.write(KBD.KBDBUF, 0o123, false)).toBe(true);
    expect(m.write(KBD.KBDBUF + 1, 1, true)).toBe(true);
    expect(csr(m)).toBe(0o200);
    for (let a = 0o176704; a < 0o177000; a += 2) {
      expect(m.read(a, false)).toBeLessThan(0);
      expect(m.write(a, 0, false)).toBe(false);
    }
  });

  it('a program touching the hole traps to 4', () => {
    const { m } = boot(`
        TST  @#176704
        HALT`);
    let vector = -1;
    m.cpu.onTrap = (t) => { vector = t.vector; return 'stop'; };
    m.run(1000);
    expect(vector).toBe(4);
  });
});

describe('blue11 Keyboard: interrupts', () => {
  const HANDLER = `
        MOV  #ISR, @#KBDVEC
        MOV  #200, @#KBDVEC+2`;

  it('on arrival with IE', () => {
    const { m, k } = boot(`${HANDLER}
        MOV  #100, @#KBDCS
1$:     TST  R1
        BEQ  1$
        HALT
ISR:    MOVB @#KBDBUF, R1
        RTI`);
    m.run(200);
    expect(m.cpu.r[1]).toBe(0);
    k.press('KeyK');
    expect(m.run(200).reason).toBe('halt');
    expect(m.cpu.r[1]).toBe(0o113);
  });

  it('on setting IE while DONE is set, and for the next event after a read', () => {
    const { m, k } = boot(`${HANDLER}
        MOV  #100, @#KBDCS
        HALT
ISR:    INC  R2
        MOVB @#KBDBUF, R1
        ADD  R1, R3
        RTI`);
    k.press(0o101); k.press(0o102); k.press(0o103);
    expect(m.run(1000).reason).toBe('halt');
    expect(m.cpu.r[2]).toBe(3);
    expect(m.cpu.r[3]).toBe(0o101 + 0o102 + 0o103);
  });

  it('withdrawn when the queue empties or IE is cleared', () => {
    const { m, k } = bare();
    k.press('KeyA');
    m.write(KBD.KBDCS, 0o100, false);
    expect(m.cpu.save().pending.length).toBe(1);
    m.write(KBD.KBDCS, 0, false);
    expect(m.cpu.save().pending.length).toBe(0);
    m.write(KBD.KBDCS, 0o100, false);
    expect(m.cpu.save().pending.length).toBe(1);
    buf(m);
    expect(m.cpu.save().pending.length).toBe(0);
    k.press('KeyB');
    expect(m.cpu.save().pending).toEqual([{ vector: 0o330, level: 4 }]);
  });

  it('no request without IE', () => {
    const { m, k } = bare();
    k.press('KeyA');
    expect(m.cpu.save().pending.length).toBe(0);
  });

  it('WAIT wakes on a scheduled event, at its cycle', () => {
    const { m, k } = boot(`${HANDLER}
        MOV  #100, @#KBDCS
        WAIT
        HALT
ISR:    MOVB @#KBDBUF, R1
        MOV  @#KBDCS, R2
        RTI`);
    k.at(5000, 'Space', true);
    expect(m.run(100000).reason).toBe('halt');
    expect(m.cpu.r[1]).toBe(0o40);
    expect(k.log).toEqual([{ cycle: 5000, code: 0o40, down: true }]);
    expect(m.cycles).toBeGreaterThanOrEqual(5000);
    expect(m.cycles).toBeLessThan(5100);
  });

  it('WAIT with IE and nothing scheduled sleeps out the budget (waiting for the host)', () => {
    const { m, k } = boot(`${HANDLER}
        MOV  #100, @#KBDCS
        WAIT
        HALT
ISR:    MOVB @#KBDBUF, R1
        RTI`);
    expect(m.run(10000).reason).toBe('wait');
    k.press('KeyX');
    expect(m.run(10000).reason).toBe('halt');
    expect(m.cpu.r[1]).toBe(0o130);
  });

  it('WAIT without IE stops at once: nothing could wake it', () => {
    const { m } = boot(`
        WAIT
        HALT`);
    const r = m.run(100000);
    expect(r.reason).toBe('wait');
    expect(r.cycles).toBeLessThan(100);
  });
});

describe('blue11 Keyboard: reset', () => {
  it('power-up: everything up, empty and clear; held keys read as up until pressed again', () => {
    const { m, k } = bare();
    k.press('KeyA');
    k.press('KeyB');
    m.write(KBD.KBDCS, 0o100, false);
    k.at(9999, 'KeyC', true);
    m.boot(assembleOk(' HALT'));
    expect(csr(m)).toBe(0);
    expect(k.keys.every((b) => b === 0)).toBe(true);
    expect(k.log).toEqual([]);
    expect(k.cycle).toBe(0);
    expect(m.cpu.save().pending).toEqual([]);
    k.release('KeyA'); // the host lets go of a key held through power-up: ignored
    expect(csr(m)).toBe(0);
    m.run(20000);
    expect(k.keys[0o103]).toBe(0); // the scheduled press was forgotten
    k.press('KeyA');
    expect(keyByte(m, 0o101)).toBe(0o200);
  });

  it('RESET clears IE and the request, and keeps the keys, the queue and OVR', () => {
    const { m, k } = boot(`
        BIS  #100, @#KBDCS
        RESET
        HALT`, { queue: 1 });
    k.press('KeyA');
    k.press('KeyB'); // dropped: OVR
    m.cpu.psw = 0o340;
    m.run(1000);
    expect(csr(m)).toBe(0o100200);
    expect(m.cpu.save().pending).toEqual([]);
    expect(k.keys[0o101]).toBe(0o200);
    expect(k.keys[0o102]).toBe(0o200);
    expect(buf(m)).toBe(0o101);
  });
});

describe('blue11 Keyboard: replay', () => {
  // Polls the queue and keeps a checksum of the events with the cycle count they were read at.
  const SRC = `
LOOP:   TSTB @#KBDCS
        BPL  LOOP
        MOVB @#KBDBUF, R0
        ADD  R0, R1
        ADD  R1, R2
        INC  R3
        CMP  R3, #5
        BLO  LOOP
        HALT`;

  it('live input between runs and the same log scheduled with at give the same run', () => {
    const live = boot(SRC);
    const input: Array<[number, string, boolean]> = [
      [100, 'KeyA', true], [1000, 'ShiftLeft', true], [1700, 'KeyA', false],
      [2500, 'ShiftRight', true], [3000, 'ShiftLeft', false], [3001, 'ShiftRight', false], [9000, 'Space', true],
    ];
    for (const [cycle, key, down] of input) {
      live.m.run(cycle - live.m.cycles);
      if (down) live.k.press(key); else live.k.release(key);
    }
    live.m.run(100000);
    expect(live.m.cpu.halted).toBe(true);
    const log = live.k.log;
    expect(log.length).toBe(5);

    const replay = boot(SRC);
    for (const e of log) replay.k.at(e.cycle, e.code, e.down);
    replay.m.run(100000);
    expect(replay.k.log).toEqual(log);
    expect([...replay.m.cpu.r]).toEqual([...live.m.cpu.r]);
    expect(replay.m.cycles).toBe(live.m.cycles);
    expect([...replay.m.ram]).toEqual([...live.m.ram]);
  });

  it('a scheduled event takes effect at the first instruction boundary at or after its cycle', () => {
    const { m, k } = boot(`
1$:     TSTB @#KBDCS
        BPL  1$
        HALT`);
    k.at(1001, 'KeyA', true);
    m.run(100000);
    const at = k.log[0].cycle;
    expect(at).toBeGreaterThanOrEqual(1001);
    expect(at).toBeLessThan(1001 + 10);
    // The CPU stopped there, so the very next TSTB sees it.
    expect(m.cycles - at).toBeLessThan(20);
  });

  it('at the current cycle applies at once; in the past throws', () => {
    const { m, k } = boot(' BR .');
    m.run(500);
    k.at(m.cycles, 'KeyA', true);
    expect(k.keys[0o101]).toBe(0o200);
    expect(() => k.at(m.cycles - 1, 'KeyB', true)).toThrow(/past/);
    expect(() => k.at(1.5 + m.cycles, 'KeyB', true)).toThrow(/past/);
  });

  it('events scheduled for the same cycle keep their order', () => {
    const { m, k } = boot(' BR .');
    k.at(300, 'KeyB', true);
    k.at(200, 'KeyA', true);
    k.at(300, 'KeyB', false);
    k.at(300, 'KeyC', true);
    m.run(1000);
    expect(k.log.map((e) => [e.code, e.down])).toEqual([[0o101, true], [0o102, true], [0o102, false], [0o103, true]]);
  });

  it('state() → JSON → load() gives the same run', () => {
    const machine = () => {
      const k = new Keyboard({ queue: 4 });
      const m = new DeviceMachine().add(k.registers).add(k.map);
      m.boot(assembleOk(`
        MOV  #ISR, @#330
        MOV  #200, @#332
        MOV  #100, @#KBDCS
1$:     INC  R5
        BR   1$
ISR:    MOVB @#KBDBUF, R0
        ADD  R0, R1
        ADD  R1, R2
        RTI`, { symbols: SYMBOLS }));
      for (let i = 0; i < 40; i++) k.at(137 * i + 50, 0o101 + (i % 5), i % 3 !== 0);
      k.at(200, 'ShiftLeft', true);
      return { m, k };
    };
    const a = machine();
    a.m.run(2500);
    a.k.press('KeyZ');
    const snap = JSON.stringify({ cpu: a.m.cpu.save(), ram: [...a.m.ram], cycles: a.m.cycles, kbd: a.k.state() });
    a.m.run(5000);
    const want = JSON.stringify({ r: [...a.m.cpu.r], kbd: a.k.state(), keys: [...a.k.keys] });

    const b = machine();
    const s = JSON.parse(snap);
    b.m.cpu.load(s.cpu); b.m.ram.set(s.ram); b.m.cycles = s.cycles;
    b.k.load(s.kbd);
    b.m.run(5000);
    expect(JSON.stringify({ r: [...b.m.cpu.r], kbd: b.k.state(), keys: [...b.k.keys] })).toBe(want);
    expect(a.k.log.length).toBeGreaterThan(10);
    expect(a.k.state().held).toContain('ShiftLeft');
  });
});

describe('blue11 Keyboard: example programs', () => {
  type Input = Array<[number, string, boolean]>;
  const run = (name: string, input: Input, budget = 1_000_000) => {
    const ex = KEYBOARD_EXAMPLES.find((e) => e.name.startsWith(name))!;
    const m = new SimpleMachine({ display: true, keyboard: true });
    m.boot(assembleOk(ex.source, { symbols: SIM_SYMBOLS }));
    for (const [cycle, key, down] of input) m.keyboard!.at(cycle, key, down);
    const frames: Frame[] = [];
    m.display!.onFrame = (f) => frames.push(f);
    const result = m.run(budget);
    return { m, frames, result };
  };
  const F = 20000; // cycles per frame

  it.each(KEYBOARD_EXAMPLES.map((e) => [e.name, e] as const))('%s has a comment on every instruction', (_n, ex) => {
    expect(uncommentedLines(ex.source)).toEqual([]);
  });

  it('moving a dot: right held for three frames moves it three pixels; Q quits', () => {
    const { frames, result } = run('Moving a dot', [
      [2 * F + 500, 'ArrowRight', true], [5 * F + 500, 'ArrowRight', false], [7 * F + 500, 'KeyQ', true],
    ]);
    expect(result.reason).toBe('halt');
    const dot = (f: Frame) => {
      const lit = [...f.pixels.keys()].filter((i) => f.pixels[i]);
      expect(lit.length).toBe(1);
      return [lit[0] % 64, Math.floor(lit[0] / 64)];
    };
    expect(frames.map(dot)).toEqual([[32, 32], [32, 32], [32, 32], [33, 32], [34, 32], [35, 32], [35, 32], [35, 32]]);
  });

  it('moving a dot: off the left edge, on at the right', () => {
    const input: Input = [[100, 'ArrowLeft', true], [100, 'ArrowUp', true], [33 * F + 500, 'KeyQ', true]];
    const { frames } = run('Moving a dot', input, 2_000_000);
    const last = frames.at(-1)!;
    const i = last.pixels.findIndex((p) => p !== 0);
    expect([i % 64, Math.floor(i / 64)]).toEqual([63, 63]);
  });

  it('key names: GETKEY skips releases and prints each press', () => {
    const keys = ['KeyH', 'KeyI', 'Digit7', 'Space', 'ArrowUp', 'ShiftLeft', 'Enter', 'Escape'];
    const input: Input = keys.flatMap((k, i) => [[1000 * i + 100, k, true], [1000 * i + 600, k, false]] as Input);
    const { m, result } = run('Key names', input);
    expect(result.reason).toBe('halt');
    expect(m.output).toBe('H I 7 SPACE UP ? ENTER ESC');
  });

  it('counting Space: the interrupt counts presses, releases and other keys are not counted', () => {
    const input: Input = [];
    for (let i = 0; i < 3; i++) input.push([5000 * i + 1000, 'Space', true], [5000 * i + 3000, 'Space', false]);
    input.push([16000, 'KeyA', true], [17000, 'KeyA', false], [30000, 'Escape', true]);
    const { m, result } = run('Counting Space', input);
    expect(result.reason).toBe('halt');
    expect(m.output).toBe('3');
    expect(m.cycles).toBeLessThan(30100); // it slept between keys
  });

  it('a short tap: missed by the key map, caught by the queue', () => {
    const { m, result } = run('A short tap', [[3 * F + 5000, 'Space', true], [3 * F + 5200, 'Space', false]]);
    expect(result.reason).toBe('halt');
    expect(m.output).toBe('MAP 0, QUEUE 1');
  });

  it('a long press: seen by both', () => {
    const { m } = run('A short tap', [[3 * F + 5000, 'Space', true], [5 * F + 5000, 'Space', false]]);
    expect(m.output).toBe('MAP 2, QUEUE 1');
  });
});
