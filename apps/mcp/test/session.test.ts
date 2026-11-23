import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sharedProgram } from '../../simulator/src/storage';
import { PROGRAMS } from '../../simulator/src/programs';
import { SECTIONS } from '../../simulator/src/help/sections';
import { rgbaToPng } from '../src/png';
import { Session, toInputs, type ToolResult } from '../src/session';

const textOf = (r: ToolResult) => r.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
const images = (r: ToolResult) => r.content.filter((c) => c.type === 'image') as Array<{ data: string; mimeType: string }>;

const HELLO = `
        MOV #MSG, R1
1$:     MOVB (R1)+, R0
        BEQ 2$
3$:     TSTB @#XCSR
        BPL 3$
        MOVB R0, @#XBUF
        BR 1$
2$:     MOVB #16, @#SCREEN+4040
        HALT
MSG:    .ASCIZ /HELLO/
`;

/** Echo the console until Enter. */
const ECHO = `
1$:     TSTB @#RCSR
        BPL 1$
        MOVB @#RBUF, R0
        CMPB R0, #15
        BEQ 3$
2$:     TSTB @#XCSR
        BPL 2$
        MOVB R0, @#XBUF
        BR 1$
3$:     HALT
`;

const COUNT = `
        CLR  R0
LOOP:   INC  R0
        BR   LOOP
`;

describe('png', () => {
  it('writes an RGB PNG, scaled, that inflates to its rows', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]); // red, blue
    const png = rgbaToPng(rgba, 2, 1, 2);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(4); // width
    expect(png.readUInt32BE(20)).toBe(2); // height
    const idatLen = png.readUInt32BE(33);
    expect(png.toString('latin1', 37, 41)).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    const row = [0, 255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255];
    expect([...raw]).toEqual([...row, ...row]);
  });
});

