/**
 * The programs in the Examples menu: the first steps for beginners (first-steps.ts), the
 * library's examples (console, display, keyboard, sound) and the ROM's showcase (docs/BLUE11_DISPLAY.md §11), which use DRAWCH and DRAWC1.
 */

import type { AsmError, Beam } from 'blue11';
import type { Simulator } from './sim';
import { FIRST_STEPS } from './first-steps';
import { DISPLAY_EXAMPLES, EXAMPLES, KEYBOARD_EXAMPLES, SOUND_EXAMPLES, VSYNC } from '../../../packages/blue11/examples/examples';

export interface Program {
  /** Unique, for the menu and the URL. */
  id: string;
  group: 'First steps' | 'Console' | 'Display' | 'Keyboard' | 'Sound' | 'Text (the ROM)';
  name: string;
  source: string;
  /** The beam it is meant for. */
  beam?: Beam;
  /** What to type on the console (the page suggests it; the tests type it). */
  input?: string;
  /** What to do with it, shown above the screen. */
  keys?: string;
  /** Console output it ends with (the console examples). */
  expect?: string;
}

const PRINT = `
; PRINT: draw the text at R3 (up to its 0 byte) from the cell at R1, in colour R2.
PRINT:  MOVB (R3)+, R0          ; the next character
        BEQ  1$                 ; 0: the end of the text
        JSR  PC, @#DRAWCH       ; draw it; R1 moves on to the next cell
        BR   PRINT              ; the next character
1$:     RTS  PC                 ; back to the caller`;

export const ROM_EXAMPLES: Array<Omit<Program, 'id' | 'group'>> = [
  {
    name: 'Hello (DRAWCH, mode 0)',
    source: `
; Text on the screen with the ROM's DRAWCH. A cell is 8 x 8 pixels, so the
; 64 x 64 screen holds 8 lines of 8 characters. Line n starts at SCREEN + n*1000.
; Try: the ROM tab shows DRAWCH's source; Step into it with JSR.
        MOV  #SCREEN+1000, R1   ; line 1, column 0
        MOV  #16, R2            ; colour 16: yellow
        MOV  #HELLO, R3         ; the text
        JSR  PC, PRINT          ; draw it
        MOV  #SCREEN+2010, R1   ; line 2, column 1 (+10: 8 pixels to the right)
        MOV  #13, R2            ; colour 13: light cyan
        MOV  #WORLD, R3         ; the text
        JSR  PC, PRINT          ; draw it
        MOV  #SCREEN+5000, R1   ; line 5, column 0
        MOV  #17, R2            ; colour 17: white
        MOV  #BLUE, R3          ; the text
        JSR  PC, PRINT          ; draw it
        JSR  PC, VSYNC          ; wait for the blank: the picture is shown
        HALT                    ; stop the CPU
HELLO:  .ASCIZ /Hello,/         ; each text ends with a 0 byte
WORLD:  .ASCIZ /world!/         ;
BLUE:   .ASCIZ /Blue-11/        ;
        .EVEN                   ; code must start at an even address
${PRINT}
${VSYNC}
`,
  },
  {
    name: 'Font viewer (DRAWC1, mode 1)',
    source: `
; All 96 printable characters of the ROM's font (40-177), 16 to a line, in
; mode 1: 128 x 128 pixels, so 16 x 16 characters. A cell is 4 bytes wide
; (two pixels a byte) and line n starts at SCREEN + n*1000.
        MOV  #4, @#DSPCS        ; MODE = 1 (bit 2): 128 x 128, from the next blank
        MOV  #40, R0            ; the first character: space
        MOV  #SCREEN+2000, R1   ; line 2, column 0
        MOV  #11, R2            ; the first line's colour: 11, light blue
1$:     JSR  PC, @#DRAWC1       ; draw R0; R1 moves 4 bytes to the right
        INC  R0                 ; the next character
        BIT  #17, R0            ; 20 characters done: a new line?
        BNE  1$                 ; not yet
        ADD  #2000-100, R1      ; R1 is one row down: go to the line after next
        INC  R2                 ; the next line's colour
        CMP  R0, #200           ; past the last character, 177?
        BLO  1$                 ; no: the next line
        JSR  PC, VSYNC          ; wait for the blank: the picture is shown
        HALT                    ; stop the CPU
${VSYNC}
`,
  },
  {
    name: 'My own DRAWCH (a colour per row)',
    source: `
; The ROM is just code: here is its mode 0 routine copied into the program and
; changed, so that every row of a glyph gets the next colour (R2, R2+1, ...).
; Compare MYDRAW with DRAW0 in the ROM tab: one line is new.
        MOV  #SCREEN+1000, R1   ; line 1, column 0
        MOV  #10, R2            ; the top row's colour: 10, then 11, 12...
        MOV  #TEXT1, R3         ; the text
        JSR  PC, MYTEXT         ; draw it with MYDRAW
        MOV  #SCREEN+3000, R1   ; line 3, column 0
        MOV  #TEXT2, R3         ; the text
        JSR  PC, MYTEXT         ; draw it with MYDRAW
        MOV  #SCREEN+5000, R1   ; line 5: the ROM's DRAWCH, for comparison
        MOV  #17, R2            ; colour 17: white
        MOV  #TEXT3, R3         ; the text
        JSR  PC, PRINT          ; draw it with DRAWCH
        JSR  PC, VSYNC          ; wait for the blank: the picture is shown
        HALT                    ; stop the CPU
TEXT1:  .ASCIZ /Rainbow/        ; each text ends with a 0 byte
TEXT2:  .ASCIZ /letters/        ;
TEXT3:  .ASCIZ /ROM font/       ;
        .EVEN                   ; code must start at an even address

; MYTEXT: PRINT, but with MYDRAW.
MYTEXT: MOVB (R3)+, R0          ; the next character
        BEQ  1$                 ; 0: the end of the text
        JSR  PC, MYDRAW         ; draw it
        BR   MYTEXT             ; the next character
1$:     RTS  PC                 ; back to the caller

; MYDRAW: DRAWCH with a colour per row. R0 = the character, R1 = the cell's top
; left pixel, R2 = the top row's colour. R1 moves to the next cell.
MYDRAW: MOV  R0, -(SP)          ; keep the registers we use
        MOV  R2, -(SP)          ; (R2 too: this version changes it)
        MOV  R3, -(SP)          ;
        MOV  R4, -(SP)          ;
        MOV  R5, -(SP)          ;
        BIC  #177600, R0        ; 0-177 only
        ASL  R0                 ; R0 * 2
        ASL  R0                 ; R0 * 4
        ASL  R0                 ; R0 * 10: the glyph's offset in the font
        ADD  #FONT, R0          ; R0 = the glyph's top row
        MOV  #10, R4            ; 8 rows
1$:     MOVB (R0)+, R3          ; one row of the glyph: bit 7 is the leftmost pixel
        MOV  #10, R5            ; 8 pixels
2$:     ASLB R3                 ; the next pixel into C
        BCC  3$                 ; 0: leave the pixel as it is
        MOVB R2, (R1)           ; 1: paint it
3$:     INC  R1                 ; one pixel to the right
        SOB  R5, 2$             ; the rest of the row
        INC  R2                 ; NEW: the next row gets the next colour
        ADD  #100-10, R1        ; one row down, back to the cell's left edge
        SOB  R4, 1$             ; the next row
        SUB  #1000-10, R1       ; back up 8 rows, and one cell to the right
        MOV  (SP)+, R5          ; put the registers back
        MOV  (SP)+, R4          ;
        MOV  (SP)+, R3          ;
        MOV  (SP)+, R2          ;
        MOV  (SP)+, R0          ;
        RTS  PC                 ; back to the caller
${PRINT}
${VSYNC}
`,
  },
];

