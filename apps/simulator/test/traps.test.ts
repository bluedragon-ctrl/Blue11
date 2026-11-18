/** The status line for a trap with no handler. */
import { describe, expect, it } from 'vitest';
import { Cpu, VEC } from 'blue11';
import { describeTrap } from '../src/traps';

describe('describeTrap', () => {
  it('names a HALT outside kernel mode', () => {
    const cpu = new Cpu({ read: () => 0, write: () => true }, { protectModes: true });
    const text = describeTrap({ vector: VEC.BUS_ERROR, cause: 'privileged', pc: 0o1004 }, cpu, () => 0);
    expect(text).toBe('HALT at 001004 in user mode, with no handler at 004: only the kernel may stop the machine.');
  });
});
