# Blue-11 sound: a one-bit speaker

Status: **built** (`Sound`, `blue11` 0.8.0, 2026-11-18), with every recommendation of §10
accepted by the owner. The library records the speaker's edges; the simulator plays them, draws
them in its Sound tab and rings the console's bell ([ROADMAP.md](ROADMAP.md) step 10). It is a
teaching device, like the display
([`BLUE11_DISPLAY.md`](BLUE11_DISPLAY.md)) and the keyboard ([`BLUE11_KEYBOARD.md`](BLUE11_KEYBOARD.md)).

## 1. Goals

A speaker that is **one bit**: it is either pushed out or pulled in. The program makes a sound
by switching the bit, and the pitch comes from how many cycles pass between two switches. This
is how the beeper of the early home computers worked.

- **The cycle counts of [`BLUE11_MACHINE.md`](BLUE11_MACHINE.md) §4 become audible.** A delay
  loop that is 10 cycles too long plays a note that is flat. Keeping the counter in memory
  instead of a register, a lesson that is otherwise only a number, becomes something the
  student hears.
- **The CPU's time is shared.** While the program switches the speaker by hand it cannot draw,
  and drawing in the middle of a note changes the note. The student finds the problem
  themselves, then meets the answer: hardware that does the counting (the *tone generator*, §5).
- **Ideas it teaches:** frequency and period, counting cycles, delay loops, `XOR` to switch a
  bit, a lookup table of notes, sequencing with a clock interrupt, and the difference between
  doing a job in software and handing it to a device.
- **Small:** two registers, no interrupt, one help page.
- **It follows the library's rules** (`packages/blue11/AGENTS.md`): deterministic, integers only,
  no DOM and no audio in the library. The device records *when* the speaker moved, in cycles;
  playing that is the host's job (§7). Its state survives JSON.

**Not goals:** more than one voice, volume, noise or envelopes (a sound chip is a different,
larger device), sampled sound, and recording from a microphone. One bit is enough for every
lesson above, and the tricks that get more out of one bit (§8) are good advanced exercises.

## 2. It departs from the original machine

The PDP-11 had no speaker; a terminal could only ring its bell. This is a **teaching device** in
DEC's register style: its addresses and behaviour are ours. It is listed in the library README's
"Where it departs from the real machine". The tone generator borrows the idea of the PC
speaker, which was driven either by a bit or by a timer chip.

## 3. Time and pitch

- The device counts **CPU cycles**, as every device does. It knows nothing of seconds.
- **The host decides how fast cycles pass.** The simulator runs 1 200 000 cycles a second (60
  frames of 20000 cycles, [`BLUE11_DISPLAY.md`](BLUE11_DISPLAY.md) §5), so:

  > frequency = 1 200 000 / (2 × the cycles between two switches)

- Some notes, with the number of cycles between two switches (the *half period*):

  | Note | Hz | Half period (decimal) | Octal |
  | :--- | :--- | :--- | :--- |
  | A3 | 220.0 | 2727 | `5247` |
  | C4 (middle C) | 261.6 | 2293 | `4365` |
  | A4 | 440.0 | 1364 | `2524` |
  | C5 | 523.3 | 1147 | `2173` |

  The half period, not the whole period, is the number a student counts in a loop: the cycles
  from one switch to the next. The tone generator (§5) takes the same number.

## 4. Registers

The registers start at `176740`, which is free in the simulator and in HackCode.

| Address | Name | Access | |
| :--- | :--- | :--- | :--- |
| `176740` | `SNDCS` | read / write | the speaker bit |
| `176742` | `SNDDIV` | read / write | the tone generator's half period, 0: off |
| `176744`–`176777` | | | hole: bus error (trap 4) |

**`SNDCS`**

| Bit | Name | |
| :--- | :--- | :--- |
| 0 | `OUT` | the speaker: 1 out, 0 in. Followed while `SNDDIV` is 0 |
| others | | read as 0, writes ignored |

- **Only bit 0 is kept**, so every way of changing it works: `XOR R1, @#SNDCS` with R1 = 1
  switches it, `INC` and `COM` switch it too, and `BIS #1` / `BIC #1` set a level.