const slug = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Every example, in menu order. */
export const PROGRAMS: Program[] = [
  ...FIRST_STEPS.map((e) => ({ ...e, id: `first-${slug(e.name)}`, group: 'First steps' as const })),
  ...EXAMPLES.map((e) => ({ id: `console-${slug(e.name)}`, group: 'Console' as const, name: e.name, source: e.source, input: e.input, expect: e.expect })),
  ...DISPLAY_EXAMPLES.map((e) => ({ id: `display-${slug(e.name)}`, group: 'Display' as const, name: e.name, source: e.source, beam: e.beam })),
  ...KEYBOARD_EXAMPLES.map((e) => ({ id: `keyboard-${slug(e.name)}`, group: 'Keyboard' as const, name: e.name, source: e.source, keys: e.keys })),
  ...SOUND_EXAMPLES.map((e) => ({ id: `sound-${slug(e.name)}`, group: 'Sound' as const, name: e.name, source: e.source, keys: 'Turn the sound on; at real time it plays at its true pitch, try other speeds. The Sound tab shows the speaker.' })),
  ...ROM_EXAMPLES.map((e) => ({ ...e, id: `text-${slug(e.name)}`, group: 'Text (the ROM)' as const })),
];

/** The first program on a fresh page: the first of the first steps. */
export const FIRST = PROGRAMS[0];

/**
 * Start an example as the page does (its beam, then load it), and type its console input
 * as a student would. Returns the assembler's errors (none for the examples).
 */
export function startProgram(sim: Simulator, p: Program): AsmError[] {
  sim.configure({ beam: p.beam ?? 'instant' });
  const errors = sim.load(p.source);
  if (!errors.length) for (const ch of p.input ?? '') sim.type(ch);
  return errors;
}
