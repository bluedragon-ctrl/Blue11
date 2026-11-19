import { describe, expect, it } from 'vitest';
import { REAL_TIME, SPEEDS, speedLabel } from '../src/speed';

describe('the speed setting', () => {
  it('reads as a share of real time', () => {
    expect(SPEEDS.map(speedLabel)).toEqual([
      '1/60 of real time', '1/30 of real time', '1/12 of real time', '1/6 of real time', '1/3 of real time',
      '1/2 of real time', 'real time', '2× real time', '4× real time', '10× real time',
    ]);
    expect(SPEEDS).toContain(REAL_TIME);
  });
});