- The speaker moves **at the cycle of the bus write** (§6). Writing the level it already has
  changes nothing.
- A byte write to the low byte sets `OUT`; a byte write to the high byte is ignored.

**The beeper.** An A, played by counting cycles. Each pass of the loop is 1358 + 6 cycles:

```
; A at 440 Hz with the beeper: switch the speaker every 1364 cycles.
        MOV  #SNDCS, R2             ; the register, in a register: cheaper to reach
        MOV  #1, R1                 ; the bit to switch
TONE:   XOR  R1, (R2)               ; 3 cycles: fetch, read, write (the speaker moves here)
        MOV  #1358., R0             ; 2 cycles
1$:     SOB  R0, 1$                 ; 1 cycle, 1358 times
        BR   TONE                   ; 1 cycle
```

Writing `XOR R1, @#SNDCS` instead costs one more cycle (the address word), so the loop needs
1357 to stay in tune. Counting this is the exercise.

## 5. The tone generator

`SNDDIV` holds a half period in cycles, 1 to `177777` (65535, about 9 Hz). While it is not 0,
**the generator drives the speaker** and `OUT` is ignored: the speaker switches by itself every
`SNDDIV` cycles, and the CPU is free.

- **Starting:** writing a value other than 0 while the generator is off starts it at that cycle,
  with the speaker out.
- **Changing the note:** writing a new value while it runs takes effect **at the next switch**,
  so the note changes without a click (the PC's timer chip does the same in its square-wave
  mode). The old half period finishes first.
- **Stopping:** writing 0 stops it at that cycle, and the speaker goes back to `OUT`.
- Reading returns the last value written. A byte write changes that byte of it, and the result
  takes effect as a whole word would.
- There is no interrupt and no "done" flag: the generator never finishes. A program that plays a
  tune changes `SNDDIV` from a clock, such as the line clock or the display's vertical blank.

```
; Tone mode: an A for one second (60 line-clock ticks), while the CPU is free.
        MOV  #1364., @#SNDDIV       ; the generator switches every 1364 cycles
        MOV  #60., R0
1$:     CLR  @#LKS                  ; clear DONE (IE stays off)
2$:     TSTB @#LKS                  ; wait for the next tick
        BPL  2$
        SOB  R0, 1$
        CLR  @#SNDDIV               ; silence
        HALT
```

The waiting loop could draw instead: the note stays in tune whatever the CPU does.

## 6. What the device records

The device records the speaker's moves as **edges**: `{ cycle, level }`, where `cycle` counts
from power-up, as `DeviceMachine.cycles` does, and `level` is 0 or 1. Edges from the beeper and
from the generator are the same kind of edge. This list *is* the sound: the host plays it (§7)
and tests compare it.

- **An edge has the cycle of the bus write that made it**, not the cycle at the end of the
  instruction or of the run slice. Otherwise the beeper's pitch would depend on how the host
  slices a run. For `XOR R1, (R2)` this is its third cycle, the write. With `cycles: 'flat'` it
  is the cycle at which the instruction starts.
- **The library's addition for this:** devices otherwise learn about time only at the end of
  a run slice (`advance`). `DeviceMachine.now` is the cycle of the bus access in progress: its
  `cycles` plus `cpu.elapsed`, the cycles the CPU has spent so far in the current `run` or
  `step` up to that access's first cycle. `add` hands devices a clock that returns it, as the
  second argument of `attach`. It is a general addition (rule 5), and the scanning beam could
  use it later. It changes no existing behaviour.
- The generator's edges are computed, not stepped: the device needs no `nextEvent()`, because
  nothing a program can see changes by itself. It never stops the CPU and never slows a run.
- **The buffer is bounded.** The device keeps the edges since the host last took them, at most
  `maxEdges` (default 65536: more than six frames of the fastest switching a program can do, `MOV` of two registers in turn, 2 cycles each).
  Past that, the oldest are dropped, and the waiting stretch of time then starts at the oldest
  edge kept. A host that never takes them, such as HackCode, keeps only the last ones; a
  generator left running for hours skips ahead instead of computing every switch.

