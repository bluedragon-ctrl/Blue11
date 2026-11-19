/**
 * The simulated computer's three rates, all in CPU cycles. They are separate things that start
 * out in step: the CPU clock is what "real time" means; the screen refresh and the line clock
 * are devices that count its cycles.
 */

/** The CPU clock: cycles per second of machine time. At real time, the page runs this many a second. */
export const CPU_HZ = 1_200_000;

/** Screen refresh: cycles per display frame, from one vertical blank to the next (60 Hz). */
export const FRAME_CYCLES = 20_000;

/**
 * The line clock (KW11-L): cycles per tick (60 Hz, as from mains power). A device of its own,
 * for timing; it has the screen's rate today, but nothing ties the two together.
 */
export const TICK_CYCLES = 20_000;
