import { describe, expect, it } from 'vitest';
import { REAL_TIME, SPEEDS, speedLabel, speedText, speedWhy } from '../src/speed';

describe('the speed setting', () => {
  it('reads as a share of real time', () => {
    expect(SPEEDS.map(speedLabel)).toEqual([
      '1/60 of real time', '1/30 of real time', '1/12 of real time', '1/6 of real time', '1/3 of real time',
      '1/2 of real time', 'real time', '2× real time', '4× real time', '10× real time',
    ]);
    expect(SPEEDS).toContain(REAL_TIME);
  });

  it('says why the sound is silent away from real time', () => {
    expect(speedText(60, true)).toBe('real time');
    expect(speedText(30, true)).toBe('1/2 of real time (silent)');
    expect(speedText(30, false)).toBe('1/2 of real time');
    expect(speedWhy(30, true)).toMatch(/only at real time/);
    expect(speedWhy(60, true)).toBe('');
  });
});
