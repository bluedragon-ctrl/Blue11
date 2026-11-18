/**
 * Example programs for a `SimpleMachine` (DL11 console, KW11-L clock, and for
 * `DISPLAY_EXAMPLES` the display). The standalone simulator (docs/ROADMAP.md) shows them;
 * test/examples.test.ts runs each one and checks it prints `expect`, and
 * test/display.test.ts checks the frames the display examples draw.
 */

import { DEV, DSP, PSW_ADDRESS, type Beam } from '../src/index.js';

/** Device register names the examples use (DL11 console, KW11-L clock, display). */
export const SIM_SYMBOLS: Record<string, number> = {
  RCSR: DEV.RCSR, RBUF: DEV.RBUF, XCSR: DEV.XCSR, XBUF: DEV.XBUF, LKS: DEV.LKS, PSW: PSW_ADDRESS,
  SCREEN: DSP.SCREEN, DSPCS: DSP.DSPCS, DSPFRM: DSP.DSPFRM, DSPLIN: DSP.DSPLIN, DSPPAL: DSP.DSPPAL, DSPVEC: DSP.VEC,
};

export interface Example {
  name: string;
  source: string;
  /** Console output after running to HALT (tests). */
  expect: string;
  /** Characters typed on the console before running (tests). */
  input?: string;
  /** Needs the EIS option. */
  eis?: boolean;
}

const PUTC = `
; PUTC: print the character in R0 (waits until the terminal is ready).
PUTC:   TSTB @#XCSR             ; ready? (bit 7 = sign bit of the low byte)
        BPL  PUTC               ; not yet: test again
        MOVB R0, @#XBUF         ; send the character to the terminal
        RTS  PC                 ; back to the caller`;

/** Unsigned 16-bit division, as a subroutine (also used by test/assembler.test.ts). */
export const DIV16 = `
; DIV16: R0 = R0 / R1, R1 = remainder (unsigned). C = 1 if R1 was 0.
DIV16:  TST  R1                 ; dividing by 0?
        BNE  1$                 ; no: go on
        SEC                     ; yes: set C to say so...
        RTS  PC                 ; ...and return
1$:     MOV  R2, -(SP)          ; save R2 and R3 on the stack:
        MOV  R3, -(SP)          ;   the caller's values come back at the end
        MOV  R1, R2             ; R2 = divisor
        CLR  R1                 ; R1 = remainder, built bit by bit
        MOV  #16., R3           ; 16 quotient bits
2$:     ASL  R0                 ; next dividend bit out of R0...
        ROL  R1                 ;   ...into the remainder
        BCS  4$                 ; a 17th bit came out: surely big enough
        CMP  R1, R2             ; remainder >= divisor?
        BLO  3$                 ; no: this quotient bit is 0
4$:     SUB  R2, R1             ; take the divisor out of the remainder
        INC  R0                 ; quotient bit = 1
3$:     SOB  R3, 2$             ; R3 = R3 - 1; bits left: the next one
        MOV  (SP)+, R3          ; restore R3 and R2
        MOV  (SP)+, R2          ;   (the opposite order of saving)
        CLC                     ; C = 0: no error
        RTS  PC                 ; back to the caller`;

const PRDEC = `
; PRDEC: print R0 as an unsigned decimal number. Changes R0, R1.
PRDEC:  MOV  #10., R1            ; divide by ten
        JSR  PC, DIV16          ; R0 = R0 / 10, R1 = the last digit
        MOV  R1, -(SP)          ; keep the digit on the stack
        TST  R0                 ; any higher digits left?
        BEQ  1$                 ; no: print this one
        JSR  PC, PRDEC          ; print the higher digits first (recursion)
1$:     MOV  (SP)+, R0          ; take the digit back off the stack
        ADD  #'0, R0            ; digit -> character
        JMP  PUTC               ; PUTC returns for us`;

/** 16-bit multiplication without EIS, as a subroutine (also used by test/assembler.test.ts). */
export const MUL16 = `
; MUL16: R0 = R0 * R1 (low 16 bits). Changes R1.
MUL16:  MOV  R2, -(SP)          ; save R2
        CLR  R2                 ; running sum
1$:     TST  R1                 ; multiplier bits left?
        BEQ  3$                 ; no: done
        CLC                     ; C = 0, so ROR shifts a 0 in at the top
        ROR  R1                 ; lowest bit of the multiplier -> C
        BCC  2$                 ; bit 0: add nothing
        ADD  R0, R2             ; bit 1: add the shifted multiplicand
2$:     ASL  R0                 ; multiplicand * 2
        BR   1$                 ; the next bit
3$:     MOV  R2, R0             ; the answer in R0
        MOV  (SP)+, R2          ; restore R2
        RTS  PC                 ; back to the caller`;

