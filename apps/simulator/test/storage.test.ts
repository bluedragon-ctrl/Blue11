import { describe, expect, it } from 'vitest';
import { Library, shareHash, sharedProgram, type KeyValue } from '../src/storage';

const memory = (): KeyValue & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe('programs kept in the browser', () => {
  it('keeps the current program and saved ones by name', () => {
    const store = memory();
    const lib = new Library(store);
    expect(lib.current).toBeNull();
    lib.current = ' HALT';
    lib.save('one', ' MOV #1, R0');
    lib.save('two', ' MOV #2, R0');
    lib.save('one', ' MOV #3, R0');
    const again = new Library(store);
    expect(again.current).toBe(' HALT');
    expect(again.saved).toEqual({ one: ' MOV #3, R0', two: ' MOV #2, R0' });
    again.delete('one');
    expect(new Library(store).saved).toEqual({ two: ' MOV #2, R0' });
  });

  it('works without storage, and with broken or failing storage', () => {
    const none = new Library(null);
    none.save('x', 'y');
    expect(none.saved).toEqual({});
    const store = memory();
    store.data.set('blue11.sim.programs', '{not json');
    expect(new Library(store).saved).toEqual({});
    const failing: KeyValue = { getItem: () => { throw new Error('off'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} };
    const lib = new Library(failing);
    lib.current = 'x';
    expect(lib.current).toBeNull();
  });
});

describe('programs shared by URL', () => {
  it('round-trips any text, in characters a URL keeps', () => {
    const src = '; Grüße: ½ → ok\n        MOVB #\'A, R0\t; +/=\n        HALT\n';
    const h = shareHash({ source: src, beam: 'instant', eis: false });
    expect(h).toMatch(/^#code=[A-Za-z0-9_-]+$/);
    expect(sharedProgram(h)).toEqual({ source: src, beam: 'instant', eis: false });
  });

  it('carries the options, not the input', () => {
    const h = shareHash({ source: ' HALT', beam: 'scan', eis: true });
    expect(h).toMatch(/&beam=scan&eis=1$/);
    expect(sharedProgram(h)).toEqual({ source: ' HALT', beam: 'scan', eis: true });
  });

  it('ignores other hashes and broken ones', () => {
    expect(sharedProgram('')).toBeNull();
    expect(sharedProgram('#other')).toBeNull();
    expect(sharedProgram('#code=%%%')).toBeNull();
    expect(sharedProgram('#code=' + btoa('\xff\xfe').replace(/=+$/, ''))).toBeNull(); // not UTF-8
  });
});

describe('the retro look', () => {
  it('is on unless turned off, and is remembered', () => {
    const store = memory();
    expect(new Library(store).retro).toBe(true);
    new Library(store).retro = false;
    expect(new Library(store).retro).toBe(false);
    new Library(store).retro = true;
    expect(new Library(store).retro).toBe(true);
    expect(new Library(null).retro).toBe(true);
  });
});
