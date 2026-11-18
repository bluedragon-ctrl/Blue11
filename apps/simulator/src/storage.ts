/**
 * Programs kept in the browser (localStorage) and programs shared by URL. No DOM: the
 * storage is passed in, so this is tested.
 */

import type { Beam } from 'blue11';

/** The part of `Storage` used here. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const CURRENT = 'blue11.sim.current';
const SAVED = 'blue11.sim.programs';
const RETRO = 'blue11.sim.retro';

export class Library {
  constructor(private readonly store: KeyValue | null) {}

  /** The program in the editor when the page was last left, or null. */
  get current(): string | null { return this.read(CURRENT); }
  set current(source: string | null) { source === null ? this.remove(CURRENT) : this.write(CURRENT, source); }

  /** Saved programs by name. */
  get saved(): Record<string, string> {
    try {
      const v = JSON.parse(this.read(SAVED) ?? '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
  }

  /** The period look (CRT screen, printed listings, amber console): on unless turned off. */
  get retro(): boolean { return this.read(RETRO) !== 'off'; }
  set retro(on: boolean) { this.write(RETRO, on ? 'on' : 'off'); }

  save(name: string, source: string): void { this.write(SAVED, JSON.stringify({ ...this.saved, [name]: source })); }

  delete(name: string): void {
    const all = this.saved;
    delete all[name];
    this.write(SAVED, JSON.stringify(all));
  }

  private read(k: string): string | null { try { return this.store?.getItem(k) ?? null; } catch { return null; } }
  private write(k: string, v: string): void { try { this.store?.setItem(k, v); } catch { /* full or off */ } }
  private remove(k: string): void { try { this.store?.removeItem(k); } catch { /* off */ } }
}

/** A program and its options, as a share link carries them (not the input: keyboard spec §7.1). */
export interface Shared {
  source: string;
  beam: Beam;
  eis: boolean;
}

/**
 * A program as the hash of a URL: `#code=` and the UTF-8 source in base64url, then
 * `&beam=scan` and `&eis=1` when they are on.
 */
export function shareHash(p: Shared): string {
  const bytes = new TextEncoder().encode(p.source);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return '#code=' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    + (p.beam === 'scan' ? '&beam=scan' : '') + (p.eis ? '&eis=1' : '');
}

/** The program in a URL's hash, or null if it has none (or a broken one). */
export function sharedProgram(hash: string): Shared | null {
  const m = /^#code=([A-Za-z0-9_-]*)((?:&[a-z]+=[a-z0-9]+)*)$/.exec(hash);
  if (!m) return null;
  const opts = new URLSearchParams(m[2].slice(1));
  try {
    const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    const source = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return { source, beam: opts.get('beam') === 'scan' ? 'scan' : 'instant', eis: opts.get('eis') === '1' };
  } catch { return null; }
}