const CRLF = `
; CRLF: start a new line. Changes R0.
CRLF:   MOV  #15, R0            ; carriage return (octal 15)
        JSR  PC, PUTC           ; print it
        MOV  #12, R0            ; line feed
        JMP  PUTC               ; print it; PUTC returns for us`;

export const EXAMPLES: Example[] = [
  {
    name: 'Hello, world',
    expect: 'HELLO, WORLD!\r\n',
    source: `; Hello, world: print a text, one character at a time, on the console.
; Learn: MOVB (R1)+ walks through bytes, TSTB/BPL waits for the terminal.
; Try:   step through it (Step) and watch R1 and the PC move.

        .TITLE  HELLO           ; the program's name (for the listing)
START:  MOV  #MSG, R1           ; R1 points at the text
1$:     MOVB (R1)+, R0          ; next character; the Z flag is set at the 0 byte
        BEQ  2$                 ; end of text
        JSR  PC, PUTC           ; print the character in R0
        BR   1$                 ; and the next one
2$:     HALT                    ; stop the CPU

MSG:    .ASCIZ  /HELLO, WORLD!/<15><12> ; the text, CR, LF and a 0 byte
        .EVEN                   ; code must start at an even address
${PUTC}
        .END START
`,
  },
  {
    name: 'Squares (multiply in software)',
    expect: '1 4 9 16 25 36 49 64 81 100 121 144 \r\n',
    source: `; Squares: print 1*1 ... 12*12. There is no multiply instruction without the
; EIS option: MUL16 shifts and adds, the way programs did it before hardware multiply.
; Learn: subroutines (JSR PC / RTS PC), the stack, decimal output by repeated division.
; Try:   turn on EIS and replace the JSR PC, MUL16 with MUL R0, R0 (watch the cycles).

START:  MOV  #1, R4             ; R4 = n
1$:     MOV  R4, R0             ; R0 = n...
        MOV  R4, R1             ; ...R1 = n
        JSR  PC, MUL16          ; R0 = n * n
        JSR  PC, PRDEC          ; print it in decimal
        MOV  #' , R0            ; a space
        JSR  PC, PUTC           ; print it
        INC  R4                 ; the next n
        CMP  R4, #12.           ; up to twelve
        BLOS 1$                 ; unsigned <=
        JSR  PC, CRLF           ; end the line
        HALT                    ; stop the CPU
${MUL16}
${PRDEC}
${DIV16}
${CRLF}
${PUTC}
        .END START
`,
  },
  {
    name: 'Fibonacci (carry flag)',
    expect: '1 1 2 3 5 8 13 21 34 55 89 144 233 377 610 987 1597 2584 4181 6765 10946 17711 28657 46368 \r\n',
    source: `; Fibonacci numbers until they no longer fit in 16 bits.
; Learn: ADD sets C when the result needs a 17th bit; BCS reacts to it.
; Try:   change BCS to BVS: signed overflow happens earlier (at 32768).

START:  MOV  #1, R2             ; a
        MOV  #1, R3             ; b
1$:     MOV  R2, R0             ; print a...
        JSR  PC, PRDEC          ; ...in decimal
        MOV  #' , R0            ; a space
        JSR  PC, PUTC           ; print it
        MOV  R2, R4             ; R4 = a...
        ADD  R3, R4             ; a + b
        BCS  2$                 ; carry: the next one doesn't fit
        MOV  R3, R2             ; a = b
        MOV  R4, R3             ; b = a + b
        BR   1$                 ; and the next number
2$:     MOV  R3, R0             ; print the last one that fits
        JSR  PC, PRDEC          ; in decimal
        MOV  #' , R0            ; a space
        JSR  PC, PUTC           ; print it
        JSR  PC, CRLF           ; end the line
        HALT                    ; stop the CPU
${PRDEC}
${DIV16}
${CRLF}
${PUTC}
        .END START
`,
  },
  {
    name: 'Line clock (interrupts, WAIT)',
    expect: '**********\r\n',
    source: `; Line clock: the KW11-L interrupts every tick (here every 1000 cycles).
; The handler counts ticks; the main loop sleeps in WAIT and prints a star
; every 10 ticks.
; Learn: vectors (100 = clock), PSW priority, RTI, sleeping instead of busy-waiting.
; Try:   remove the WAIT: the program still works, but burns every cycle.

START:  MOV  #CLOCK, @#100       ; vector: handler address...
        MOV  #300, @#102         ; ...and the PSW for it (priority 6)
        CLR  R4                  ; ticks
        CLR  R5                  ; stars printed
        MOV  #100, @#LKS         ; clock interrupts on (bit 6 = IE)
1$:     WAIT                     ; sleep until an interrupt
        CMP  R4, #10.            ; ten ticks yet?
        BLO  1$                  ; no: sleep again
        CLR  R4                  ; count the next ten from 0
        MOV  #'*, R0             ; a star
        JSR  PC, PUTC            ; print it
        INC  R5                  ; one more star
        CMP  R5, #10.            ; ten stars yet?
        BLO  1$                  ; no: sleep again
        CLR  @#LKS               ; clock off
        JSR  PC, CRLF            ; end the line
        HALT                     ; stop the CPU

CLOCK:  INC  R4                  ; runs once per tick, between two instructions
        RTI                      ; back to where the interrupt came in
${CRLF}
${PUTC}
        .END START
`,
  },
  {
    name: 'Echo (keyboard interrupt)',
    input: 'Hello.',
    expect: 'HELLO.',
    source: `; Echo: type in the console box; each key interrupts the program, which
; prints it back in upper case. A full stop ends the program.
; Learn: the receiver interrupt (vector 60), reading RBUF clears DONE, and
;        "check, then wait": the handler may already have run before the first
;        WAIT, so the loop tests R5 before sleeping (or it could sleep forever).
; Try:   echo the keys in lower case instead.

START:  MOV  #KEY, @#60           ; vector 60: the key handler...
        MOV  #200, @#62          ; priority 4
        CLR  R5                  ; set by the handler at '.'
        MOV  #100, @#RCSR        ; receiver interrupts on
1$:     TST  R5                  ; done? check first...
        BNE  2$                  ; yes: stop
        WAIT                     ; ...then sleep until the next key
        BR   1$                  ; and check again
2$:     HALT                     ; stop the CPU

KEY:    MOV  R0, -(SP)           ; a handler must keep every register it uses
        MOVB @#RBUF, R0          ; the key that was typed
        CMPB R0, #'a             ; below 'a'?
        BLO  1$                  ; yes: not a small letter
        CMPB R0, #'z             ; above 'z'?
        BHI  1$                  ; yes: not a small letter
        SUB  #40, R0             ; 'a' - 'A' = 40 octal
1$:     JSR  PC, PUTC            ; print it
        CMPB R0, #'.             ; a full stop?
        BNE  2$                  ; no: keep going
        INC  R5                  ; yes: tell the main loop to stop
2$:     MOV  (SP)+, R0           ; restore R0
        RTI                      ; back to the main loop
${PUTC}
        .END START
`,
  },
  {
    name: 'TRAP as a system call',
    expect: 'OK',
    source: `; TRAP n: a "system call". The CPU jumps through vector 34; the handler finds
; n in the low byte of the TRAP instruction, just before the return address.
; Learn: traps push PC and PSW; @(SP) style addressing; BIC to mask bits.
; Try:   add TRAP 2 that prints R0 as a decimal number.

START:  MOV  #SYSCAL, @#34        ; vector 34: the TRAP handler...
        MOV  #340, @#36          ; run the handler at priority 7
        MOV  #'O, R0             ; the letter O
        TRAP 0                   ; print R0
        MOV  #'K, R0             ; the letter K
        TRAP 0                   ; print R0
        TRAP 1                   ; stop
        HALT                     ; (never reached: TRAP 1 halts)

SYSCAL: MOV  R1, -(SP)           ; save R1
        MOV  2(SP), R1           ; the return address (pushed by the trap)
        MOV  -2(R1), R1          ; the TRAP instruction itself
        BIC  #177400, R1         ; keep n (the low byte)
        BNE  1$                  ; not 0: TRAP 1
        JSR  PC, PUTC            ; TRAP 0: print R0
        MOV  (SP)+, R1           ; restore R1
        RTI                      ; back after the TRAP
1$:     HALT                     ; TRAP 1: halt
${PUTC}
        .END START
`,
  },
  {
    name: 'Addressing modes tour',
    expect: '',
    source: `; The eight addressing modes, one per line. Step through and watch the
; registers and the memory view (TAB is at the address the listing shows).
; Learn: # is a value, @# is an address; (R)+ is C's *p++.

START:  MOV  #TAB, R1           ; immediate: R1 = address of TAB
        MOV  R1, R2             ; mode 0, register:        R2 = R1
        MOV  (R1), R3           ; mode 1, deferred:        R3 = TAB[0] (address of ONE)
        MOV  (R1)+, R3          ; mode 2, autoincrement:   the same, then R1 += 2
        MOV  @(R1)+, R3         ; mode 3, autoinc deferred: R3 = *TAB[1] = 7, R1 += 2
        MOV  -(R1), R4          ; mode 4, autodecrement:   R1 -= 2, R4 = TAB[1]
        MOV  @-(R1), R4         ; mode 5, autodec deferred: R1 -= 2, R4 = *TAB[0] = 1
        MOV  4(R2), R5          ; mode 6, index:           R5 = TAB[2] = 3
        MOV  @2(R2), R5         ; mode 7, index deferred:  R5 = *TAB[1] = 7
        MOV  ONE, R0            ; relative (PC + offset):  R0 = 1
        MOV  @#SEVEN, R0        ; absolute:                R0 = 7
        HALT                    ; stop the CPU

TAB:    .WORD ONE, SEVEN, 3     ; two pointers and a number
ONE:    .WORD 1                 ; a word holding 1
SEVEN:  .WORD 7                 ; a word holding 7
        .END START
`,
  },
];

