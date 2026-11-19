import { describe, expect, it } from 'vitest';
import { NATIVE, SPEEDS, speedLabel, speedShort } from '../src/speed';
import { CPU_HZ, FRAME_CYCLES } from '../src/time';

describe('the speed setting', () => {
  it('reads as machine cycles per second', () => {
    expect(SPEEDS.map(speedLabel)).toEqual([
      '20 k cycles/s', '40 k cycles/s', '100 k cycles/s', '200 k cycles/s', '400 k cycles/s', '600 k cycles/s',
      '1.2 M cycles/s (native speed)', '2.4 M cycles/s', '4.8 M cycles/s', '12 M cycles/s',
    ]);
  });

  it('has the machine\'s own speed, and every stop is whole screen frames a second', () => {
    expect(SPEEDS).toContain(NATIVE);
    expect(NATIVE).toBe(CPU_HZ);
    for (const s of SPEEDS) expect(Number.isInteger(s / FRAME_CYCLES)).toBe(true);
  });

  it('in short, for the badge on the settings button', () => {
    expect(speedShort(600_000)).toBe('600 k/s');
    expect(speedShort(12_000_000)).toBe('12 M/s');
  });
});
