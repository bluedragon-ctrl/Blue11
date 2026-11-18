/** What the status line says when the CPU stops on a trap with no handler. No DOM. */

import { decodeOp, octal, type Cpu, type TrapInfo } from 'blue11';
import { inRom } from './debug';

export function describeTrap(t: TrapInfo, cpu: Cpu, read: (a: number) => number): string {
  const at = `at ${octal(t.pc)}`;
  const a = t.detail ?? 0;
  switch (t.cause) {
    case 'odd-address':
      return `Odd address ${octal(a)} ${at}: a word needs an even address (a missing .EVEN?).`;
    case 'bus-error':
      if (inRom(a)) return `Bus error ${at}: the ROM at ${octal(a)} is read-only.`;
      return `Bus error ${at}: nothing answers at ${octal(a)}.`;
    case 'stack-limit':
      return `Stack overflow ${at}: SP went below ${octal(a)}.`;
    case 'illegal': {
      const w = read(t.pc);
      const op = w < 0 ? null : decodeOp(w);
      if (op?.eis && !cpu.eis) return `${op.name} ${at} needs the EIS option, which this machine does not have.`;
      return `Illegal instruction ${w < 0 ? '' : octal(w) + ' '}${at}: is the CPU running into data?`;
    }
    case 'bpt':
      return `BPT ${at}, with no handler at 014. Continue goes on after it.`;
    case 'trace':
      return `Trace trap ${at}, with no handler at 014.`;
    case 'interrupt':
      return `Interrupt through vector ${octal(t.vector, 3)} with no handler ${at}: set the vector before IE.`;
    default:
      return `${t.cause.toUpperCase()}${t.detail !== undefined ? ' ' + octal(t.detail, 3) : ''} ${at}, with no handler at ${octal(t.vector, 3)}.`;
  }
}
