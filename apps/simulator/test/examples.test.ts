/**
 * Every example in the menu runs in the simulator the way the page runs it (startProgram,
 * then a frame at a time, keys pressed between frames), and these check what it prints and
 * the frames it draws.
 */
import { assemble, SimpleMachine, type Frame, type Key } from 'blue11';
import { describe, expect, it } from 'vitest';
import { SIM_SYMBOLS } from '../../../packages/blue11/examples/examples';
import { uncommentedLines } from '../../../packages/blue11/test/helpers/comments';
import { glyphBytes } from '../src/font';
import { PROGRAMS, ROM_EXAMPLES, startProgram, type Program } from '../src/programs';
import { Simulator } from '../src/sim';

/** Keys pressed (true) or released (false) before the frame with that index runs. */
type Script = Array<[number, Key, boolean]>;

/** Run a program a frame at a time until it stops (at most `max` frames). */
function play(p: Program, script: Script = [], max = 400) {
  const sim = new Simulator();
  expect(startProgram(sim, p)).toEqual([]);
  const frames: Frame[] = [];
  sim.display.onFrame = (f) => frames.push(f);
  let stop = '';
  for (let i = 0; i < max; i++) {
    for (const [at, key, down] of script) if (at === i) (down ? sim.press(key) : sim.release(key));
    stop = sim.runFrame().stop;
    if (stop !== 'frame') break;
  }
  return { sim, frames, stop, output: sim.machine.output };
}

const byName = (name: string) => PROGRAMS.find((p) => p.name.startsWith(name))!;

describe('the examples menu', () => {
  it('holds every example of the library and the ROM showcase, with unique ids', () => {
    expect(PROGRAMS.length).toBe(7 + 6 + 4 + 3);
    expect(new Set(PROGRAMS.map((p) => p.id)).size).toBe(PROGRAMS.length);
  });

  it.each(ROM_EXAMPLES.map((e) => [e.name, e] as const))('%s has a comment on every line', (_n, e) => {
    expect(uncommentedLines(e.source)).toEqual([]);
  });
});

describe('console examples print what they should', () => {
  it.each(PROGRAMS.filter((p) => p.group === 'Console').map((p) => [p.name, p] as const))('%s', (_n, p) => {
    const { stop, output } = play(p);
    expect(stop).toBe('halt');
    expect(output).toBe(p.expect);
  });
});

describe('display examples draw the frames the library does', () => {
  it.each(PROGRAMS.filter((p) => p.group === 'Display').map((p) => [p.name, p] as const))('%s', (_n, p) => {
    const { stop, frames } = play(p);
    expect(stop).toBe('halt');
    // the same program on a bare SimpleMachine, as test/display.test.ts runs it
    const m = new SimpleMachine({ display: { beam: p.beam } });
    m.boot(assemble(p.source, { symbols: SIM_SYMBOLS }));
    const want: Frame[] = [];
    m.display!.onFrame = (f) => want.push(f);
    m.run(5_000_000);
    expect(frames.length).toBe(want.length);
    expect(frames.length).toBeGreaterThan(0);
    frames.forEach((f, i) => {
      expect(f.pixels).toEqual(want[i].pixels);
      expect(f.palette).toEqual(want[i].palette);
    });
    expect(frames.at(-1)!.pixels.some((x) => x)).toBe(true);
  });
});