// -------------------------------------------------------------------- the display

export interface DisplayExample {
  name: string;
  source: string;
  /** The beam the example needs (default 'instant'). */
  beam?: Beam;
}

/** VSYNC, as in docs/BLUE11_DISPLAY.md §4. */
export const VSYNC = `
; VSYNC: wait for the next vertical blank.
VSYNC:  BIC  #200, @#DSPCS      ; forget a blank we may already have seen
1$:     TSTB @#DSPCS            ; DONE? (bit 7 is the sign of the low byte)
        BPL  1$                 ; not yet
        RTS  PC                 ; back to the caller`;

/** FLIP, as in docs/BLUE11_DISPLAY.md §5 (mode 0, pages 0 and 1). */
export const FLIP = `
; FLIP: show the page we just drew; R1 = the page to draw on next.
FLIP:   BIT  #1, @#DSPCS        ; showing page 1?
        BNE  1$                 ; yes
        BIS  #1, @#DSPCS        ; no: show page 1 from the next blank on
        MOV  #120000, R1        ; and draw on page 0
        BR   VSYNC              ; VSYNC returns to our caller
1$:     BIC  #1, @#DSPCS        ; yes: show page 0
        MOV  #130000, R1        ; and draw on page 1
        BR   VSYNC              ; VSYNC returns to our caller`;

