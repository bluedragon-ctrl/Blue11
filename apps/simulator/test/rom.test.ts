import { assemble, SimpleMachine, type Frame } from 'blue11';
import { describe, expect, it } from 'vitest';
import { GLYPHS, glyphBytes } from '../src/font';
import { makeRom, programSymbols, ROM_SOURCE, romAssembly } from '../src/rom';

const FONT = 0o162000;
const sym = (n: string) => romAssembly().symbols.get(n);

/** A machine with the display and the ROM, running `body` then HALT. */
function run(body: string) {
  const m = new SimpleMachine({ display: true });
  m.add(makeRom());
  const asm = assemble(`${body}\n        HALT\n`, { symbols: programSymbols() });
  expect(asm.errors).toEqual([]);
  m.boot(asm);
  const r = m.run(1_000_000);
  expect(r.reason).toBe('halt');
  return m;
}

describe('the ROM', () => {
  it('assembles inside 160000–167777 with the layout of the display spec §11', () => {
    const asm = romAssembly();
    expect(asm.ok).toBe(true);
    expect(asm.warnings).toEqual([]);
    expect(asm.origin).toBe(0o160000);
    expect(asm.origin + asm.bytes.length).toBeLessThanOrEqual(0o164000);
    expect([sym('DRAWCH'), sym('DRAWC1'), sym('FONT')]).toEqual([0o160000, 0o160004, FONT]);
    // The routines fit in 160010–161777.
    const code = asm.lines.filter((l) => l.bytes.length && l.address < FONT);
    expect(Math.max(...code.map((l) => l.address + l.bytes.length))).toBeLessThanOrEqual(0o162000);
    expect(Math.min(...code.filter((l) => l.address >= 0o160010).map((l) => l.address))).toBe(0o160010);
  });

  it('starts with its licence and says the font is its own', () => {
    expect(ROM_SOURCE.split('\n').slice(0, 8).join('\n')).toMatch(/MIT licence[\s\S]*not copied/);
  });

  it('holds the font of src/font.ts: 128 characters of 8 bytes, codes 0–37 and 177 blank', () => {
    const rom = makeRom();
    for (let c = 0; c < 128; c++) {
      const at = FONT - 0o160000 + 8 * c;
      expect([...rom.bytes.subarray(at, at + 8)], `character ${c.toString(8)}`).toEqual(glyphBytes(c));
    }
    for (const c of [...Array(0o40).keys(), 0o177]) expect(glyphBytes(c).every((b) => b === 0)).toBe(true);
    expect(Object.keys(GLYPHS).length).toBe(95);
  });

  it('every printable character but space has a picture, and no two are the same', () => {
    const seen = new Map<string, string>();
    for (let c = 0o41; c <= 0o176; c++) {
      const b = glyphBytes(c);
      expect(b.some((x) => x), String.fromCharCode(c)).toBe(true);
      const k = b.join();
      expect(seen.get(k), `${String.fromCharCode(c)} looks like ${seen.get(k)}`).toBeUndefined();
      seen.set(k, String.fromCharCode(c));
      for (const row of GLYPHS[String.fromCharCode(c)].split(' ')) expect(row).toMatch(/^[.#]{5}$/);
      expect(GLYPHS[String.fromCharCode(c)].split(' ').length).toBeLessThanOrEqual(8);
    }
  });

  it('is read-only: a write to it is a bus error', () => {
    const m = new SimpleMachine({ display: true });
    m.add(makeRom());
    m.boot(assemble(' MOV #1, @#FONT\n HALT', { symbols: programSymbols() }));
    m.cpu.onTrap = () => 'stop';
    expect(m.run(100)).toMatchObject({ reason: 'trap', trap: { cause: 'bus-error' } });
  });
});

/** The glyph of `c` as 8 strings of 8, from the font bytes (bit 7 first). */
const picture = (c: number) => glyphBytes(c).map((b) => [...Array(8)].map((_, x) => (b & (0o200 >> x) ? '#' : '.')).join(''));

describe('DRAWCH (mode 0)', () => {
  it('draws every character as its glyph, only its own pixels, and moves R1 one cell right', () => {
    for (let c = 0o40; c <= 0o176; c++) {
      // a grey background shows that the other pixels are left alone
      const m = run(`
        MOV  #SCREEN, R1
        MOV  #4000, R0
1$:     MOV  #4010, (R1)+
        SOB  R0, 1$
        MOV  #${c.toString(8)}, R0
        MOV  #SCREEN+1010, R1
        MOV  #16, R2
        MOV  #123, R3
        MOV  #456, R4
        MOV  #777, R5
        JSR  PC, @#DRAWCH`);
      const b = m.display!.bytes;
      const got = [...Array(8)].map((_, y) => [...Array(8)].map((_, x) => {
        const v = b[(8 + y) * 64 + 8 + x];
        expect([0o10, 0o16]).toContain(v);
        return v === 0o16 ? '#' : '.';
      }).join(''));
      expect(got, String.fromCharCode(c)).toEqual(picture(c));
      expect([...m.cpu.r.slice(0, 6)]).toEqual([c, 0o120000 + 0o1020, 0o16, 0o123, 0o456, 0o777]);
      // nothing outside the cell
      const painted = [...b.subarray(0, 0o10000)].filter((v) => v === 0o16).length;
      expect(painted).toBe(picture(c).join('').split('#').length - 1);
    }
  });

  it('costs about 400 cycles a character (the spec says so)', () => {
    const m = new SimpleMachine({ display: true });
    m.add(makeRom());
    m.boot(assemble(' MOV #101, R0\n MOV #SCREEN, R1\n MOV #17, R2\n JSR PC, @#DRAWCH\n HALT', { symbols: programSymbols() }));
    m.run(10_000);
    expect(m.cycles).toBeGreaterThan(300);
    expect(m.cycles).toBeLessThan(700);
  });
});

describe('DRAWC1 (mode 1)', () => {
  /** Pixel (x, y) of a mode 1 frame. */
  const px = (f: Frame, x: number, y: number) => f.pixels[y * 128 + x];

  it('draws every character as its glyph, two pixels a byte, and moves R1 four bytes right', () => {
    for (let c = 0o40; c <= 0o176; c++) {
      const m = run(`
        MOV  #4, @#DSPCS
        MOV  #SCREEN, R1
        MOV  #10000, R0
1$:     MOV  #104210, (R1)+
        SOB  R0, 1$
        MOV  #${c.toString(8)}, R0
        MOV  #SCREEN+1006, R1
        MOV  #177765, R2
        MOV  #123, R3
        JSR  PC, @#DRAWC1
        MOV  R1, R5
        BIC  #200, @#DSPCS
2$:     TSTB @#DSPCS
        BPL  2$`);
      const f = m.display!.frame;
      expect(f.width).toBe(128);
      const got = [...Array(8)].map((_, y) => [...Array(8)].map((_, x) => {
        const v = px(f, 12 + x, 8 + y);
        expect([0o10, 0o5]).toContain(v);
        return v === 0o5 ? '#' : '.';
      }).join(''));
      expect(got, String.fromCharCode(c)).toEqual(picture(c));
      expect([0, 1, 2, 3, 5].map((i) => m.cpu.r[i])).toEqual([c, 0o121012, 0o177765, 0o123, 0o121012]);
      expect([...f.pixels].filter((v) => v === 5).length).toBe(picture(c).join('').split('#').length - 1);
    }
  });
});