describe('keyboard examples, with keys pressed between frames', () => {
  const dot = (f: Frame) => {
    const lit = [...f.pixels.keys()].filter((i) => f.pixels[i]);
    expect(lit.length).toBe(1);
    return [lit[0] % 64, Math.floor(lit[0] / 64)];
  };

  it('moving a dot', () => {
    const { stop, frames } = play(byName('Moving a dot'), [[2, 'ArrowRight', true], [5, 'ArrowRight', false], [8, 'KeyQ', true]]);
    expect(stop).toBe('halt');
    expect(frames.map(dot).slice(0, 8)).toEqual([[32, 32], [32, 32], [33, 32], [34, 32], [35, 32], [35, 32], [35, 32], [35, 32]]);
  });

  it('key names', () => {
    const keys = ['KeyH', 'KeyI', 'Digit7', 'Space', 'ArrowUp', 'ShiftLeft', 'Enter', 'Escape'];
    const { stop, output } = play(byName('Key names'), keys.flatMap((k, i) => [[2 * i + 1, k, true], [2 * i + 2, k, false]] as Script));
    expect(stop).toBe('halt');
    expect(output).toBe('H I 7 SPACE UP ? ENTER ESC');
  });

  it('counting Space', () => {
    const script: Script = [];
    for (let i = 0; i < 3; i++) script.push([2 * i + 1, 'Space', true], [2 * i + 2, 'Space', false]);
    script.push([8, 'KeyA', true], [9, 'KeyA', false], [10, 'Escape', true]);
    const { stop, output } = play(byName('Counting Space'), script);
    expect(stop).toBe('halt');
    expect(output).toBe('3');
  });

  it('a short tap: pressed and released between two frames, only the queue sees it', () => {
    const { output } = play(byName('A short tap'), [[3, 'Space', true], [3, 'Space', false]]);
    expect(output).toBe('MAP 0, QUEUE 1');
  });

  it('a long press: seen by both', () => {
    const { output } = play(byName('A short tap'), [[3, 'Space', true], [5, 'Space', false]]);
    expect(output).toBe('MAP 2, QUEUE 1');
  });
});

describe('text examples (the ROM)', () => {
  /** Where character `c` (8 × 8 at cell column cx, line cy) is lit in colour `colour(row)`, mode 0. */
  function expectText(f: Frame, text: string, cx: number, cy: number, colour: (row: number) => number, w = 64) {
    [...text].forEach((ch, i) => {
      const g = glyphBytes(ch.charCodeAt(0));
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const v = f.pixels[(8 * cy + y) * w + 8 * (cx + i) + x];
        expect(v, `${ch} at ${x},${y}`).toBe(g[y] & (0o200 >> x) ? colour(y) : 0);
      }
    });
  }

  it('Hello draws its three texts with DRAWCH', () => {
    const { stop, frames } = play(byName('Hello ('));
    expect(stop).toBe('halt');
    const f = frames.at(-1)!;
    expectText(f, 'Hello,', 0, 1, () => 0o16);
    expectText(f, 'world!', 1, 2, () => 0o13);
    expectText(f, 'Blue-11', 0, 5, () => 0o17);
    expect([...f.pixels].filter((x) => x).length).toBe(
      [...'Hello,world!Blue-11'].reduce((n, ch) => n + glyphBytes(ch.charCodeAt(0)).reduce((a, b) => a + b.toString(2).split('1').length - 1, 0), 0));
  });

  it('the font viewer shows all 96 characters in mode 1, a colour per line', () => {
    const { stop, frames } = play(byName('Font viewer'));
    expect(stop).toBe('halt');
    const f = frames.at(-1)!;
    expect(f.width).toBe(128);
    for (let line = 0; line < 6; line++) {
      const text = String.fromCharCode(...Array.from({ length: 16 }, (_, i) => 0o40 + 16 * line + i));
      expectText(f, text, 0, 2 + 2 * line, () => 0o11 + line, 128);
    }
  });

  it('my own DRAWCH gives every row of a glyph the next colour', () => {
    const { stop, frames } = play(byName('My own DRAWCH'));
    expect(stop).toBe('halt');
    const f = frames.at(-1)!;
    expectText(f, 'Rainbow', 0, 1, (y) => 0o10 + y);
    expectText(f, 'letters', 0, 3, (y) => 0o10 + y);
    expectText(f, 'ROM font', 0, 5, () => 0o17);
  });
});
