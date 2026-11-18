/**
 * The help (src/help/): every instruction and predefined name is described exactly once,
 * every link and anchor resolves, every example assembles with the program's names, the
 * `run` examples run in the simulator to a HALT of their own (not a trap's), and the
 * results they promise hold.
 */
import { assemble, INSTRUCTIONS } from 'blue11';
import { describe, expect, it } from 'vitest';
import { HELP, inComment, parseInline, SECTIONS, wordAt, type Block, type Entry } from '../src/help';
import { OP_GROUPS } from '../src/help/instructions';
import { blockTexts } from '../src/help/model';
import { SYMBOL_HELP } from '../src/help/symbols';
import { programSymbols } from '../src/rom';
import { Simulator } from '../src/sim';

const blocks = (): Array<{ section: string; block: Block }> =>
  SECTIONS.flatMap((s) => s.blocks.map((block) => ({ section: s.id, block })));
const allEntries = (): Entry[] => blocks().flatMap(({ block }) => (block.kind === 'entries' ? block.entries : []));
const codeBlocks = () => blocks().flatMap(({ section, block }) => (block.kind === 'code' ? [{ section, ...block }] : []));

/** Load `text` and run frames until it stops; at most `frames` of them. */
function runToStop(text: string, frames = 10) {
  const s = new Simulator();
  expect(s.load(text)).toEqual([]);
  let r = s.runFrame();
  for (let i = 1; i < frames && r.stop === 'frame'; i++) r = s.runFrame();
  return { s, r };
}

