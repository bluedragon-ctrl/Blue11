/**
 * The Blue-11 MCP server: the tools of session.ts over the Model Context Protocol, on stdio.
 * An agent (Claude Code, Claude Desktop, any MCP client) writes Blue-11 assembly, runs it on
 * the simulator's machine, sees the console, the registers and the screen, steps through it,
 * and gives the person a link that opens the program in the simulator in their browser.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DEFAULT_SIMULATOR_URL, MAX_FRAMES, MAX_SNAPSHOTS, Session } from './session';

export const INSTRUCTIONS = `Blue-11 is a PDP-11-style 16-bit computer for teaching, with a screen, a keyboard, a console and a speaker. These tools run programs on the same machine as the browser simulator (with its ROM), headless and deterministic: the same call always gives the same result.

Writing Blue-11 assembly (a subset of MACRO-11):
- Numbers are octal; a trailing dot is decimal (10 is eight, 10. is ten). Results are shown in octal too.
- A line: optional "LABEL:", the instruction, operands source first ("MOV #3, R0"), then "; comment". Local labels: 1$, 2$.
- The program is assembled from 001000 and starts at its first instruction (or the label after .END). SP starts at 001000, growing down. End with HALT.
- Predefined names: the console (RCSR, RBUF, XCSR, XBUF), the line clock (LKS), the display (SCREEN, DSPCS, DSPFRM, DSPLIN, DSPPAL, DSPVEC), the keyboard (KBDCS, KBDBUF, KBDKEY, KBDVEC, key codes K.UP, K.LEFT, K.SPC...), the sound (SNDCS, SNDDIV), PSW, and the ROM's DRAWCH, DRAWC1 and FONT.
- The screen is memory: mode 0 is 64 x 64 pixels, a byte each, at SCREEN + row*100 + column (octal); mode 1 is 128 x 128, 4 bits a pixel.
- MUL, DIV, ASH and ASHC need eis: true.
Read help (no arguments for the contents, or a query such as "DSPCS" or "MOVB") and the examples before writing something new: they are short and correct.

The workflow: assemble to check, run (it reports the console output, registers, the stop and its source line, the screen as an image, and a link), then step, state, memory or continue to debug. A run is in screen frames: 60 frames are one second of machine time (20000 cycles each). Keyboard and console input are given with the frame they happen at. When a program works, give the person its share link: it opens in the simulator at ${DEFAULT_SIMULATOR_URL}, where they can run and step it themselves.`;

const breakpoints = z.array(z.union([z.number().int(), z.string()])).optional()
  .describe('Where to stop before an instruction: source line numbers (numbers), or labels, symbols or octal addresses (strings, e.g. "LOOP" or "1020").');
const frames = z.number().int().min(1).max(MAX_FRAMES).optional()
  .describe(`Screen frames to run at most (60 a second of machine time, 20000 cycles each). Default 300. The run ends sooner on HALT, a trap, a breakpoint or a WAIT nothing can wake.`);
const snapshots = z.array(z.number().int().min(1)).max(MAX_SNAPSHOTS).optional()
  .describe('Frame numbers (counted from the boot) after which to capture the screen as well, to see an animation.');
const screen = z.boolean().optional()
  .describe('true: always include the screen image; false: never. Default: include it unless it is one colour.');
const source = z.string().describe('Blue-11 assembly source.');
const eis = z.boolean().optional().describe('The EIS option (MUL, DIV, ASH, ASHC). Default false.');
const beam = z.enum(['instant', 'scan']).optional().describe('"scan": the real beam, which tears. Default "instant".');

export function createServer(session = new Session(process.env.BLUE11_SIMULATOR_URL || undefined)): McpServer {
  const server = new McpServer({ name: 'blue11', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  const read = { readOnlyHint: true, openWorldHint: false };

  server.registerTool('assemble', {
    title: 'Assemble',
    description: 'Assemble Blue-11 source without running it: errors on their lines, or the size, start address and symbols (octal). listing: true adds the assembler\'s listing.',
    inputSchema: { source, eis, listing: z.boolean().optional().describe('Include the listing (address, octal words, source).') },
    annotations: read,
  }, (a) => session.assemble(a));

  server.registerTool('run', {
    title: 'Run a program',
    description: 'Assemble, boot and run a program on a fresh machine. Reports why it stopped (and the source line), the console output, the registers and the next instructions, the screen as a PNG, and a share link to open it in the browser simulator. The machine stays loaded for step, continue, state, memory and screen.',
    inputSchema: {
      source, frames, eis, beam, breakpoints, snapshots, screen,
      inputs: z.array(z.object({
        frame: z.number().min(0).optional().describe('When: the frame (default 0, the start).'),
        cycle: z.number().int().min(0).optional().describe('When, exactly: the cycle since the boot (instead of frame).'),
        text: z.string().optional().describe('Characters typed on the console (RBUF); a newline is Enter (CR, 015).'),
        key: z.string().optional().describe('A key on the keyboard device (KBDKEY, KBDBUF), as a KeyboardEvent.code: ArrowLeft, ArrowUp, KeyA, Digit1, Space, Enter, ShiftLeft...'),
        down: z.boolean().optional().describe('For key: true presses, false releases. Leave out for a tap.'),
        hold_frames: z.number().int().min(1).optional().describe('For a tap: frames the key is held (default 2).'),
      })).optional().describe('Keyboard and console input, at the frames they happen.'),
    },
  }, (a) => session.run(a));

  server.registerTool('continue', {
    title: 'Continue',
    description: 'Go on running the loaded program (after a breakpoint, a HALT, or a run that used up its frames), past a breakpoint at the PC. Reports as run does.',
    inputSchema: { frames, breakpoints, snapshots, screen },
  }, (a) => session.continue(a));

  server.registerTool('step', {
    title: 'Step',
    description: 'Run the loaded program one instruction at a time: for each, its address, the instruction, its source line and the registers it changed. Stops early on HALT, a trap or a breakpoint.',
    inputSchema: { count: z.number().int().min(1).max(500).optional().describe('Instructions to run (default 1).') },
  }, (a) => session.step(a));

  server.registerTool('state', {
    title: 'CPU state',
    description: 'The registers, the PSW and its flags, the next instructions and the stack of the loaded program, without running it.',
    annotations: read,
  }, () => session.state());

  server.registerTool('memory', {
    title: 'Read memory',
    description: 'Read the machine\'s memory, in octal: words, bytes, instructions (disassembled, with labels and source lines) or text. Reading RBUF or KBDBUF is skipped, as it would take a character.',
    inputSchema: {
      address: z.string().describe('An octal address ("1000"), a label, a device register name (DSPCS, SCREEN), or a register (R0–R5, SP, PC: its value).'),
      count: z.number().int().min(1).max(512).optional().describe('Words, bytes, instructions or characters to show (default 16).'),
      format: z.enum(['words', 'bytes', 'instructions', 'text']).optional().describe('Default words.'),
    },
    annotations: read,
  }, (a) => session.memory(a));

  server.registerTool('screen', {
    title: 'Screen',
    description: 'The screen as a PNG, as the simulator shows it: the last frame the display latched while running, pixel memory once the program has ended.',
    inputSchema: { now: z.boolean().optional().describe('true: pixel memory as it is now, even in the middle of a frame.') },
    annotations: read,
  }, (a) => session.screen(a));

  server.registerTool('share_link', {
    title: 'Share link',
    description: 'A URL that opens a program in the Blue-11 simulator in the browser, ready to run and step. Default: the program last run, with its settings.',
    inputSchema: { source: source.optional(), eis, beam },
    annotations: read,
  }, (a) => session.shareLink(a));

  server.registerTool('help', {
    title: 'Help',
    description: 'The simulator\'s help: no arguments for the contents; section for a page (as Markdown, with examples); query to look up an instruction, directive, device register or topic.',
    inputSchema: {
      section: z.string().optional().describe('A section id from the contents, e.g. "display", "ins-move", "addressing".'),
      query: z.string().optional().describe('A name (MOVB, DSPCS, .ASCIZ) or words to search for.'),
    },
    annotations: read,
  }, (a) => session.helpTool(a));

  server.registerTool('examples', {
    title: 'Examples',
    description: 'The simulator\'s example programs (first steps, console, display, keyboard, sound, text with the ROM): no id for the list, an id for its source and what to do with it.',
    inputSchema: { id: z.string().optional() },
    annotations: read,
  }, (a) => session.examples(a));

  return server;
}
