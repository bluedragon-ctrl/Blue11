/**
 * One sentence per predefined name a program can use without defining it
 * (`programSymbols()`, src/rom.ts: the device registers, the key codes and the ROM's entry
 * points). The sections show them where they belong (the display's registers with the
 * display); every name must be described and shown exactly once: test/help.test.ts.
 */

import { octal } from 'blue11';
import { programSymbols } from '../rom';
import type { Entry } from './model';

export const SYMBOL_HELP: Readonly<Record<string, string>> = {
  // Console (DL11)
  RCSR: 'Console receiver status: bit 7 (DONE) = a typed character is waiting in `RBUF`; bit 6 = IE, interrupt at vector 60.',
  RBUF: 'Console receiver data: the character typed. Reading it clears DONE, and the next character typed (if any) comes in.',
  XCSR: 'Console transmitter status: bit 7 (READY) = ready for the next character; bit 6 = IE, interrupt at vector 64.',
  XBUF: 'Console transmitter data: write a character here (the low 7 bits) and it is printed.',
  // Line clock (KW11-L), PSW
  LKS: 'Line clock status: bit 7 is set at every tick (once a frame, 60 a second) and cleared by writing it as 0; bit 6 (IE) interrupts at vector 100, level 6.',
  PSW: 'The processor status word, in memory: the priority (bits 7–5) and the flags N Z V C (bits 3–0).',
  // Display
  SCREEN: 'The first byte of pixel memory, page 0: the top-left pixel. 16 KB to 157777.',
  DSPCS: 'Display control and status: `PAGE` (bits 1–0), `MODE` (bit 2), IE (bit 6), DONE (bit 7, set at every vertical blank).',
  DSPFRM: 'Frame counter (read only): +1 at every vertical blank.',
  DSPLIN: 'The beam (read only): the row it reads next, or 177777 during the vertical blank.',
  DSPPAL: 'The palette: 16 words, entry n at `DSPPAL+2*n`, each an RGB colour `rgb` in three octal digits (0–7 each).',
  DSPVEC: 'Display interrupt vector: at every vertical blank, with IE set.',
  // Keyboard
  KBDCS: 'Keyboard status: DONE (bit 7) = an event is waiting in `KBDBUF`; IE (bit 6); OVR (bit 15) = events were lost.',
  KBDBUF: 'The oldest key event (read only): the key code in bits 6–0, bit 7 set for a release. Reading takes it out of the queue.',
  KBDKEY: 'The key map: one byte per key, 200 while it is down. Key k is at `KBDKEY+k`: `TSTB @#KBDKEY+\'A`.',
  KBDVEC: 'Keyboard interrupt vector: an event is waiting, with IE set.',
  'K.UP': 'Key code of ↑.',
  'K.DOWN': 'Key code of ↓.',
  'K.LEFT': 'Key code of ←.',
  'K.RGHT': 'Key code of →.',
  'K.SHFT': 'Key code of Shift (left or right).',
  'K.CTRL': 'Key code of Ctrl (left or right).',
  'K.ALT': 'Key code of Alt (left or right).',
  'K.BS': 'Key code of Backspace.',
  'K.TAB': 'Key code of Tab.',
  'K.ENT': 'Key code of Enter.',
  'K.ESC': 'Key code of Esc.',
  'K.SPC': 'Key code of Space.',
  'K.DEL': 'Key code of Delete.',
  // Sound
  SNDCS: 'The speaker: bit 0, 1 out and 0 in (the other bits read 0). Switch it with `XOR`: the pitch comes from the cycles between two switches.',
  SNDDIV: 'The tone generator: a half period in cycles. Not 0, it switches the speaker by itself every `SNDDIV` cycles (1364. is an A); 0 stops it.',
  // ROM
  DRAWCH: 'Draw a character in mode 0: R0 = the character, R1 = the address of the cell\'s top-left pixel, R2 = the colour. R1 moves to the next cell.',
  DRAWC1: 'Draw a character in mode 1: R0 = the character, R1 = the byte of the cell\'s top-left pixel, R2 = the colour. R1 moves to the next cell.',
  FONT: 'The font: 8 bytes per character, character c at `FONT+c*10`, the top row first, bit 7 the leftmost pixel.',
};

/** Entries for these names, with their octal values. */
export function symbolEntries(...names: string[]): Entry[] {
  const values = programSymbols();
  return names.map((n) => {
    const v = values[n];
    if (v === undefined) throw new Error(`help: no symbol ${n}`);
    return { anchor: `sym-${n}`, names: [n], term: `\`${n}\``, detail: `= ${octal(v, v > 0o777 ? 6 : 1)}`, text: SYMBOL_HELP[n] ?? '' };
  });
}
