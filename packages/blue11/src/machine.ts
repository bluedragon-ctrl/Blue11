/**
 * A minimal system around the CPU: RAM, a DL11 console terminal and a KW11-L line
 * clock, at their real DEC addresses and vectors, and optionally the Blue-11 display and keyboard. Used by the tests and the example
 * programs (`examples/examples.ts`); a project with its own peripherals builds on {@link DeviceMachine}
 * (`devices.ts`) the same way.
 *
 * Time is cycles: the line clock ticks every `clockCycles` CPU cycles, so a run is
 * deterministic (no wall-clock time).
 */

import { CSR, DEV, DeviceMachine, DL11, KW11L, type DeviceMachineOptions } from './devices.js';
import { Display, type DisplayOptions } from './display.js';
import { Keyboard, type KeyboardOptions } from './keyboard.js';

export { CSR, DEV };

export interface MachineOptions extends DeviceMachineOptions {
  /** CPU cycles per line-clock tick (default 1000, or the display's `frameCycles`). */
  clockCycles?: number;
  /**
   * Add a {@link Display} (`true`: the defaults). RAM then ends where its pixel window
   * starts (default 120000), and the line clock ticks once per frame, unless you say otherwise.
   */
  display?: boolean | DisplayOptions;
  /** Add a {@link Keyboard} (`true`: the defaults, 176700 and the key map at 177000). */
  keyboard?: boolean | KeyboardOptions;
}

export class SimpleMachine extends DeviceMachine {
  readonly clockCycles: number;
  readonly console: DL11;
  readonly clock: KW11L;
  /** The display, if the `display` option asked for one. */
  readonly display: Display | null;
  /** The keyboard, if the `keyboard` option asked for one. */
  readonly keyboard: Keyboard | null;

  constructor(opts: MachineOptions = {}) {
    const display = opts.display ? new Display(opts.display === true ? {} : opts.display) : null;
    super({ ...opts, memory: opts.memory ?? display?.memoryBase });
    this.display = display;
    this.clockCycles = opts.clockCycles ?? display?.frameCycles ?? 1000;
    this.console = new DL11();
    this.clock = new KW11L(this.clockCycles);
    this.add(this.console).add(this.clock);
    if (display) this.add(display.memory).add(display.control);
    this.keyboard = opts.keyboard ? new Keyboard(opts.keyboard === true ? {} : opts.keyboard) : null;
    if (this.keyboard) this.add(this.keyboard.registers).add(this.keyboard.map);
  }

  /** Everything written to the console (XBUF). */
  get output(): string { return this.console.output; }
  /** Characters typed but not yet read by the program. */
  get input(): number[] { return this.console.input; }
  /** Called with each character the program prints. */
  get onOutput(): ((ch: string) => void) | null { return this.console.onOutput; }
  set onOutput(f: ((ch: string) => void) | null) { this.console.onOutput = f; }

  /** Type a character on the console keyboard. */
  type(ch: string | number): void { this.console.type(ch); }
}