describe('help coverage', () => {
  it('describes every instruction exactly once', () => {
    const named = allEntries().filter((e) => e.anchor.startsWith('op-')).flatMap((e) => e.names);
    expect(new Set(named).size).toBe(named.length);
    expect(new Set(named)).toEqual(new Set(INSTRUCTIONS.map((i) => i.name)));
  });

  it('describes every predefined name, and shows it exactly once', () => {
    const names = Object.keys(programSymbols());
    expect(Object.keys(SYMBOL_HELP).sort()).toEqual([...names].sort());
    for (const [n, t] of Object.entries(SYMBOL_HELP)) expect(t, n).not.toBe('');
    const shown = allEntries().filter((e) => e.anchor.startsWith('sym-')).flatMap((e) => e.names);
    expect(shown.length).toBe(new Set(shown).size);
    expect(new Set(shown)).toEqual(new Set(names));
  });

  it('gives every instruction group a section', () => {
    expect(SECTIONS.filter((s) => s.id.startsWith('ins-')).flatMap((s) => s.blocks).filter((b) => b.kind === 'entries').length)
      .toBe(OP_GROUPS.length);
  });

  it('has unique section ids and anchors', () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const anchors = allEntries().map((e) => e.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it('every link leads to a section and an anchor in it', () => {
    for (const { section, block } of blocks()) {
      for (const text of blockTexts(block)) {
        for (const s of parseInline(text)) {
          if (s.kind !== 'link') continue;
          const target = HELP.section(s.section);
          expect(target, `${section}: link to ${s.section}`).toBeDefined();
          if (s.anchor) {
            const there = target!.blocks.some((b) => b.kind === 'entries' && b.entries.some((e) => e.anchor === s.anchor));
            expect(there, `${section}: link to ${s.section}#${s.anchor}`).toBe(true);
          }
        }
      }
    }
  });

  it('has no unclosed markup', () => {
    for (const { section, block } of blocks()) {
      // an entry's detail (the flags: `N* Z*`) is shown as it is, without markup
      const texts = block.kind === 'entries' ? block.entries.flatMap((e) => [e.term, e.text]) : blockTexts(block);
      for (const text of texts) {
        const plainText = parseInline(text).filter((s) => s.kind === 'text').map((s) => s.text).join('');
        expect(plainText, `${section}: ${text}`).not.toMatch(/`|\*|\]\(/);
      }
    }
  });

  it('the examples it names are in the Programs menu', async () => {
    const { PROGRAMS } = await import('../src/programs');
    const all = blocks().flatMap(({ block }) => blockTexts(block)).join(' ');
    const named = ['Addressing modes tour', 'TRAP as a system call', 'Line clock', 'Echo', 'Counting Space',
      'Circle (mode 1, PLOT1)', 'Bouncing pixel', 'Sky gradient', 'Hello', 'Font viewer', 'My own DRAWCH'];
    for (const name of named) {
      expect(all.includes(`**${name}**`), name).toBe(true);
      expect(PROGRAMS.some((p) => p.name.startsWith(name)), `example “${name}”`).toBe(true);
    }
    // every bold name followed by "example(s)" is one of them
    for (const m of all.matchAll(/\*\*([^*]+)\*\*(?=(?:, \*\*[^*]+\*\*)*(?: and \*\*[^*]+\*\*)? examples?\b)/g)) {
      expect(named, m[1]).toContain(m[1]);
    }
  });
});

describe('help examples', () => {
  it.each(codeBlocks().map((c, i) => [`${c.section} #${i}`, c] as const))('%s assembles without warnings', (_, c) => {
    const asm = assemble(c.text, { symbols: programSymbols() });
    expect(asm.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([]);
    expect(asm.warnings.map((e) => `${e.line}: ${e.message}`)).toEqual([]);
  });

  it.each(codeBlocks().filter((c) => c.run).map((c, i) => [`${c.section} #${i}`, c] as const))('%s runs to its HALT', (_, c) => {
    const { s, r } = runToStop(c.text);
    expect(r.stop).toBe('halt');
    const at = s.cpu.r[7] - 2;
    expect(s.program!.lineAt.has(at), `HALT at ${at.toString(8)} is not in the example`).toBe(true);
  });

  it('the documented results hold', () => {
    const run = (section: string, n = 0) => {
      const c = codeBlocks().filter((b) => b.section === section)[n];
      return runToStop(c.text).s;
    };
    expect(run('addressing').cpu.r[0]).toBe(6);
    expect(run('stack').cpu.r[0]).toBe(6);
    const mem = run('memory').cpu.r;
    expect([mem[0], mem[2], mem[3]]).toEqual([1, 0o30, 'I'.charCodeAt(0)]);
    expect(run('traps').cpu.r[1]).not.toBe(0);
    expect(run('registers').cpu.r[7] - 2).toBe(0o1014); // the HALT at ZERO
    expect(run('directives').cpu.r.slice(0, 2)).toEqual([3, 0o1014]);
    expect(run('ins-move').cpu.r.slice(0, 3)).toEqual([0, 5, 0o101]);
    expect(run('ins-arith').cpu.r[0]).toBe(0o177763);
    expect(run('ins-logic').cpu.r[0]).toBe(0o334);
    expect(run('ins-branch', 0).cpu.r[0]).toBe(7);
    expect(run('ins-branch', 1).cpu.r[0]).toBe(0o17);
    expect(run('console').machine.output).toBe('HELLO');
    // three ticks of the line clock: three frames
    const clock = run('interrupts');
    expect(clock.machine.cycles).toBeGreaterThanOrEqual(3 * 20000);
    expect(clock.machine.cycles).toBeLessThan(4 * 20000);
    // pixels are bytes of the screen's memory
    const byte = (s: Simulator, a: number) => (s.machine.read(a & ~1, false) >> ((a & 1) * 8)) & 0o377;
    const px = (s: Simulator, x: number, y: number) => byte(s, 0o120000 + y * 0o100 + x);
    expect(px(run('start'), 0o40, 0o40)).toBe(0o16);
    const diag = run('display');
    expect([0, 1, 0o77].map((i) => px(diag, i, i))).toEqual([0o12, 0o12, 0o12]);
    // HI: both cells have white pixels, the third none
    const hi = run('rom');
    const lit = (cx: number) => [...Array(64).keys()].some((i) => px(hi, cx * 8 + (i & 7), i >> 3) === 0o17);
    expect([lit(0), lit(1), lit(2)]).toEqual([true, true, false]);
  });
});

describe('help lookup', () => {
  it('finds the word under the cursor', () => {
    const line = '        MOVB #K.UP!K.DOWN, @#KBDKEY+\'A  ; keys';
    expect(wordAt(line, 9)).toBe('MOVB');
    expect(wordAt(line, 12)).toBe('MOVB'); // just after it
    expect(wordAt(line, 13)).toBe('');    // on the #
    expect(wordAt(line, 14)).toBe('K.UP');
    expect(wordAt(line, 20)).toBe('K.DOWN');
    expect(wordAt(line, 30)).toBe('KBDKEY');
    expect(wordAt('MSG: .ASCIZ /HI/', 7)).toBe('.ASCIZ');
    expect(wordAt('', 0)).toBe('');
    expect(inComment(line, 44)).toBe(true);
    expect(inComment(line, 30)).toBe(false);
  });

  it('F1 leads to instructions, byte forms, names, registers and directives', () => {
    expect(HELP.topicFor('mov')).toEqual({ section: 'ins-move', anchor: 'op-MOV' });
    expect(HELP.topicFor('MOVB')).toEqual({ section: 'ins-move', anchor: 'op-MOV' });
    expect(HELP.topicFor('BLO')).toEqual({ section: 'ins-branch', anchor: 'op-BCS' });
    expect(HELP.topicFor('DSPCS')).toEqual({ section: 'display-frames', anchor: 'sym-DSPCS' });
    expect(HELP.topicFor('DSPPAL')).toEqual({ section: 'palette', anchor: 'sym-DSPPAL' });
    expect(HELP.topicFor('KBDBUF')).toEqual({ section: 'keyboard-events', anchor: 'sym-KBDBUF' });
    expect(HELP.topicFor('MUL')).toEqual({ section: 'ins-eis', anchor: 'op-MUL' });
    expect(HELP.topicFor('KBDKEY')).toEqual({ section: 'keyboard', anchor: 'sym-KBDKEY' });
    expect(HELP.topicFor('K.SPC')).toEqual({ section: 'keyboard', anchor: 'sym-K.SPC' });
    expect(HELP.topicFor('XBUF')).toEqual({ section: 'console', anchor: 'sym-XBUF' });
    expect(HELP.topicFor('DRAWCH')).toEqual({ section: 'rom', anchor: 'sym-DRAWCH' });
    expect(HELP.topicFor('SP')).toEqual({ section: 'registers', anchor: 'reg-SP' });
    expect(HELP.topicFor('R3')).toEqual({ section: 'registers', anchor: 'reg-R0' });
    expect(HELP.topicFor('.WORD')).toEqual({ section: 'directives', anchor: 'dir-.WORD' });
    expect(HELP.topicFor('#SCREEN')).toEqual({ section: 'display', anchor: 'sym-SCREEN' });
    expect(HELP.topicFor('LOOP')).toBeNull();
  });

  it('searches names first, then text', () => {
    expect(HELP.search('dspcs')[0]).toMatchObject({ section: 'display-frames', anchor: 'sym-DSPCS' });
    expect(HELP.search('DRAW')[0].anchor).toMatch(/^sym-DRAWC/);
    expect(HELP.search('palette').some((h) => h.section === 'palette')).toBe(true);
    expect(HELP.search('double buffering').some((h) => h.section === 'display-frames')).toBe(true);
    expect(HELP.search('octal').some((h) => h.section === 'octal')).toBe(true);
    expect(HELP.search('   ')).toEqual([]);
  });
});
