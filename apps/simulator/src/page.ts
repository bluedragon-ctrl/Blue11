/**
 * The simulator page: the editor, Run / Continue / Pause / Step, the screen on a canvas
 * with the keyboard, the speaker, the console, the registers, disassembly, memory, stack, the listing,
 * the memory explorer,
 * the ROM, the examples and saved programs, sharing by URL, the input log, and the help.
 *
 * The machine runs whole frames paced by animation frames. The speed setting (frames per
 * second of wall time) is the only use of wall-clock time, with the speaker's scheduling
 * (src/speaker.ts), and it never reaches the simulation (src/sim.ts), whose time is cycles.
 */

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { frameToRgba, keyCode, octal, type AsmError, type Frame } from 'blue11';
import { blue11Asm, blue11Highlight } from 'blue11/codemirror';
import {
  addressNamer, charOf, disassemblyAround, explorerInstructions, explorerRows, inRom, lineHeat, MAP_COLS, MAP_ROWS, mapAddress,
  accessMapRgba, accessText, mapCell, memoryLayout, memoryMapRgba, memoryRows, memorySnapshot, parseAddress, pixelAddress, pixelsOfWord, numberParts, READ_TAKES, regionOf, registerText, registerTitles, ROW_WORDS, stackRows, vectorName, type MemCell, type PixelSpot, type Role,
} from './debug';
import { breakpointLines, debugExtensions, setErrors, setHeat, setPcLine, toggleBreakpointAtCursor } from './editor';
import { CYCLES_PER_SECOND, lastHalfPeriod, shouldPlay } from './audio';
import { REAL_TIME, SPEEDS, speedText as speedLine, speedWhy } from './speed';
import { HELP, inComment, wordAt } from './help';
import { helpTooltip } from './help/tooltip';
import { numberTooltip } from './number-tip';
import { HelpView } from './help/view';
import { FIRST, PROGRAMS, type Program } from './programs';
import { romAssembly } from './rom';
import { SIM_SYMBOLS } from '../../../packages/blue11/examples/examples';
import { parseRecording, record, Simulator, type InputEvent, type StepResult, type WatchHit } from './sim';
import { Speaker } from './speaker';
import { Library, shareHash, sharedProgram } from './storage';
import { describeTrap } from './traps';

/** At most this long (ms) of simulation per animation frame, so the page still answers. */
const BUDGET_MS = 40;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function div(className: string, text: string): HTMLDivElement {
  const e = document.createElement('div');
  e.className = className;
  e.textContent = text;
  return e;
}

/** One line of the input log. */
function inputText(e: InputEvent): string {
  const what = e.kind === 'key' ? `key ${octal(e.code, 3)} ${e.down ? 'down' : 'up'}` : `console ${octal(e.ch, 3)}${e.ch >= 0o40 && e.ch < 0o177 ? ` '${String.fromCharCode(e.ch)}'` : ''}`;
  return `${String(e.cycle).padStart(9)}  ${what}`;
}