/** PLOT1, as in docs/BLUE11_DISPLAY.md §3 (mode 1). */
export const PLOT1 = `
; PLOT1: set pixel (R2 = x, R3 = y) to colour R0 (0–17) in mode 1, on the page at R1.
PLOT1:  MOV  R3, R4             ; y
        SWAB R4                 ; y * 400 (y is less than 200, so it fits)
        ASR  R4                 ; y * 200
        ASR  R4                 ; y * 100: the row's offset
        ADD  R1, R4             ; + the page
        MOV  R2, R5             ; x
        ASR  R5                 ; x / 2: the byte in the row
        ADD  R5, R4             ; R4 = the byte's address
        BIT  #1, R2             ; odd x?
        BNE  1$                 ; yes
        BICB #17, (R4)          ; even x: replace the low half
        BISB R0, (R4)           ; with the colour
        RTS  PC                 ; back to the caller
1$:     BICB #360, (R4)         ; odd x: replace the high half
        MOV  R0, R5             ; the colour
        ASL  R5                 ; moved left...
        ASL  R5                 ;
        ASL  R5                 ;
        ASL  R5                 ; ...to bits 7–4
        BISB R5, (R4)           ; into the high half
        RTS  PC                 ; back to the caller`;

/** Sky colours, top band first (the 'Sky gradient' example). */
export const SKY = [0o001, 0o002, 0o003, 0o004, 0o005, 0o006, 0o007, 0o077];