## 7. Host side

```ts
const snd = new Sound({ base: 0o176740, maxEdges: 65536 });
m.add(snd);

snd.take();        // { from, to, level, edges, dropped }: the speaker from cycle `from` (at
                   // `level`) to `to` (= m.cycles), with every edge in between, and how many
                   // were dropped; the buffer is emptied
snd.level;         // the speaker now: 0 or 1
```

- `take()` covers a stretch of time with no gaps: each call starts where the last one ended
  (unless edges were dropped). A host calls it after each frame.
- The generator's edges up to `to` are included, computed from `SNDDIV` and the cycle it was
  last written.
- `state()` and `load(state)` save and restore `OUT`, `SNDDIV`, the generator's phase and the
  buffer as plain data (library rule 3).
- **The `SimpleMachine` option** `sound: true` (or `SoundOptions`) adds it at `176740`.

### 7.1 Playing it in the simulator

The library gives edges; the simulator makes them into sound with the Web Audio API.

- **From edges to samples:** at 48 000 samples a second, one sample is 25 cycles, so a frame of
  20000 cycles is exactly 800 samples. Each sample is the share of its 25 cycles the speaker was
  out (this is a box filter, which also smooths out switching faster than the ear can hear).
  At other sample rates a sample is a fraction of cycles, and the same rule applies. A gentle
  high-pass filter removes the constant part, so a speaker left out is silence, not a click
  that never ends. This is a pure function in the simulator's core (`src/sim.ts`), with tests.
- **Only at real time.** Sound plays only while the program runs at 60 frames a second. At any
  other speed, while paused, while stepping, and after the program has ended, the speaker is
  silent: a tune played at the wrong speed would teach the wrong pitch. The page says
  "sound: real time only" next to the speed when it mutes for this reason.
- **Scheduling:** each frame's 800 samples are queued just after the last ones, about 3 frames
  (50 ms) ahead of the audio clock. If the page falls behind (a hidden tab, a slow machine), the
  queue starts again from now rather than playing late.
- **The browser needs a click first.** Run is a click, so the audio starts there.
- **Volume and mute:** a square wave at full volume is harsh. The volume starts at 25 %, with a
  mute switch, both kept in the browser like the Retro setting.
- **Replays sound the same.** The input log replays the run cycle for cycle (keyboard spec
  §7.1), so the edges, and the sound, are the same too.

## 8. Lessons and exercises

1. **Tune the beeper.** Play an A, then move the loop counter from R0 to memory and hear the
   note go flat. Count the cycles to put it back in tune.
2. **A scale from a table** of half periods, with the beeper, each note for a number of passes.
   Why do the high notes last a shorter time with the same number of passes?
3. **Play and draw.** Draw a picture while a beeper note plays: the note breaks up. Then play the
   same note with the tone generator and draw at full speed.
4. **A tune from the line clock:** a table of (note, ticks), with `SNDDIV` changed in the clock's
   interrupt handler, while the main program does something else.
5. **Advanced: chords from one bit.** Switch between two or three notes many times a second (an
   arpeggio), the trick of one-voice computers.
6. **Advanced: loudness from one bit.** Switch the speaker much faster than the ear hears, and
   the share of time it is out works as a level (pulse-width modulation). The box filter of §7.1
   turns that into a quieter sound or even a crude voice.

## 9. Memory map and names (in the simulator)

| Addresses | What |
| :--- | :--- |
| `176700`–`176737` | the keyboard's registers and their hole ([`BLUE11_KEYBOARD.md`](BLUE11_KEYBOARD.md) §5) |
| `176740`–`176743` | `SNDCS`, `SNDDIV` |
| `176744`–`176777` | hole: bus error |

The rest of the map is in [`BLUE11_DISPLAY.md`](BLUE11_DISPLAY.md) §6 and
[`BLUE11_KEYBOARD.md`](BLUE11_KEYBOARD.md) §8. The simulator's predefined names are `SNDCS` and
`SNDDIV`. No vector is used.

