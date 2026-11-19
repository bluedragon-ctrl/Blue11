/**
 * The speed setting, without the DOM (so it is tested): how many of the machine's CPU cycles
 * run per second of wall time. At CPU_HZ the machine runs at its native speed: the screen
 * refreshes and the line clock ticks 60 times a second, and a note has its true pitch.
 */

import { CPU_HZ } from './time';

/** The machine's native speed, in cycles per second of wall time. */
export const NATIVE = CPU_HZ;

/** The speed slider's stops, in cycles per second of wall time. */
export const SPEEDS = [20_000, 40_000, 100_000, 200_000, 400_000, 600_000, 1_200_000, 2_400_000, 4_800_000, 12_000_000];

/** Cycles per second in short: "20 k", "1.2 M", "12 M". */
function short(cps: number): string {
  if (cps >= 1_000_000) return `${+(cps / 1_000_000).toFixed(2)} M`;
  if (cps >= 1_000) return `${+(cps / 1_000).toFixed(2)} k`;
  return String(cps);
}

/** A speed as people read it: "600 k cycles/s", "1.2 M cycles/s (native speed)". */
export function speedLabel(cps: number): string {
  return `${short(cps)} cycles/s${cps === NATIVE ? ' (native speed)' : ''}`;
}

/** A speed in short, for the badge on the settings button: "600 k/s". */
export function speedShort(cps: number): string {
  return `${short(cps)}/s`;
}
