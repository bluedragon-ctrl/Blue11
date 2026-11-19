/**
 * The speed setting, without the DOM (so it is tested). The machine runs in frames of 20000
 * cycles, one tick of the 60 Hz line clock each; the speed is how many of them run per second
 * of wall time, shown to people as a share of real time.
 */

/** Frames (ticks) per second of wall time at real time. */
export const REAL_TIME = 60;

/** The speed slider's stops, in frames (ticks) per second of wall time. */
export const SPEEDS = [1, 2, 5, 10, 20, 30, 60, 120, 240, 600];

/** A speed as people read it: "1/60 of real time", "real time", "10× real time". */
export function speedLabel(fps: number): string {
  if (fps === REAL_TIME) return 'real time';
  if (fps > REAL_TIME) return `${+(fps / REAL_TIME).toFixed(2)}× real time`;
  const n = REAL_TIME / fps;
  return Number.isInteger(n) ? `1/${n} of real time` : `${+(fps / REAL_TIME).toFixed(2)}× real time`;
}

/** A speed in short, for the badge on the settings button: "1/60×", "10×". */
export function speedShort(fps: number): string {
  if (fps >= REAL_TIME) return `${+(fps / REAL_TIME).toFixed(2)}×`;
  const n = REAL_TIME / fps;
  return Number.isInteger(n) ? `1/${n}×` : `${+(fps / REAL_TIME).toFixed(2)}×`;
}