**Reset**

| | Power-up (`boot`) | `RESET` instruction |
| :--- | :--- | :--- |
| `OUT` | 0 | 0 |
| `SNDDIV` | 0: the generator off | 0: the generator off |
| Edges | none; the cycle count starts again at 0 | kept; an edge is added if the speaker moves |

`RESET` silences the speaker, so a program that resets the machine does not leave a tone
playing. A `HALT` changes nothing in the device, but time stops with the CPU, so the host
hears silence.

## 10. Decisions

The owner accepted every recommendation on 2026-11-18:

1. **Add the device at all?** Recommended: yes, as above. It is small, it needs one general
   addition to the library (`now`, §6), and it makes cycle counting audible.
2. **The tone generator, or only the beeper?** Recommended: both. The beeper alone teaches
   counting; without the generator, every program with sound has no time for anything else, and
   the lesson "hand the job to hardware" is lost.
3. **`SNDDIV` is a half period** (the cycles between two switches), not a whole period.
   Recommended: half, so it is the same number the student counts in a beeper loop.
4. **A new `SNDDIV` takes effect at the next switch,** not at once. Recommended: at the next
   switch, so melodies change notes without clicks. "At once" is simpler to explain but clicks.
5. **The generator overrides `OUT`,** rather than mixing with it (for example `OUT` XOR the
   generator). Recommended: override. Mixing allows tricks, but it is hard to explain.
6. **No interrupt in v1.** Recommended: none. The line clock and the vertical blank already
   give a beat for tunes. Bit 6 of `SNDCS` stays free for an `IE` later.
7. **`RESET` silences** (§9). Recommended: yes.
8. **The console's bell.** Should the simulator beep when a program prints character 7 (BEL)
   to the DL11, as a terminal would? Recommended: yes, a short tone played by the page, not by
   the sound device, so it is not part of the edges.
9. **A waveform view** in the simulator: a tab that draws the last frame's edges against a ruler
   in cycles, so a student can measure a half period by eye, and see it without hearing it.
   Recommended: yes, after the sound itself. It also helps students who cannot use audio.
10. **Address `176740`.** Recommended: yes; it is in the keyboard's hole, after its registers.

## 11. Tests (written first)

`packages/blue11/test/sound.test.ts`:

- **The bit.** Only bit 0 of `SNDCS` is kept; `XOR`, `INC`, `COM`, `BIS` and `BIC` each switch or
  set it; a byte write to the high byte is ignored. Writing the same level adds no edge. The
  hole is a bus error.
- **The cycle of an edge.** The beeper loop of §4 gives edges exactly 1364 cycles apart, and the
  same edges whether the machine runs it in one `run`, in frames, or by `step`. With `XOR R1,
  @#SNDCS` they are 1365 apart. With `cycles: 'flat'`, edges are at instruction starts.
- **The generator.** Started, it switches every `SNDDIV` cycles, starting out. A new value takes
  effect at the next switch. 0 stops it and the speaker returns to `OUT`, which it ignored
  while running. It never stops the CPU (`nextEvent()` is Infinity) and costs no cycles. A byte
  write changes one byte.
- **`take()`.** Consecutive calls cover time with no gaps or overlaps; `level` is the speaker's
  level at `from`; generator edges up to `to` are included. Past `maxEdges` the oldest are
  dropped.
- **Reset.** Power-up and `RESET` behave as in §9.
- **Replay and state.** `state()` → `JSON.stringify` → `load()` gives the same edges afterwards.
- **Example programs** (`packages/blue11/examples/examples.ts`), checked by their edges: the
  beeper A; a scale from a table; a tune from the line clock with the generator; play and draw
  (the beeper's edges come unevenly, the generator's evenly).
- **README.** `readme-examples.test.ts` runs the code blocks of the README's sound section.

In the simulator (`apps/simulator`): the edges-to-samples function (a frame of 20000 cycles is
800 samples at 48 kHz; a speaker out for half of a sample gives half a level; a level that never
changes gives silence after the filter), and muting at any speed but 60.