export const DISPLAY_EXAMPLES: DisplayExample[] = [
  {
    name: 'Diagonal (mode 0)',
    source: `
; A white diagonal from the top left to the bottom right. One row down
; is +100 and one pixel right is +1, so the next pixel is always +101.
        MOV  #SCREEN, R1        ; pixel (0, 0)
        MOV  #100, R2           ; 64 pixels
1$:     MOVB #17, (R1)          ; colour 17: white
        ADD  #101, R1           ; one row down, one pixel right
        SOB  R2, 1$             ; the next pixel
        JSR  PC, VSYNC          ; wait for the blank: the picture is shown
        HALT                    ; stop the CPU
${VSYNC}
`,
  },
  {
    name: 'Filled rectangle (mode 0)',
    source: `
; A red rectangle, 20 by 20 pixels, with its top left corner at (10, 20).
; Each word is two pixels: 4 * 400 + 4 = 2004.
        MOV  #SCREEN+2010, R1   ; (10, 20): row 20, column 10
        MOV  #20, R3            ; 20 rows
1$:     MOV  #10, R2            ; 10 words = 20 pixels in each row
2$:     MOV  #2004, (R1)+       ; two red pixels
        SOB  R2, 2$             ; the rest of the row
        ADD  #100-20, R1        ; the next row, back to column 10
        SOB  R3, 1$             ; the next row
        JSR  PC, VSYNC          ; wait for the blank: the picture is shown
        HALT                    ; stop the CPU
${VSYNC}
`,
  },
  {
    name: 'Bouncing pixel (double buffering)',
    source: `
; A yellow pixel bounces off the edges. Each frame is drawn on the page
; that is not shown, then FLIP shows it: the picture never flickers.
        MOV  #130000, R1        ; draw on page 1 first (page 0 is shown)
        CLR  R2                 ; x = 0
        MOV  #5, R3             ; y = 5
LOOP:   MOV  R1, R4             ; clear the page we draw on
        MOV  #4000, R5          ; 4000 words
1$:     CLR  (R4)+              ; two pixels
        SOB  R5, 1$             ; the rest of the page
        ADD  DX, R2             ; move x
        TST  R2                 ; at the left edge?
        BEQ  2$                 ; yes: bounce
        CMP  R2, #77            ; at the right edge?
        BNE  3$                 ; no
2$:     NEG  DX                 ; bounce: go the other way
3$:     ADD  DY, R3             ; move y
        TST  R3                 ; at the top?
        BEQ  4$                 ; yes: bounce
        CMP  R3, #77            ; at the bottom?
        BNE  5$                 ; no
4$:     NEG  DY                 ; bounce
5$:     MOV  R3, R4             ; the pixel's address: y
        SWAB R4                 ; y * 400
        ASR  R4                 ; y * 200
        ASR  R4                 ; y * 100
        ADD  R2, R4             ; + x
        ADD  R1, R4             ; + the page
        MOVB #16, (R4)          ; colour 16: yellow
        JSR  PC, FLIP           ; show it; R1 = the next page to draw on
        DEC  COUNT              ; one frame less to go
        BNE  LOOP               ; the next frame
        HALT                    ; stop the CPU
DX:     .WORD 1                 ; the step in x: +1 or -1
DY:     .WORD 1                 ; the step in y
COUNT:  .WORD 50.               ; frames to draw
${FLIP}
${VSYNC}
`,
  },
  {
    name: 'Circle (mode 1, PLOT1)',
    source: `
; A white circle of radius 50. (decimal) around (100, 100), with the
; midpoint algorithm: only additions, and one PLOT1 for each of the 8 octants.
        BIS  #4, @#DSPCS        ; mode 1 (128 x 128) from the next blank on
        MOV  #SCREEN, R1        ; draw on page 0
        MOV  #17, R0            ; colour 17: white
        MOV  #50., XX           ; x = the radius
        CLR  YY                 ; y = 0
        MOV  #-49., DD          ; d = 1 - the radius
LOOP:   CMP  XX, YY             ; x >= y?
        BLT  DONE               ; no: the circle is complete
        JSR  PC, PLOT8          ; plot the 8 mirror images of (x, y)
        INC  YY                 ; y = y + 1
        TST  DD                 ; d < 0?
        BGE  1$                 ; no: x moves in too
        ADD  YY, DD             ; d = d + 2y + 1
        ADD  YY, DD             ;
        INC  DD                 ;
        BR   LOOP               ; the next point
1$:     DEC  XX                 ; x = x - 1
        MOV  YY, R4             ; d = d + 2(y - x) + 1
        SUB  XX, R4             ;
        ASL  R4                 ;
        INC  R4                 ;
        ADD  R4, DD             ;
        BR   LOOP               ; the next point
DONE:   JSR  PC, VSYNC          ; wait for the blank: the picture is shown
        HALT                    ; stop the CPU
XX:     .WORD 0                 ; x
YY:     .WORD 0                 ; y
DD:     .WORD 0                 ; the midpoint test

; PLOT8: plot (100 +- x, 100 +- y) and (100 +- y, 100 +- x).
PLOT8:  MOV  XX, R2             ; a = x
        MOV  YY, R3             ; b = y
        JSR  PC, QUAD           ; the four points (100 +- a, 100 +- b)
        MOV  YY, R2             ; a = y
        MOV  XX, R3             ; b = x
        JSR  PC, QUAD           ; and the other four
        RTS  PC                 ; back to the caller

; QUAD: plot (100 + a, 100 + b) and its mirror images; a in R2, b in R3.
QUAD:   ADD  #100, R2           ; x = 100 + a
        ADD  #100, R3           ; y = 100 + b
        JSR  PC, PLOT1          ; (100 + a, 100 + b)
        NEG  R2                 ; mirror x: 200 - x
        ADD  #200, R2           ; x = 100 - a
        JSR  PC, PLOT1          ; (100 - a, 100 + b)
        NEG  R3                 ; mirror y
        ADD  #200, R3           ; y = 100 - b
        JSR  PC, PLOT1          ; (100 - a, 100 - b)
        NEG  R2                 ; mirror x again
        ADD  #200, R2           ; x = 100 + a
        JSR  PC, PLOT1          ; (100 + a, 100 - b)
        RTS  PC                 ; back to the caller
${PLOT1}
${VSYNC}
`,
  },
  {
    name: 'Palette cycling',
    source: `
; Sixteen stripes, one in each colour. The pixels never change: the
; program rotates palette entries 1-17 once a frame, so the stripes move.
        MOV  #SCREEN, R1        ; the top left pixel
        MOV  #100, R3           ; 100 rows
1$:     CLR  R0                 ; colour 0 at the left
        MOV  #20, R2            ; 20 stripes
2$:     MOVB R0, (R1)+          ; 4 pixels of this colour
        MOVB R0, (R1)+          ;
        MOVB R0, (R1)+          ;
        MOVB R0, (R1)+          ;
        INC  R0                 ; the next colour
        SOB  R2, 2$             ; the next stripe
        SOB  R3, 1$             ; the next row
        MOV  #20., R3           ; 20. frames
CYCLE:  MOV  @#DSPPAL+2, R0     ; keep entry 1
        MOV  #DSPPAL+2, R1      ; from entry 1...
        MOV  #16, R2            ; ...16 entries move down by one
3$:     MOV  2(R1), (R1)+       ; entry n = entry n+1
        SOB  R2, 3$             ; the next entry
        MOV  R0, (R1)           ; entry 17 = the old entry 1
        JSR  PC, VSYNC          ; show it
        SOB  R3, CYCLE          ; the next frame
        HALT                    ; stop the CPU
${VSYNC}
`,
  },
  {
    name: 'Sky gradient (racing the beam)',
    beam: 'scan',
    source: `
; Needs the real beam. The whole screen is colour 1, yet it shows 10
; bands: the program changes palette entry 1 as the beam goes down.
        MOV  #SCREEN, R1        ; fill the page with colour 1
        MOV  #4000, R2          ; 4000 words
1$:     MOV  #401, (R1)+        ; two pixels of colour 1
        SOB  R2, 1$             ; the rest of the page
        MOV  #3, R3             ; 3 frames
FRAME:  JSR  PC, VSYNC          ; the blank: the beam will start at row 0
        MOV  #SKY, R1           ; the band colours
        CLR  R2                 ; the band's first row
2$:     CMP  @#DSPLIN, R2       ; the beam on that row yet?
        BNE  2$                 ; not yet
        MOV  (R1)+, @#DSPPAL+2  ; colour 1 = this band's colour
        ADD  #10, R2            ; the next band starts 10 rows further down
        CMP  R2, #100           ; was that the last band?
        BLO  2$                 ; no: wait for the next
        SOB  R3, FRAME          ; the next frame
        JSR  PC, VSYNC          ; let the last frame be shown
        HALT                    ; stop the CPU
SKY:    .WORD ${SKY.map((c) => c.toString(8).padStart(3, '0')).join(', ')} ; dark blue to light
${VSYNC}
`,
  },
];
