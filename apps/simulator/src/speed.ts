/**
 * The speed setting, without the DOM (so it is tested): how fast the machine's time goes
 * against the wall clock, as a multiple of real time (the CPU clock's own rate, CPU_HZ).
 */

import { CPU_HZ } from './time';

/** Real time: the CPU runs CPU_HZ cycles per second of wall time. */
export const REAL_TIME = 1;

/** The speed slider's stops, as multiples of real time. */
export const SPEEDS = [1 / 60, 1 / 30, 1 / 12, 1 / 6, 1 / 3, 1 / 2, 1, 2, 4, 10];

/** The machine's cycles per second of wall time at a speed. */
export function cyclesPerSecondAt(speed: number): number {
  return CPU_HZ * speed;
}

/** "1/60", "2", "1.5": a speed as a fraction below 1 where it is one. */
function multiple(speed: number): string {
  if (speed >= 1) return String(+speed.toFixed(2));
  const n = Math.round(1 / speed);
  return Math.abs(n * speed - 1) < 1e-9 ? `1/${n}` : String(+speed.toFixed(2));
}

/** A speed as people read it: "1/60 of real time", "real time", "10× real time". */
export function speedLabel(speed: number): string {
  if (speed === REAL_TIME) return 'real time';
  return speed < 1 ? `${multiple(speed)} of real time` : `${multiple(speed)}× real time`;
}

/** A speed in short, for the badge on the settings button: "1/60×", "10×". */
export function speedShort(speed: number): string {
  return `${multiple(speed)}×`;
}
