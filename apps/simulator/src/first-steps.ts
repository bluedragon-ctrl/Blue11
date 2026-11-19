/**
 * First steps: the programs a beginner meets first, in the Programs menu before the
 * library's examples. Each adds one idea to the one before, is short, has a comment on
 * every line, and says what to try. test/examples.test.ts runs each one and checks what it
 * draws or prints. The help's Getting started points here.
 */

import type { Program } from './programs';

export const FIRST_STEPS: Array<Omit<Program, 'id' | 'group'>> = [
  {
    name: '1. A pixel',
    source: `
; FIRST STEPS 1: a pixel.
; The screen is memory: each byte from SCREEN on is one pixel, and the
; number in it is the pixel's colour (0-17). So writing a byte paints a pixel.
; Press Run. Then try another colour, or another place:
; +4040 means row 40, column 40: the middle (numbers are octal: 40 is 32.).
        MOVB #16, @#SCREEN+4040 ; put 16 (yellow) into the pixel at row 40, column 40
        MOVB #4, @#SCREEN+4050  ; put 4 (red) 8 pixels to the right (+10 octal)
        HALT                    ; stop the CPU
`,
  },
  {
    name: '2. Registers and sums',
    source: `
; FIRST STEPS 2: registers.
; R0-R5 are the CPU's own storage places, called registers.
; Press Step instruction (F10) again and again, and watch R0 and R1 in the CPU panel.
; Numbers are octal: 10 is eight. Write a dot for decimal: 12. is twelve.
        MOV  #5, R0             ; R0 = 5
        MOV  #3, R1             ; R1 = 3
        ADD  R1, R0             ; R0 = R0 + R1 = 10 (eight, in octal)
        SUB  #2, R0             ; R0 = R0 - 2 = 6
        INC  R1                 ; R1 = R1 + 1 = 4
        HALT                    ; stop: now look at the CPU panel
`,
  },
  {
    name: '3. Variables in memory',
    source: `
; FIRST STEPS 3: memory.
; A label with .WORD keeps a word of memory for a number: a variable.
; Step through it. Type SCORE in the Memory panel to watch the variables.
        MOV  SCORE, R0          ; read a variable into a register: R0 = 100
        ADD  BONUS, R0          ; add another variable: R0 = 150
        MOV  R0, SCORE          ; write the result back into memory
        INC  LIVES              ; add 1 to a variable, right there in memory
        HALT                    ; stop: SCORE is 150 and LIVES is 4
SCORE:  .WORD 100               ; a variable, starting at 100
BONUS:  .WORD 50                ; another one, at 50
LIVES:  .WORD 3                 ; and another, at 3
`,
  },
  {
    name: '4. A loop: a line',
    source: `
; FIRST STEPS 4: a loop.
; R1 holds the address of a pixel: it "points at" it, and (R1) is that pixel.
; R0 counts the pixels still to draw. SOB means "subtract one and branch":
; R0 = R0 - 1, and back to LOOP until R0 is 0.
; Try: a longer line (up to 100), or a line going down (ADD #100, R1).
        MOV  #SCREEN+2000, R1   ; R1 = the address of the first pixel of row 20
        MOV  #40, R0            ; R0 = 40 pixels to draw (32 in decimal)
LOOP:   MOVB #12, (R1)          ; colour 12 (light green) into the pixel R1 points at
        INC  R1                 ; R1 = the next pixel to the right
        SOB  R0, LOOP           ; one less to draw; not 0 yet: draw the next one
        HALT                    ; stop
`,
  },
  {
    name: '5. Decisions: two colours',
    source: `
; FIRST STEPS 5: decisions.
; CMP compares two numbers. The branch after it jumps only if its condition
; holds: BLO "branch if lower". Otherwise the next line runs.
; (R1)+ is the pixel R1 points at, and then R1 moves on to the next one.
; Try: change the 40 in the first CMP, or the colours.
        MOV  #SCREEN+4000, R1   ; R1 = the first pixel of row 40
        CLR  R2                 ; R2 = x, the column: 0
LOOP:   CMP  R2, #40            ; compare x with 40, the middle
        BLO  LEFT               ; x < 40: go to LEFT
        MOVB #1, (R1)+          ; the right half: blue
        BR   NEXT               ; jump over the left half's line
LEFT:   MOVB #4, (R1)+          ; the left half: red
NEXT:   INC  R2                 ; x = x + 1
        CMP  R2, #100           ; the end of the row?
        BLO  LOOP               ; not yet: the next pixel
        HALT                    ; stop
`,
  },
  {
    name: '6. Printing text',
    source: `
; FIRST STEPS 6: the console.
; The console prints one character at a time and needs a moment for each.
; Bit 7 of XCSR is 1 when it is ready. TSTB copies bit 7 into the N flag,
; and BPL ("branch if plus": N is 0) waits while it is not ready.
; The text ends with a 0 byte (.ASCIZ adds it), so the loop knows where to stop.
        MOV  #TEXT, R1          ; R1 = the address of the first character
NEXT:   MOVB (R1)+, R0          ; R0 = a character; R1 moves on to the next
        BEQ  DONE               ; it was the 0 at the end: done
READY:  TSTB @#XCSR             ; is the console ready? (bit 7)
        BPL  READY              ; not yet: ask again
        MOVB R0, @#XBUF         ; print the character
        BR   NEXT               ; and go on with the next one
DONE:   HALT                    ; stop
TEXT:   .ASCIZ /Hi there!/      ; the text, with a 0 byte at the end
`,
    expect: 'Hi there!',
  },
  {
    name: '7. A subroutine',
    source: `
; FIRST STEPS 7: subroutines.
; HLINE draws a line. JSR PC, HLINE calls it, and its RTS PC comes back to
; the line after the call. Write it once, use it many times: before each
; call, put where and which colour into R1 and R2.
; Try: a fourth line, or make HLINE take the length in R3.
        MOV  #SCREEN+1010, R1   ; where: row 10, column 10
        MOV  #4, R2             ; colour 4: red
        JSR  PC, HLINE          ; draw the line
        MOV  #SCREEN+2010, R1   ; row 20, column 10
        MOV  #16, R2            ; colour 16: yellow
        JSR  PC, HLINE          ; draw the line
        MOV  #SCREEN+3010, R1   ; row 30, column 10
        MOV  #2, R2             ; colour 2: green
        JSR  PC, HLINE          ; draw the line
        HALT                    ; stop

; HLINE: draw 60 pixels from the address in R1, in colour R2. Changes R0 and R1.
HLINE:  MOV  #60, R0            ; 60 pixels to draw
1$:     MOVB R2, (R1)+          ; paint one and move right
        SOB  R0, 1$             ; the rest of them
        RTS  PC                 ; back to the caller
`,
  },
  {
    name: '8. Moving with the keys',
    keys: 'Click the screen, then hold ← or →. Q quits.',
    source: `
; FIRST STEPS 8: a tiny game loop.
; Run, click the screen, then hold the left or right arrow key. Q quits.
; A game repeats the same steps every frame (60 times a second):
; draw, wait for the next frame, erase, read the keys, move.
; KBDKEY+code is a byte that is 200 while that key is held down. 200 has its
; top bit set, so it counts as negative: TSTB then BPL skips when the key is up.
        MOV  #SCREEN+4040, R1   ; R1 = where the dot is: the middle
LOOP:   MOVB #17, (R1)          ; draw the dot in white
        BIC  #200, @#DSPCS      ; clear the display's DONE bit...
FRAME:  TSTB @#DSPCS            ; ...and wait until it is set again:
        BPL  FRAME              ;    then the next frame has started
        CLRB (R1)               ; erase the dot (colour 0 is black)
        TSTB @#KBDKEY+K.LEFT    ; is the left arrow down?
        BPL  1$                 ; no: skip the next line
        DEC  R1                 ; yes: one pixel to the left
1$:     TSTB @#KBDKEY+K.RGHT    ; is the right arrow down?
        BPL  2$                 ; no: skip the next line
        INC  R1                 ; yes: one pixel to the right
2$:     TSTB @#KBDKEY+'Q        ; is Q down?
        BPL  LOOP               ; no: round the loop again
        HALT                    ; yes: stop
`,
  },
];