export function startPage(): void {
  const sim = new Simulator();
  const library = new Library(browserStorage());
  const status = $('status');
  const canvas = $<HTMLCanvasElement>('screen');
  const ctx = canvas.getContext('2d')!;
  const programSelect = $<HTMLSelectElement>('program');
  const speed = $<HTMLInputElement>('speed');
  const beam = $<HTMLInputElement>('beam');
  const eis = $<HTMLInputElement>('eis');
  const retro = $<HTMLInputElement>('retro');
  const soundOn = $<HTMLInputElement>('sound');
  const volume = $<HTMLInputElement>('volume');
  const speaker = new Speaker();
  const crt = $('crt');
  const beamRow = $('beam-row');
  const buttons = {
    run: $<HTMLButtonElement>('run'),
    continue: $<HTMLButtonElement>('continue'),
    pause: $<HTMLButtonElement>('pause'),
    step: $<HTMLButtonElement>('step'),
    stepFrame: $<HTMLButtonElement>('step-frame'),
    restart: $<HTMLButtonElement>('restart'),
    replay: $<HTMLButtonElement>('replay'),
    save: $<HTMLButtonElement>('save'),
    delete: $<HTMLButtonElement>('delete'),
    share: $<HTMLButtonElement>('share'),
  };

  let running = false;
  let animation = 0;
  let lastTime = 0;
  let owed = 0; // frames owed to the speed setting, fractional
  let resumeNext = false; // the next frame passes a breakpoint at the PC (Continue)
  /** The example open in the editor (its keys hint, its console input), or null. */
  let example: Program | null = null;
  /** The saved program open in the editor, or null. */
  let savedName: string | null = null;
  /** Breakpoints set in the disassembly at addresses with no source line (the ROM). */
  const romBreakpoints = new Set<number>();
  let shownFrame: Frame | null = null;

  // ---------------------------------------------------------------- help

  const helpDialog = $<HTMLDialogElement>('help');
  const help = new HelpView(helpDialog, HELP);
  /** F1 in the editor: help on the word under the cursor (the contents if none, or in a comment). */
  const helpAtCursor = (view: EditorView): boolean => {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const col = pos - line.from;
    help.open(inComment(line.text, col) ? null : HELP.topicFor(wordAt(line.text, col)));
    return true;
  };
  $('show-help').addEventListener('click', () => help.open());
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'F1' || ev.defaultPrevented) return;
    ev.preventDefault();
    if (help.isOpen) helpDialog.close(); else help.open();
  });

  // ---------------------------------------------------------------- editor

  const editor = new EditorView({
    parent: $('editor'),
    state: EditorState.create({
      doc: '',
      extensions: [
        debugExtensions, lineNumbers(), history(), helpTooltip(HELP, (t) => help.open(t)),
        numberTooltip(() => (current() ? sim.program?.symbols ?? null : null), (w) => HELP.entryFor(w) !== null),
        keymap.of([
          { key: 'F1', run: helpAtCursor },
          { key: 'Mod-Enter', run: () => { run(); return true; } },
          { key: 'F9', run: toggleBreakpointAtCursor },
          { key: 'F10', run: () => { step(); return true; } },
          ...defaultKeymap, ...historyKeymap]),
        blue11Asm, blue11Highlight, EditorView.theme({}, { dark: true }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) { library.current = source(); refresh(); }
          // a breakpoint toggled: show it in the disassembly (our own effects are skipped)
          if (u.transactions.some((t) => t.effects.some((e) => !e.is(setHeat) && !e.is(setPcLine) && !e.is(setErrors)))) {
            queueMicrotask(show);
          }
        }),
      ],
    }),
  });
  const source = () => editor.state.doc.toString();
  /** The editor holds the program that is loaded, so its lines are the program's. */
  const current = () => sim.source !== null && sim.source === source();

  function setSource(text: string): void {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text }, effects: setErrors.of([]) });
  }

  // ---------------------------------------------------------------- programs menu

  function fillPrograms(selected: string): void {
    programSelect.replaceChildren();
    const first = document.createElement('option');
    first.value = '';
    first.textContent = 'Open a program…';
    programSelect.append(first);
    const groups = new Map<string, HTMLOptGroupElement>();
    const add = (group: string, value: string, label: string) => {
      let g = groups.get(group);
      if (!g) {
        g = document.createElement('optgroup');
        g.label = group;
        groups.set(group, g);
        programSelect.append(g);
      }
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      g.append(o);
    };
    for (const name of Object.keys(library.saved).sort()) add('My programs', `saved:${name}`, name);
    for (const p of PROGRAMS) add(`Examples: ${p.group}`, `example:${p.id}`, p.name);
    programSelect.value = selected;
  }

  function openExample(p: Program): void {
    pause();
    example = p;
    savedName = null;
    setSource(p.source.replace(/^\n/, ''));
    if (p.beam !== undefined || beam.checked) setBeam(p.beam === 'scan');
    fillPrograms(`example:${p.id}`);
    $('keys-hint').textContent = p.keys ?? (p.input ? `Run it, click the console and type, for example “${p.input}”.` : '');
    showStatus(`${p.name}: press Run.`);
  }

  function openSaved(name: string): void {
    const text = library.saved[name];
    if (text === undefined) return;
    pause();
    example = null;
    savedName = name;
    setSource(text);
    fillPrograms(`saved:${name}`);
    $('keys-hint').textContent = '';
    showStatus(`${name}: press Run.`);
  }

  programSelect.addEventListener('change', () => {
    const v = programSelect.value;
    if (v.startsWith('example:')) {
      const p = PROGRAMS.find((x) => `example:${x.id}` === v);
      if (p) openExample(p);
    } else if (v.startsWith('saved:')) openSaved(v.slice(6));
  });

  buttons.save.addEventListener('click', () => {
    const name = window.prompt('Save the program in this browser as:', savedName ?? example?.name ?? 'My program')?.trim();
    if (!name) return;
    library.save(name, source());
    savedName = name;
    example = null;
    fillPrograms(`saved:${name}`);
    showStatus(`Saved as “${name}” in this browser.`, 'done');
    refresh();
  });

  buttons.delete.addEventListener('click', () => {
    if (!savedName || !window.confirm(`Delete “${savedName}” from this browser? The editor keeps the text.`)) return;
    library.delete(savedName);
    showStatus(`Deleted “${savedName}”.`);
    savedName = null;
    fillPrograms('');
    refresh();
  });

  buttons.share.addEventListener('click', async () => {
    const url = location.href.replace(/#.*$/, '') + shareHash({ source: source(), beam: sim.beam, eis: sim.eis });
    window.history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      showStatus('A link to this program (and the beam and EIS settings) is copied: whoever opens it gets the program in their editor.', 'done');
    } catch {
      showStatus('The address bar now holds a link to this program: copy it from there.', 'done');
    }
  });

  // ---------------------------------------------------------------- settings

  const speedText = $('speed-text');
  const fps = () => SPEEDS[Number(speed.value)] ?? REAL_TIME;
  function showSpeed(): void {
    speedText.textContent = speedLine(fps(), soundOn.checked);
    speedText.title = speedWhy(fps(), soundOn.checked);
    try { browserStorage()?.setItem('blue11.sim.speed', speed.value); } catch { /* off */ }
  }
  speed.addEventListener('input', showSpeed);
  const savedSpeed = (() => { try { return browserStorage()?.getItem('blue11.sim.speed'); } catch { return null; } })();
  if (savedSpeed !== null && savedSpeed !== undefined && SPEEDS[Number(savedSpeed)] !== undefined) speed.value = savedSpeed;
  showSpeed();

  function setBeam(scan: boolean): void {
    beam.checked = scan;
    if (sim.beam !== (scan ? 'scan' : 'instant')) {
      sim.configure({ beam: scan ? 'scan' : 'instant' });
      afterRebuild();
    }
  }
  soundOn.checked = library.sound;
  volume.value = String(library.volume);
  const applySound = () => { speaker.mute = !soundOn.checked; speaker.volume = (Number(volume.value) / 100) ** 2; showSpeed(); };
  applySound();
  soundOn.addEventListener('change', () => { library.sound = soundOn.checked; applySound(); });
  volume.addEventListener('input', () => { library.volume = Number(volume.value); applySound(); });
  const setRetro = (on: boolean) => { retro.checked = on; document.body.classList.toggle('retro', on); };
  setRetro(library.retro);
  retro.addEventListener('change', () => { library.retro = retro.checked; setRetro(retro.checked); });
  beam.addEventListener('change', () => { pause(); setBeam(beam.checked); if (sim.program) showStatus('The beam changed: the program starts again from the beginning.'); });
  eis.addEventListener('change', () => {
    pause();
    sim.configure({ eis: eis.checked });
    afterRebuild();
    if (sim.program) showStatus('EIS changed: the program starts again from the beginning.');
  });
  /** A new machine was built: show it. */
  function afterRebuild(): void {
    shownFrame = null;
    show();
  }

  // ---------------------------------------------------------------- input: keyboard and console

  // Keys go to the program while the screen or the console has focus (keyboard spec §7.1):
  // to the keyboard device as presses and releases, and, if they type a character, to the
  // console as that character too (with the layout and auto-repeat).
  const output = $('output');
  const focusLabel = $('focus-label');
  /** The character a key types on the console, or -1. */
  const typed = (e: KeyboardEvent) => e.key === 'Enter' ? 0o15 : e.key === 'Backspace' ? 0o10 : e.key === 'Escape' ? 0o33
    : e.key === 'Tab' ? 0o11 : e.key === 'Delete' ? 0o177 : e.key.length === 1 && e.key.charCodeAt(0) < 0o200 ? e.key.charCodeAt(0) : -1;
  for (const el of [canvas, output]) {
    el.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.key === 'Meta') return; // the browser's shortcuts
      const code = keyCode(e.code);
      const ch = e.altKey ? -1 : typed(e);
      if (!code && ch < 0) return;
      e.preventDefault();
      if (code && !e.repeat) sim.press(e.code);
      if (ch >= 0) sim.type(ch);
      showInputs();
    });
    el.addEventListener('keyup', (e) => {
      if (!keyCode(e.code)) return;
      e.preventDefault();
      sim.release(e.code);
      showInputs();
    });
    el.addEventListener('focus', () => { focusLabel.hidden = false; });
    el.addEventListener('blur', () => { focusLabel.hidden = true; sim.releaseAll(); showInputs(); });
  }

  // ---------------------------------------------------------------- commands

  function showStatus(text: string, kind: 'info' | 'error' | 'done' = 'info'): void {
    status.textContent = text;
    status.className = kind;
  }

  function refresh(): void {
    const can = current() && sim.canRun;
    buttons.run.disabled = false;
    buttons.continue.disabled = running || !can;
    buttons.pause.disabled = !running;
    buttons.step.disabled = running;
    buttons.stepFrame.disabled = running || !can;
    buttons.restart.disabled = !sim.program;
    buttons.replay.disabled = !current();
    $<HTMLButtonElement>('save-log').disabled = !current();
    buttons.delete.disabled = !savedName;
  }

  /** Assemble the editor's program and load it; false (with the errors shown) if it has any. */
  function load(): boolean {
    const errors: AsmError[] = sim.load(source());
    const lines = errors.filter((e) => e.line > 0);
    editor.dispatch({ effects: setErrors.of(lines.map((e) => ({ line: e.line, message: e.message }))) });
    if (errors.length) {
      const e = errors[0];
      showStatus(`${errors.length} error${errors.length > 1 ? 's' : ''}${e.line ? `, the first on line ${e.line}` : ''}: ${e.message}`, 'error');
      running = false;
      show();
      return false;
    }
    const w = sim.program!.warnings;
    showStatus(w.length ? `Loaded, with a warning on line ${w[0].line}: ${w[0].message}` : 'Loaded.');
    return true;
  }

  function run(): void {
    if (!load()) return;
    go(false);
  }

  function go(resume: boolean): void {
    if (!sim.canRun) return;
    speaker.start(); // from a click: browsers allow audio only then
    running = true;
    resumeNext = resume;
    owed = 1;
    lastTime = performance.now();
    showStatus('Running…');
    if (!canvas.matches(':focus') && !output.matches(':focus')) canvas.focus();
    cancelAnimationFrame(animation);
    animation = requestAnimationFrame(tick);
    show();
  }

  function pause(): void {
    if (!running) return;
    running = false;
    cancelAnimationFrame(animation);
    showStatus(`Paused at ${octal(sim.cpu.r[7])}.`);
    show();
  }

  /** The editor's breakpoints (while it holds the loaded program) and the ROM ones. */
  function syncBreakpoints(): void {
    const set = new Set(romBreakpoints);
    if (current()) {
      for (const l of breakpointLines(editor.state)) {
        const a = sim.addressOfLine(l);
        if (a !== null) set.add(a);
      }
    }
    sim.breakpoints = set;
  }

  function tick(now: number): void {
    if (!running) return;
    owed = Math.min(owed + ((now - lastTime) / 1000) * fps(), 50);
    lastTime = now;
    syncBreakpoints();
    const until = performance.now() + BUDGET_MS;
    if (view === 'memory') mark(); // running, a word is marked if this animation frame changed it
    while (owed >= 1 && running) {
      owed -= 1;
      const r = sim.runFrame(resumeNext);
      resumeNext = false;
      const chunk = sim.takeSound();
      if (shouldPlay(true, fps())) speaker.play(chunk); else speaker.skip(chunk);
      if (r.stop !== 'frame') stopped(r);
      if (performance.now() > until) { owed = 0; break; }
    }
    show();
    if (running) animation = requestAnimationFrame(tick);
  }

  /** The run stopped by itself: say why. */
  function stopped(r: StepResult): void {
    running = false;
    const pc = octal(sim.cpu.r[7]);
    switch (r.stop) {
      case 'halt': showStatus(`HALT at ${octal((sim.cpu.r[7] - 2) & 0xffff)}. Continue goes on after it.`, 'done'); break;
      case 'breakpoint': showStatus(`Breakpoint at ${pc}. Step, or Continue.`); break;
      case 'watch': showStatus(watchText(r.watch!)); break;
      case 'asleep': showStatus(`WAIT at ${pc}, and no device has interrupts on: nothing can wake the CPU.`, 'error'); break;
      case 'double-fault': showStatus(`Double fault at ${pc}: a trap could not push onto the stack (is SP valid?). Run starts again.`, 'error'); break;
      case 'trap': showStatus(describeTrap(r.trap!, sim.cpu, (a) => sim.machine.read(a, false)), 'error'); break;
      default: break;
    }
  }

  /** The status for a stop on a watched word: which, by what, from what to what. */
  function watchText(h: WatchHit): string {
    const name = addressNamer(sim.program)(h.address);
    const what = `${octal(h.address)}${name ? ` (${name})` : ''}`;
    const part = h.byte ? `its ${h.at & 1 ? 'high' : 'low'} byte, ` : '';
    const change = h.was < 0 ? `now ${octal(h.now)}` : h.was === h.now ? `${octal(h.now)} again` : `${octal(h.was)} → ${octal(h.now)}`;
    if (h.interrupt) return `Stopped: an interrupt pushed onto ${what} (${change}), after the instruction at ${octal(h.pc)}; its handler ran one instruction. Step, or Continue.`;
    return `Stopped: the instruction at ${octal(h.pc)} wrote ${what}, ${part}${change}. Step, or Continue.`;
  }

  function step(): void {
    if (running) return;
    if (!current() || !sim.canRun) {
      if (!load()) return;
      mark();
      showStatus(`Loaded: stopped at the first instruction, ${octal(sim.cpu.r[7])}. Step again to run it.`);
      show();
      return;
    }
    mark();
    const r = sim.step();
    if (r.stop === 'step') showStatus(`Stepped: ${r.cycles} cycles.`);
    else if (r.stop === 'frame') showStatus('Asleep in WAIT for the whole frame: no interrupt came.');
    else stopped(r);
    show();
  }

  buttons.run.addEventListener('click', run);
  buttons.continue.addEventListener('click', () => { if (current()) go(true); });
  buttons.pause.addEventListener('click', pause);
  buttons.step.addEventListener('click', step);
  buttons.stepFrame.addEventListener('click', () => {
    if (!current()) return;
    syncBreakpoints();
    mark();
    const r = sim.runFrame(true);
    if (r.stop === 'frame') showStatus(`Frame ${octal(sim.display.frame.number)} done.`);
    else stopped(r);
    show();
  });
  buttons.restart.addEventListener('click', () => {
    pause();
    if (current()) sim.restart(); else if (!load()) return;
    mark();
    showStatus(`Restarted: stopped at the first instruction, ${octal(sim.cpu.r[7])}.`);
    show();
  });
  buttons.replay.addEventListener('click', () => {
    if (!current()) return;
    pause();
    const n = sim.inputs.length;
    sim.replay();
    go(false);
    showStatus(`Replaying ${n} input${n === 1 ? '' : 's'} at their cycles…`);
  });

  // A replay saved to a file: the program, its options and its input log.
  $('save-log').addEventListener('click', () => {
    const rec = record(sim);
    if (!rec) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(rec, null, 1)], { type: 'application/json' }));
    a.download = `${(savedName ?? example?.name ?? 'program').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.replay.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const logFile = $<HTMLInputElement>('log-file');
  $('open-log').addEventListener('click', () => logFile.click());
  logFile.addEventListener('change', async () => {
    const file = logFile.files?.[0];
    logFile.value = '';
    if (!file) return;
    const rec = parseRecording(await file.text());
    if (typeof rec === 'string') { showStatus(`${file.name}: ${rec}.`, 'error'); return; }
    pause();
    example = null;
    savedName = null;
    fillPrograms('');
    setSource(rec.source);
    setBeam(rec.beam === 'scan');
    eis.checked = rec.eis;
    sim.configure({ eis: rec.eis });
    if (!load()) return;
    sim.replay(rec.inputs);
    go(false);
    showStatus(`Replaying ${file.name}: ${rec.inputs.length} inputs at their cycles…`);
  });

  // ---------------------------------------------------------------- views

  const VIEWS = ['screen', 'listing', 'rom', 'sound', 'memory'] as const;
  type View = (typeof VIEWS)[number];
  let view: View = 'screen';
  function setView(v: View): void {
    view = v;
    if (v === 'memory' && !before) mark();
    for (const k of VIEWS) {
      $(`view-${k}`).hidden = k !== v;
      $(`tab-${k}`).classList.toggle('active', k === v);
      $(`tab-${k}`).setAttribute('aria-selected', String(k === v));
    }
    show();
  }
  for (const k of VIEWS) $(`tab-${k}`).addEventListener('click', () => setView(k));

  /** The listings: rebuilt for a new program, then only the PC's row changes. */
  const listings = {
    listing: { el: $('listing'), of: null as unknown, rows: [] as Array<{ el: HTMLElement; line: number }> },
    rom: { el: $('rom-listing'), of: null as unknown, rows: [] as Array<{ el: HTMLElement; line: number }> },
  };
  function showListing(which: 'listing' | 'rom'): void {
    const l = listings[which];
    const asm = which === 'rom' ? romAssembly() : sim.program;
    if (l.of !== asm) {
      l.of = asm;
      l.rows = (asm?.listingRows ?? []).map((r) => ({ el: div('lrow', r.text || ' '), line: r.line }));
      l.el.replaceChildren(...(l.rows.length ? l.rows.map((r) => r.el) : [div('empty', 'Run or Step to assemble the program: the listing shows each line with its address and the words it became.')]));
    }
    const pc = sim.cpu.r[7];
    const line = !running ? asm?.lineAt.get(pc) : undefined;
    let pcRow: HTMLElement | null = null;
    for (const r of l.rows) {
      const on = line !== undefined && r.line === line && /^\s*[0-7]{6}/.test(r.el.textContent ?? '');
      r.el.classList.toggle('pc', on);
      if (on && !pcRow) pcRow = r.el;
    }
    if (pcRow) {
      const top = pcRow.offsetTop - l.el.offsetTop;
      if (top < l.el.scrollTop || top > l.el.scrollTop + l.el.clientHeight - pcRow.offsetHeight) l.el.scrollTop = top - l.el.clientHeight / 3;
    }
  }

  /** The ROM tab, scrolled to a line of rom.mac. */
  function showRomLine(line: number): void {
    setView('rom');
    const r = listings.rom.rows.find((x) => x.line === line);
    if (!r) return;
    for (const x of listings.rom.rows) x.el.classList.toggle('picked', x === r);
    listings.rom.el.scrollTop = r.el.offsetTop - listings.rom.el.offsetTop - listings.rom.el.clientHeight / 3;
  }

  /** The editor, at a line of the program. */
  function showLine(line: number): void {
    const l = editor.state.doc.line(Math.min(line, editor.state.doc.lines));
    editor.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
    editor.focus();
  }

  // ---------------------------------------------------------------- the memory explorer

  /** Memory as it was when the last command started: the words it changed are marked. */
  let before: Int32Array | null = null;
  const peekRead = (a: number) => sim.machine.read(a, false);
  /** Remember memory now, to show what the next command changes (only while the Memory tab is open). */
  function mark(): void { before = view === 'memory' ? memorySnapshot(peekRead) : null; }
  /** The bytes shown at a time: 40 rows of 20. */
  const MX_ROWS = 0o40;
  const mxAddr = $<HTMLInputElement>('mx-addr');
  const mxAs = $<HTMLSelectElement>('mx-as');
  let picked: number | null = null;
  /** The pixel the word was picked from on the screen (Shift+click), if it was. */
  let pickedPixel: PixelSpot | null = null;

  /** The first address the explorer shows: what is typed (a register follows it), else the program. */
  function explorerStart(): number | null {
    const prog = sim.program;
    if (!mxAddr.value.trim()) return prog ? prog.origin : 0o1000;
    return parseAddress(mxAddr.value, prog?.symbols ?? new Map(), sim.cpu.r);
  }
  function goTo(text: string): void { mxAddr.value = text; picked = null; pickedPixel = null; setView('memory'); }
  function scrollExplorer(bytes: number): void {
    const at = explorerStart();
    if (at === null) return;
    mxAddr.value = octal(Math.max(0, Math.min(0o200000 - MX_ROWS * 2 * ROW_WORDS, (at & ~0o17) + bytes)));
    show();
  }

  const ROLE_TEXT: Record<Role, string> = {
    code: 'an instruction (its first word)', operand: 'an operand word of the instruction before it',
    data: 'data (.WORD, .BYTE, .ASCII, .BLKW…)', stack: 'on the stack',
  };

  /** One word in words: what it is, where it came from, what it was. */
  function cellText(c: MemCell): string {
    const r = regionOf(c.address);
    const parts = [`${octal(c.address)}: ${c.value !== null ? octal(c.value) : READ_TAKES.has(c.address) ? 'not read here: reading it would take the character from the program' : 'nothing answers here (a bus error)'}`];
    if (c.value !== null) parts.push(`bytes ${octal(c.value & 0xff, 3)} ${octal(c.value >> 8, 3)} (low first) '${charOf(c.value & 0xff)}${charOf(c.value >> 8)}'`, ...numberParts(c.value).slice(1, 4));
    parts.push(`in ${r.name}`);
    if (c.name) parts.push(`label ${c.name}`);
    const v = vectorName(c.address);
    if (v && r.region === 'vectors') parts.push(`vector of ${v}`);
    if (c.role) parts.push(ROLE_TEXT[c.role]);
    if (r.region === 'pixels') parts.push(pixelsText(c.address));
    const src = layout?.source(c.address);
    if (src) parts.push(`${src.rom ? 'rom.mac ' : ''}line ${src.line}`);
    if (c.address === sim.cpu.r[7]) parts.push('PC points here');
    if (c.address === sim.cpu.r[6]) parts.push('SP points here');
    if (sim.access) parts.push(accessText(sim.access.reads[c.address >> 1], sim.access.writes[c.address >> 1]));
    if (watchSet.has(c.address)) parts.push('a write stops the run');
    if (c.was !== undefined) parts.push(`changed by the last command (was ${c.was === null ? '------' : octal(c.was)})`);
    return parts.join(' · ');
  }

  /** The pixels a word of pixel memory holds, in the mode shown: on which page, and if it is shown. */
  function pixelsText(address: number): string {
    const { mode, page } = screenShown;
    for (let p = 0; p < (mode ? 2 : 4); p++) {
      const w = pixelsOfWord(address, mode, p);
      if (w) {
        const at = (x: number) => `(${octal(x, 1)}, ${octal(w.y, 1)})`;
        return `pixels ${at(w.x)}–${at(w.x + w.n - 1)} of page ${p} in mode ${mode}${p === (mode ? page & 1 : page) ? ', the page shown' : ''}`;
      }
    }
    return '';
  }

  let layout: ReturnType<typeof memoryLayout> | null = null;
  /** The words a write stops at. */
  let watchSet = new Set<number>();
  function showWatches(): void {
    const box = $('mx-watches');
    const list = sim.watches;
    box.hidden = !list.length;
    const nameOf = addressNamer(sim.program);
    box.replaceChildren('A write stops the run at:', ...list.flatMap((a) => {
      const go = Object.assign(document.createElement('button'), { className: 'small secondary', textContent: octal(a) + (nameOf(a) ? ` ${nameOf(a)}` : ''), title: 'Show it' });
      go.addEventListener('click', () => { goTo(octal(Math.max(0, (a & ~0o17) - 4 * 2 * ROW_WORDS))); picked = a; show(); });
      const x = Object.assign(document.createElement('button'), { className: 'small secondary', textContent: '×', title: 'No longer stop when it is written' });
      x.addEventListener('click', () => { sim.watch(a, false); show(); });
      return [go, x];
    }));
  }
  function showExplorer(): void {
    const prog = sim.program;
    const cpu = sim.cpu;
    watchSet = new Set(sim.watches);
    showWatches();
    screenShown = shownScreen();
    const at = explorerStart();
    mxAddr.classList.toggle('bad', at === null);
    const box = $('mx-rows');
    layout = memoryLayout(prog, romAssembly(), cpu.r[6], Math.max(sim.stackTop, cpu.r[6] & 0xfffe));
    drawMap(at);
    if (at === null) { box.replaceChildren(div('empty', 'An octal address, a label, a device name or a register.')); return; }
    const nameOf = addressNamer(prog);
    const r = regionOf(at);
    const end = Math.min(0o200000, (at & ~0o17) + MX_ROWS * 2 * ROW_WORDS);
    $('mx-where').textContent = `${octal(at & ~0o17)}–${octal(end - 1)} · ${r.name} (${octal(r.start)}–${octal(r.end - 1)}): ${r.about}.`;
    const pc = cpu.r[7];
    const sp = cpu.r[6];
    const cls = (c: { address: number; role: Role | null }) => `w ${c.role ?? regionOf(c.address).region}`
      + (c.address === pc ? ' pc' : '') + (c.address === sp ? ' sp' : '') + (c.address === picked ? ' picked' : '') + (watchSet.has(c.address) ? ' watched' : '');
    const pick = (c: MemCell) => (e: Event) => {
      picked = c.address;
      pickedPixel = null;
      e.stopPropagation();
      show();
    };
    const rows: HTMLElement[] = [];
    if (mxAs.value === 'code') {
      for (const d of explorerInstructions(peekRead, layout, at, MX_ROWS, nameOf)) {
        const e = div(`mrow ins ${d.role ?? 'none'}` + (d.address === pc ? ' pc' : '') + (d.address === picked ? ' picked' : ''), '');
        e.append(
          Object.assign(document.createElement('span'), { className: 'a', textContent: octal(d.address) }),
          Object.assign(document.createElement('span'), { className: `w ${d.role ?? regionOf(d.address).region}`, textContent: d.words.map((w) => octal(w)).join(' ').padEnd(20) }),
          Object.assign(document.createElement('span'), { className: 'lbl', textContent: d.label ? `${d.label}:` : '' }),
          Object.assign(document.createElement('span'), { className: 't', textContent: d.text }),
          Object.assign(document.createElement('span'), { className: 'tag', textContent: d.role === 'data' || d.role === 'stack' ? d.role : d.role === 'operand' ? 'inside an instruction' : '' }),
        );
        const c: MemCell = { address: d.address, value: d.words[0] ?? null, role: d.role, name: d.label };
        e.title = cellText(c);
        e.addEventListener('click', pick(c));
        if (c.address === picked) showDetail(c);
        rows.push(e);
      }
    } else {
      const bytes = mxAs.value === 'bytes';
      for (const row of explorerRows(peekRead, layout, at, MX_ROWS, { before, nameOf })) {
        const e = div('mrow', '');
        e.append(Object.assign(document.createElement('span'), { className: 'a', textContent: octal(row.address) }));
        let text = '';
        for (const c of row.cells) {
          const v = c.value;
          const cell = document.createElement('span');
          cell.className = cls(c) + (c.was !== undefined ? ' changed' : '') + (c.name ? ' named' : '');
          cell.textContent = v === null ? (bytes ? '--- ---' : '------') : bytes ? `${octal(v & 0xff, 3)} ${octal(v >> 8, 3)}` : octal(v);
          if (bytes && v !== null && pickedPixel && (pickedPixel.address & ~1) === c.address) {
            // the byte the pixel is in, and in mode 1 its half
            const b = (lo: boolean) => Object.assign(document.createElement('span'), { className: lo === !(pickedPixel!.address & 1) ? 'pbyte' : '', textContent: octal(lo ? v & 0xff : v >> 8, 3) });
            cell.replaceChildren(b(true), ' ', b(false));
          }
          cell.title = cellText(c);
          cell.addEventListener('click', pick(c));
          if (c.address === picked) showDetail(c);
          e.append(cell);
          text += v === null ? '  ' : charOf(v & 0xff) + charOf(v >> 8);
        }
        e.append(
          Object.assign(document.createElement('span'), { className: 'asc', textContent: text }),
          Object.assign(document.createElement('span'), { className: 'lbl', textContent: row.cells.filter((c) => c.name).map((c) => c.name).join(' ') }),
        );
        rows.push(e);
      }
    }
    box.replaceChildren(...rows);
    if (picked === null) $('mx-detail').replaceChildren(div('empty', 'Click a word to see what it is: its bytes, its label, the line that made it.'));
  }

  // The map: a dot per word (the canvas has 2 × 2 pixels per dot, for the marks).
  const mapCanvas = $<HTMLCanvasElement>('mx-map');
  const mapCtx = mapCanvas.getContext('2d')!;
  const mapDots = Object.assign(document.createElement('canvas'), { width: MAP_COLS, height: MAP_ROWS });
  const mapDotsCtx = mapDots.getContext('2d')!;
  const mapImage = mapDotsCtx.createImageData(MAP_COLS, MAP_ROWS);
  const showMap = $<HTMLInputElement>('mx-show-map');
  /** Memory as the map last drew it, for the text under the pointer. */
  let mapWords: Int32Array | null = null;

  function drawMap(at: number | null): void {
    $('mx-map-box').hidden = $('mx-map-at').hidden = !showMap.checked;
    if (!showMap.checked || !layout) return;
    mapWords = memorySnapshot(peekRead);
    if (sim.access) accessMapRgba(mapWords, sim.access.reads, sim.access.writes, mapImage.data);
    else memoryMapRgba(mapWords, layout, mapImage.data, { heat: sim.heat, before });
    mapDotsCtx.putImageData(mapImage, 0, 0);
    const k = mapCanvas.width / MAP_COLS;
    mapCtx.imageSmoothingEnabled = false;
    mapCtx.drawImage(mapDots, 0, 0, mapCanvas.width, mapCanvas.height);
    // the region boundaries
    mapCtx.fillStyle = '#ffffff40';
    for (const a of [0o120000, 0o160000, 0o170000]) mapCtx.fillRect(0, mapCell(a).y * k - 1, mapCanvas.width, 1);
    // the bytes shown below: 1000 bytes from `at`, one row of the map, or the ends of two
    if (at !== null) {
      const s = mapCell(at & ~0o17);
      mapCtx.strokeStyle = '#ffffffc0';
      mapCtx.lineWidth = 1;
      mapCtx.strokeRect(s.x * k + 0.5, s.y * k - 1.5, (MAP_COLS - s.x) * k - 1, k + 3);
      if (s.x && s.y + 1 < MAP_ROWS) mapCtx.strokeRect(0.5, (s.y + 1) * k - 1.5, s.x * k - 1, k + 3);
    }
    const ring = (addr: number, colour: string) => {
      const c = mapCell(addr);
      mapCtx.strokeStyle = colour;
      mapCtx.lineWidth = 2;
      mapCtx.strokeRect(c.x * k - 3, c.y * k - 3, k + 6, k + 6);
    };
    for (const a of watchSet) ring(a, '#ff8a1e');
    ring(sim.cpu.r[6], '#3cff3c');
    ring(sim.cpu.r[7], '#ffffff');
    if (picked !== null) ring(picked, '#39d0ff');
  }

  /** The word under the pointer on the map. */
  function mapAt(e: MouseEvent): number {
    const r = mapCanvas.getBoundingClientRect();
    const x = Math.min(MAP_COLS - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * MAP_COLS)));
    const y = Math.min(MAP_ROWS - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * MAP_ROWS)));
    return mapAddress(x, y);
  }
  mapCanvas.addEventListener('mousemove', (e) => {
    const a = mapAt(e);
    const w = mapWords?.[a >> 1] ?? -1;
    const c: MemCell = { address: a, value: w < 0 ? null : w, role: layout?.role(a) ?? null };
    const name = addressNamer(sim.program)(a);
    if (name) c.name = name;
    const n = sim.heat[a >> 1];
    $('mx-map-at').textContent = cellText(c) + (n ? ` · run ${octal(n, 1)} times` : '');
  });
  mapCanvas.addEventListener('mouseleave', () => { $('mx-map-at').textContent = 'Point at the map: the address and what is there. Click: show it below.'; });
  mapCanvas.addEventListener('click', (e) => {
    const a = mapAt(e);
    // a few rows before it, so that it is near the top
    mxAddr.value = octal(Math.max(0, Math.min(0o200000 - MX_ROWS * 2 * ROW_WORDS, (a & ~0o17) - 4 * 2 * ROW_WORDS)));
    picked = a;
    pickedPixel = null;
    show();
  });
  showMap.addEventListener('change', show);
  const countAccesses = $<HTMLInputElement>('mx-accesses');
  countAccesses.addEventListener('change', () => { sim.countAccesses(countAccesses.checked); show(); });

  function showDetail(c: MemCell): void {
    const d = $('mx-detail');
    d.replaceChildren(document.createTextNode(cellText(c)));
    const px = pickedPixel;
    if (px && (px.address & ~1) === c.address && c.value !== null) {
      const byte = px.address & 1 ? c.value >> 8 : c.value & 0xff;
      const colour = px.half === 'high' ? byte >> 4 : byte & 15;
      d.append(div('mx-pixel', `From the screen: pixel (${octal(px.x, 1)}, ${octal(px.y, 1)}) is byte ${octal(px.address)}`
        + (px.half ? `, its ${px.half} half (bits ${px.half === 'high' ? '7–4' : '3–0'}): ${octal(byte, 3)} → colour ${octal(colour, 2)}` : `: ${octal(byte, 3)} → colour ${octal(colour, 2)}${byte > 15 ? ' (the high 4 bits are kept, not shown)' : ''}`)
        + '.'));
    }
    const w = Object.assign(document.createElement('button'), {
      className: 'small secondary',
      textContent: watchSet.has(c.address) ? 'Don’t stop when written' : 'Stop when written',
      title: 'Stop the run after an instruction writes this word (or a byte of it), and say what it wrote',
    });
    w.addEventListener('click', () => { sim.watch(c.address, !watchSet.has(c.address)); show(); });
    d.append(' ', w);
    const src = layout?.source(c.address);
    if (src && (src.rom || current())) {
      const b = Object.assign(document.createElement('button'), { className: 'small secondary', textContent: src.rom ? `rom.mac line ${src.line}` : `Line ${src.line}` });
      b.addEventListener('click', () => (src.rom ? showRomLine(src.line) : showLine(src.line)));
      d.append(' ', b);
    }
  }

  mxAddr.addEventListener('input', () => { picked = null; pickedPixel = null; show(); });
  mxAs.addEventListener('change', show);
  $('mx-prev').addEventListener('click', () => scrollExplorer(-MX_ROWS * 2 * ROW_WORDS));
  $('mx-next').addEventListener('click', () => scrollExplorer(MX_ROWS * 2 * ROW_WORDS));
  $('mx-rows').addEventListener('wheel', (e) => {
    if (!e.deltaY) return;
    e.preventDefault();
    scrollExplorer(Math.sign(e.deltaY) * 4 * 2 * ROW_WORDS);
  }, { passive: false });
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-go]')) {
    b.addEventListener('click', () => {
      const g = b.dataset.go!;
      // SCREEN: the page DSPCS shows (bit 2 is the mode; bits 1–0 the page, bit 0 in mode 1)
      const csr = sim.machine.read(SIM_SYMBOLS.DSPCS, false);
      goTo(g === 'SCREEN' ? octal(0o120000 + (csr & 4 ? (csr & 1) * 0o20000 : (csr & 3) * 0o10000)) : g);
    });
  }
  $('mem-zoom').addEventListener('click', () => goTo($<HTMLInputElement>('mem-addr').value || 'SP'));

  function drawScreen(): void {
    // Once the program has ended, the monitor shows memory as it is (sim.screenNow).
    const f = !running && sim.ended ? sim.screenNow() : sim.display.frame;
    if (f === shownFrame) return;
    shownFrame = f;
    if (canvas.width !== f.width) { canvas.width = f.width; canvas.height = f.height; crt.style.setProperty('--rows', String(f.height)); }
    const img = ctx.createImageData(f.width, f.height);
    frameToRgba(f, img.data);
    ctx.putImageData(img, 0, 0);
  }

  // Pixels and addresses: pointing at the screen tells where a pixel is in memory; Shift+click
  // opens the Memory tab at that byte (a plain click gives the keys to the program).
  /** The page and mode of the picture shown: latched at the last blank, or once ended, DSPCS now. */
  function shownScreen(): { mode: number; page: number } {
    if (!running && sim.ended) {
      const csr = sim.machine.read(SIM_SYMBOLS.DSPCS, false);
      return { mode: csr & 4 ? 1 : 0, page: csr & 3 };
    }
    const s = sim.display.state();
    return { mode: s.mode, page: s.page };
  }
  let screenShown = { mode: 0, page: 0 };
  function pixelUnder(e: MouseEvent): PixelSpot | null {
    const f = shownFrame;
    if (!f) return null;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left - canvas.clientLeft) / canvas.clientWidth) * f.width);
    const y = Math.floor(((e.clientY - r.top - canvas.clientTop) / canvas.clientHeight) * f.height);
    if (x < 0 || y < 0 || x >= f.width || y >= f.height) return null;
    return pixelAddress(x, y, f.width === 128 ? 1 : 0, shownScreen().page);
  }
  const screenAt = $('screen-at');
  const SCREEN_AT_HINT = 'Point at a pixel: where it is in memory. Shift+click: open that byte in the Memory tab.';
  canvas.addEventListener('mousemove', (e) => {
    const px = pixelUnder(e);
    const f = shownFrame;
    if (!px || !f) { screenAt.textContent = SCREEN_AT_HINT; return; }
    const colour = f.pixels[px.y * f.width + px.x];
    const word = sim.machine.read(px.address & ~1, false);
    const byte = px.address & 1 ? word >> 8 : word & 0xff;
    const now = px.half === 'high' ? byte >> 4 : byte & 15;
    screenAt.textContent = [
      `pixel (${octal(px.x, 1)}, ${octal(px.y, 1)})`,
      `byte ${octal(px.address)}${px.half ? `, ${px.half} half (bits ${px.half === 'high' ? '7–4' : '3–0'})` : ''}`,
      `colour ${octal(colour, 2)}` + (now !== colour ? ` (memory now ${octal(now, 2)}: not shown yet)` : ''),
    ].join(' · ');
  });
  canvas.addEventListener('mouseleave', () => { screenAt.textContent = SCREEN_AT_HINT; });
  canvas.addEventListener('mousedown', (e) => { if (e.shiftKey) e.preventDefault(); });
  canvas.addEventListener('click', (e) => {
    if (!e.shiftKey) return;
    const px = pixelUnder(e);
    if (!px) return;
    mxAs.value = 'bytes';
    // a few rows before it, so that it is near the top
    mxAddr.value = octal(Math.max(0, Math.min(0o200000 - MX_ROWS * 2 * ROW_WORDS, (px.address & ~0o17) - 4 * 2 * ROW_WORDS)));
    picked = px.address & ~1;
    pickedPixel = px;
    setView('memory');
  });

  const wave = $<HTMLCanvasElement>('wave');
  const waveCtx = wave.getContext('2d')!;
  /** The speaker's last frame against a ruler in cycles. */
  function drawWave(): void {
    const t = sim.history.get();
    const W = wave.width;
    const H = wave.height;
    const len = sim.history.length;
    const start = t.to - len;
    const x = (c: number) => ((c - start) / len) * W;
    const hi = 30;
    const lo = H - 60;
    waveCtx.fillStyle = '#000';
    waveCtx.fillRect(0, 0, W, H);
    // the ruler: a tick every 1000 cycles, a number every 5000
    waveCtx.strokeStyle = '#ffffff40';
    waveCtx.fillStyle = '#ffffffa0';
    waveCtx.font = '20px ui-monospace, monospace';
    waveCtx.beginPath();
    for (let c = 0; c <= len; c += 1000) {
      const px = (c / len) * W;
      waveCtx.moveTo(px, H - 40);
      waveCtx.lineTo(px, H - (c % 5000 ? 32 : 24));
      if (c % 5000 === 0 && c < len) waveCtx.fillText(String(c), px + 4, H - 6);
    }
    waveCtx.stroke();
    // the speaker
    waveCtx.strokeStyle = '#39d0ff';
    waveCtx.lineWidth = 2;
    waveCtx.beginPath();
    let level = t.level;
    let px = x(Math.max(t.from, start));
    waveCtx.moveTo(px, level ? hi : lo);
    for (const e of t.edges) {
      px = x(e.cycle);
      waveCtx.lineTo(px, level ? hi : lo);
      level = e.level;
      waveCtx.lineTo(px, level ? hi : lo);
    }
    waveCtx.lineTo(x(t.to), level ? hi : lo);
    waveCtx.stroke();
    waveCtx.lineWidth = 1;
    const half = lastHalfPeriod(t, CYCLES_PER_SECOND);
    const read = (a: number) => sim.machine.read(a, false);
    $('wave-info').textContent = [
      `${t.edges.length} edge${t.edges.length === 1 ? '' : 's'} in the last frame`,
      half ? `last half period ${half.cycles} cycles (${half.hz < 1000 ? half.hz.toFixed(1) : Math.round(half.hz)} Hz)` : 'no tone',
      `SNDCS ${octal(read(0o176740), 1)}`, `SNDDIV ${octal(read(0o176742))}`,
    ].map((s) => s.replace(/ /g, '\u00a0')).join('   ');
  }

  function showInputs(): void {
    const all = sim.inputs;
    const el = $('inputs');
    el.textContent = all.length
      ? `${all.length} input${all.length === 1 ? '' : 's'} (cycle, what)\n` + all.slice(-200).map(inputText).join('\n')
      : 'Keys pressed on the screen and characters typed on the console are logged here with their cycle. Replay feeds them again.';
    el.scrollTop = el.scrollHeight;
  }

  /** Lines with a title each, the elements kept (a title being read stays while the run goes on). */
  function setLines(box: HTMLElement, lines: Array<{ text: string; title: string }>): void {
    if (box.firstChild && !(box.firstChild instanceof HTMLDivElement)) box.textContent = '';
    while (box.children.length > lines.length) box.lastChild!.remove();
    while (box.children.length < lines.length) box.append(document.createElement('div'));
    lines.forEach((l, i) => {
      const e = box.children[i] as HTMLElement;
      if (e.textContent !== l.text) e.textContent = l.text;
      if (e.title !== l.title) e.title = l.title;
    });
  }

  let lastOutput = '';
  function show(): void {
    refresh();
    syncBreakpoints();
    const cpu = sim.cpu;
    const pc = cpu.r[7];
    const prog = sim.program;
    const cur = !!prog && current();
    editor.dispatch({ effects: [
      setHeat.of(cur ? lineHeat(sim.heat, prog!.lineAt) : new Map()),
      setPcLine.of(cur && !running ? prog!.lineAt.get(pc) ?? null : null),
    ] });

    const titles = registerTitles(cpu);
    setLines($('regs'), registerText(cpu).split('\n').map((text, i) => ({ text, title: titles[i] ?? '' })));
    const out = sim.machine.output;
    if (out !== lastOutput) {
      lastOutput = out;
      output.textContent = out.replace(/\r\n?/g, '\n');
      output.scrollTop = output.scrollHeight;
    }

    // disassembly around the PC
    const read = (a: number) => sim.machine.read(a, false);
    const nameOf = addressNamer(prog);
    const starts = inRom(pc) ? romAssembly().lineAt.keys() : prog ? prog.lineAt.keys() : [];
    const rows = disassemblyAround(read, pc, starts, { before: 4, count: 14, nameOf });
    const width = Math.max(0, ...rows.map((r) => (r.label ?? '').length));
    $('disasm').replaceChildren(...rows.map((r) => {
      const e = document.createElement('div');
      const bp = sim.breakpoints.has(r.address);
      const n = sim.heat[r.address >> 1];
      e.className = 'row' + (r.address === pc ? ' pc' : '') + (bp ? ' bp' : '');
      e.textContent = `${bp ? '●' : ' '}${r.address === pc ? '▶' : ' '}${octal(r.address)} ${(r.label ? r.label + ':' : '').padEnd(width + 1)} ${r.text}`;
      if (n) e.append(Object.assign(document.createElement('span'), { className: 'count', textContent: octal(n, 1) }));
      e.title = `${r.words.map((w) => octal(w)).join(' ')}${n ? ` — run ${octal(n, 1)} times` : ''} — click: breakpoint`;
      e.addEventListener('click', () => toggleBreakpoint(r.address));
      return e;
    }));

    // memory and stack
    const memAddr = $<HTMLInputElement>('mem-addr');
    const at = parseAddress(memAddr.value || 'SP', prog?.symbols ?? new Map(), cpu.r);
    memAddr.classList.toggle('bad', at === null);
    $('memory').textContent = at === null ? 'An octal address, a label, a device name or a register.'
      : memoryRows(read, at, 8, 4).map((r) => `${octal(r.address)}  ${r.words.map((w) => (w === null ? '------' : octal(w))).join(' ')}`).join('\n');
    const base = Math.max(sim.stackTop, cpu.r[6] & 0xfffe);
    const st = stackRows(read, cpu.r[6], base);
    if (st.length) {
      setLines($('stack'), st.map((r, i) => ({
        text: `${i ? '    ' : 'SP →'} ${octal(r.address)}  ${octal(r.value)}${nameOf(r.value) ? `  ${nameOf(r.value)}` : ''}`,
        title: [`${octal(r.address)}: ${octal(r.value)}`, ...numberParts(r.value).slice(1)].join(' · '),
      })));
    } else $('stack').textContent = `Empty: SP = ${octal(cpu.r[6])}; the stack grows down from ${octal(base)}.`;

    // the screen and its line
    drawScreen();
    const d = sim.display;
    const f = d.frame;
    // Stopped mid-frame, a marker shows the row the beam reads next (DSPLIN).
    const row = d.line;
    const midFrame = !running && !!sim.program && !sim.ended && row !== 0o177777;
    beamRow.hidden = !midFrame;
    if (midFrame) beamRow.style.top = `calc(var(--tube) + (100% - 2 * var(--tube)) * ${(row + 0.5) / d.height})`;
    // Items are kept whole when the line wraps.
    $('screen-info').textContent = [
      `mode ${f.width === 128 ? 1 : 0} (${f.width} × ${f.height})`, `frame ${octal(f.number)}`, `cycle ${sim.machine.cycles}`,
      sim.beam === 'scan' ? 'real beam' : 'instant beam', `beam ${row === 0o177777 ? 'in blank' : `row ${octal(row, 3)}`}`,
    ].map((t) => t.replace(/ /g, '\u00a0')).join('   ');
    if (view === 'listing' || view === 'rom') showListing(view);
    // Time that was not played (a step, a pause, another speed) goes into the waveform only.
    speaker.skip(sim.takeSound());
    if (sim.bells) { speaker.bell(); sim.bells = 0; }
    if (view === 'sound') drawWave();
    if (view === 'memory') showExplorer();
    showInputs();
  }

  function toggleBreakpoint(addr: number): void {
    const line = current() ? sim.program?.lineAt.get(addr) : undefined;
    if (line !== undefined) {
      editor.dispatch({ selection: { anchor: editor.state.doc.line(line).from } });
      toggleBreakpointAtCursor(editor);
    } else {
      if (!romBreakpoints.delete(addr)) romBreakpoints.add(addr);
      show();
    }
  }
  $('mem-addr').addEventListener('input', show);

  // ---------------------------------------------------------------- start

  const shared = sharedProgram(location.hash);
  if (shared !== null) {
    fillPrograms('');
    setSource(shared.source);
    setBeam(shared.beam === 'scan');
    eis.checked = shared.eis;
    sim.configure({ eis: shared.eis });
    showStatus('A shared program: press Run. Save keeps a copy in this browser.');
  } else if (library.current !== null) {
    fillPrograms('');
    setSource(library.current);
    const p = PROGRAMS.find((x) => x.source.replace(/^\n/, '') === library.current);
    if (p) { example = p; fillPrograms(`example:${p.id}`); $('keys-hint').textContent = p.keys ?? (p.input ? `Run it, click the console and type, for example “${p.input}”.` : ''); }
    showStatus('Your program from last time: press Run.');
  } else {
    openExample(FIRST);
  }
  show();
}