describe('Session', () => {
  it('runs a program: the stop and its line, the console, the screen and a link', () => {
    const s = new Session();
    const r = s.run({ source: HELLO });
    expect(r.isError).toBeUndefined();
    const t = textOf(r);
    expect(t).toContain('Ended: HALT at 001032 (line 10: HALT)');
    expect(t).toContain('```\nHELLO\n```');
    expect(t).toContain('R1=001042');
    const [img] = images(r);
    expect(img.mimeType).toBe('image/png');
    const png = Buffer.from(img.data, 'base64');
    expect(png.readUInt32BE(16)).toBe(256);
    const url = /Open it in the simulator: (\S+)/.exec(t)![1];
    expect(url.startsWith('https://bluedragon-ctrl.github.io/Blue11/#code=')).toBe(true);
    expect(sharedProgram(url.slice(url.indexOf('#')))).toEqual({ source: HELLO, beam: 'instant', eis: false });
  });

  it('is deterministic: the same call gives the same result', () => {
    const a = new Session().run({ source: COUNT, frames: 7 });
    const b = new Session().run({ source: COUNT, frames: 7 });
    expect(a).toEqual(b);
  });

  it('reports assembler errors with their lines, as an error', () => {
    const s = new Session();
    for (const r of [s.run({ source: ' MOV #1, R9\n HALT' }), s.assemble({ source: ' MOV #1, R9\n HALT' })]) {
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain('line 1: undefined symbol R9');
    }
  });

  it('assembles: size, symbols and the listing', () => {
    const t = textOf(new Session().assemble({ source: HELLO, listing: true }));
    expect(t).toContain('Assembled: 34. bytes at 001000–001041, start 001000.');
    expect(t).toMatch(/MSG\s+001034/);
    expect(t.split('Listing:')[0]).not.toContain('XCSR'); // predefined names are not the program's
    expect(t).toContain('Listing:');
  });

  it('types on the console at a frame; a newline is Enter', () => {
    const t = textOf(new Session().run({ source: ECHO, inputs: [{ frame: 3, text: 'HI\n' }] }));
    expect(t).toContain('```\nHI\n```');
    expect(t).toContain('Ended: HALT');
  });

  it('presses keys: the moving-dot example moves, and quits on Q', () => {
    const dot = PROGRAMS.find((p) => p.id === 'keyboard-moving-a-dot')!;
    const still = new Session().run({ source: dot.source, frames: 40, screen: true });
    const moved = new Session().run({ source: dot.source, frames: 40, screen: true, inputs: [{ frame: 2, key: 'ArrowRight', hold_frames: 20 }] });
    expect(textOf(still)).toContain('Still running');
    expect(images(moved)[0].data).not.toBe(images(still)[0].data);
    const quit = new Session().run({ source: dot.source, frames: 40, inputs: [{ frame: 5, key: 'KeyQ' }] });
    expect(textOf(quit)).toContain('Ended: HALT');
  });

  it('stops at breakpoints (lines and labels), steps, and continues', () => {
    const s = new Session();
    expect(textOf(s.run({ source: COUNT, breakpoints: ['LOOP'] }))).toContain('Stopped at a breakpoint: 001002 (LOOP, line 3: LOOP:   INC  R0)');
    const st = textOf(s.step({ count: 5 }));
    expect(st).toMatch(/^2 instructions/);
    expect(st).toMatch(/001002 {2}INC R0 +line 3 +R0=000001/);
    expect(st).toMatch(/001004 {2}BR LOOP +line 4\n/);
    expect(st).toContain('Stopped at a breakpoint');
    expect(textOf(s.step({}))).toMatch(/001002 {2}INC R0 +line 3 +R0=000002/);
    expect(textOf(s.continue({}))).toContain('Stopped at a breakpoint: 001002');
    expect(s.sim.cpu.r[0]).toBe(2);
    expect(textOf(s.run({ source: COUNT, breakpoints: [3] }))).toContain('Stopped at a breakpoint: 001002');
    expect(s.run({ source: COUNT, breakpoints: [1000] }).isError).toBe(true);
    expect(s.run({ source: COUNT, breakpoints: ['NOWHERE'] }).isError).toBe(true);
  });

  it('runs at most the frames asked, and continue goes on', () => {
    const s = new Session();
    const t = textOf(s.run({ source: COUNT, frames: 5 }));
    expect(t).toContain('Still running after the frames asked for');
    expect(t).toContain('100000 cycles');
    expect(t).toContain('5 whole frames since the boot');
    expect(textOf(s.continue({ frames: 2 }))).toContain('7 whole frames since the boot');
  });

  it('says what a trap means', () => {
    const t = textOf(new Session().run({ source: ' MOV #1001, R0\n MOV (R0), R1\n HALT' }));
    expect(t).toContain('Ended: Odd address 001001 at 001004');
    expect(t).toContain('line 2');
  });

  it('captures the screen at the frames asked', () => {
    const src = `
        CLR  R1
1$:     MOV  @#DSPFRM, R0           ; wait for the next frame
2$:     CMP  @#DSPFRM, R0
        BEQ  2$
        MOVB #16, SCREEN(R1)
        INC  R1
        BR   1$
`;
    const r = new Session().run({ source: src, frames: 10, snapshots: [2, 6] });
    expect(textOf(r)).toContain('Screen after frame 2:');
    expect(textOf(r)).toContain('Screen after frame 6:');
    const imgs = images(r);
    expect(imgs).toHaveLength(3);
    expect(new Set(imgs.map((i) => i.data)).size).toBe(3);
  });

  it('leaves out a blank screen unless asked', () => {
    const s = new Session();
    const r = s.run({ source: COUNT, frames: 1 });
    expect(images(r)).toHaveLength(0);
    expect(textOf(r)).toContain('Screen: blank');
    expect(images(s.screen())).toHaveLength(1);
    expect(images(s.run({ source: HELLO, screen: false }))).toHaveLength(0);
  });

  it('reads memory as words, bytes, text and instructions', () => {
    const s = new Session();
    s.run({ source: HELLO });
    expect(textOf(s.memory({ address: 'MSG', format: 'text', count: 6 }))).toContain('001034: HELLO\\0');
    expect(textOf(s.memory({ address: '1034', format: 'bytes', count: 2 }))).toContain('001034: 110 105');
    expect(textOf(s.memory({ address: '1000', count: 2 }))).toContain('001000: 012701 001034');
    expect(textOf(s.memory({ address: '1000', format: 'instructions', count: 2 }))).toMatch(/001000 {2}012701 001034 .*MOV #001034, R1 {3}; line 2/);
    expect(textOf(s.memory({ address: 'R1', count: 1 }))).toContain('Memory from 001042');
    expect(textOf(s.memory({ address: 'RBUF', count: 1 }))).toContain('------');
    expect(s.memory({ address: 'NOPE' }).isError).toBe(true);
  });

  it('needs a program for step, continue and state', () => {
    const s = new Session();
    expect(s.step({}).isError).toBe(true);
    expect(s.continue({}).isError).toBe(true);
    expect(s.state().isError).toBe(true);
    expect(s.shareLink({}).isError).toBe(true);
  });

  it('makes share links, to another simulator if asked', () => {
    const s = new Session('http://localhost:5173/');
    const t = textOf(s.shareLink({ source: ' HALT', eis: true, beam: 'scan' }));
    expect(t.startsWith('http://localhost:5173/#code=')).toBe(true);
    expect(sharedProgram(t.slice(t.indexOf('#')))).toEqual({ source: ' HALT', beam: 'scan', eis: true });
  });

  it('serves the help: contents, every section, and lookups', () => {
    const s = new Session();
    expect(textOf(s.helpTool({}))).toContain('`ins-move`: Moving data');
    for (const sec of SECTIONS) {
      const r = s.helpTool({ section: sec.id });
      expect(r.isError).toBeUndefined();
      expect(textOf(r)).toContain(`## ${sec.title}`);
      expect(textOf(r)).not.toMatch(/\]\([\w-]+(#[\w.$-]+)?\)/); // no help-internal links left
    }
    expect(textOf(s.helpTool({ query: 'DSPCS' }))).toContain('**');
    expect(s.helpTool({ section: 'nope' }).isError).toBe(true);
    expect(s.helpTool({ query: 'zzzzqqq' }).isError).toBe(true);
  });

  it('lists the examples and gives their source, which runs', () => {
    const s = new Session();
    expect(textOf(s.examples({}))).toContain(PROGRAMS[0].id);
    for (const p of PROGRAMS) {
      const t = textOf(s.examples({ id: p.id }));
      const src = /```\n([\s\S]*)\n```/.exec(t)![1];
      expect(s.assemble({ source: src, eis: true }).isError, p.id).toBeUndefined();
    }
    expect(s.examples({ id: 'nope' }).isError).toBe(true);
  });
});

describe('toInputs', () => {
  it('turns frames into cycles, taps into a press and a release, newlines into CR', () => {
    expect(toInputs([{ frame: 1, key: 'Space' }, { cycle: 5, text: 'A\n' }])).toEqual([
      { cycle: 5, kind: 'console', ch: 0o101 },
      { cycle: 5, kind: 'console', ch: 0o15 },
      { cycle: 20000, kind: 'key', code: expect.any(Number), down: true },
      { cycle: 60000, kind: 'key', code: expect.any(Number), down: false },
    ]);
  });

  it('refuses unknown keys and empty inputs', () => {
    expect(() => toInputs([{ key: 'Banana' }])).toThrow(/Unknown key Banana/);
    expect(() => toInputs([{ frame: 1 }])).toThrow(/needs text/);
    expect(() => toInputs([{ text: '€' }])).toThrow(/8-bit/);
  });
});
