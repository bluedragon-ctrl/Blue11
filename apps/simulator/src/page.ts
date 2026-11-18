/**
 * The simulator page: the editor, Run / Continue / Pause / Step, the screen on a canvas
 * with the keyboard, the console, the registers, disassembly, memory, stack, the listing,
 * the ROM, the examples and saved programs, sharing by URL, and the input log.
 *
 * The machine runs whole frames paced by animation frames. The speed setting (frames per
 * second of wall time) is the only use of wall-clock time, and it never reaches the
 * simulation (src/sim.ts), whose time is cycles.
 */

import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { frameToRgba, keyCode, octal, type AsmError, type Frame } from 'blue11';
import { blue11Asm, blue11Highlight } from 'blue11/codemirror';
import { addressNamer, disassemblyAround, inRom, lineHeat, memoryRows, parseAddress, registerText, stackRows } from './debug';
import { breakpointLines, debugExtensions, setErrors, setHeat, setPcLine, toggleBreakpointAtCursor } from './editor';
import { FIRST, PROGRAMS, type Program } from './programs';
import { romAssembly } from './rom';
import { parseRecording, record, Simulator, type InputEvent, type StepResult } from './sim';
import { Library, shareHash, sharedProgram } from './storage';
import { describeTrap } from './traps';

/** The speed slider's stops, in frames per second of wall time (60 is real time). */
export const SPEEDS = [1, 2, 5, 10, 20, 30, 60, 120, 240, 600];
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

  // ---------------------------------------------------------------- editor

  const editor = new EditorView({
    parent: $('editor'),
    state: EditorState.create({
      doc: '',
      extensions: [
        debugExtensions, lineNumbers(), history(),
        keymap.of([
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
  const fps = () => SPEEDS[Number(speed.value)] ?? 60;
  function showSpeed(): void {
    speedText.textContent = `${fps()} frames/s${fps() === 60 ? ' (real time)' : ''}`;
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
    while (owed >= 1 && running) {
      owed -= 1;
      const r = sim.runFrame(resumeNext);
      resumeNext = false;
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
      case 'asleep': showStatus(`WAIT at ${pc}, and no device has interrupts on: nothing can wake the CPU.`, 'error'); break;
      case 'double-fault': showStatus(`Double fault at ${pc}: a trap could not push onto the stack (is SP valid?). Run starts again.`, 'error'); break;
      case 'trap': showStatus(describeTrap(r.trap!, sim.cpu, (a) => sim.machine.read(a, false)), 'error'); break;
      default: break;
    }
  }

  function step(): void {
    if (running) return;
    if (!current() || !sim.canRun) {
      if (!load()) return;
      showStatus(`Loaded: stopped at the first instruction, ${octal(sim.cpu.r[7])}. Step again to run it.`);
      show();
      return;
    }
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
    const r = sim.runFrame(true);
    if (r.stop === 'frame') showStatus(`Frame ${octal(sim.display.frame.number)} done.`);
    else stopped(r);
    show();
  });
  buttons.restart.addEventListener('click', () => {
    pause();
    if (current()) sim.restart(); else if (!load()) return;
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

  type View = 'screen' | 'listing' | 'rom';
  let view: View = 'screen';
  function setView(v: View): void {
    view = v;
    for (const k of ['screen', 'listing', 'rom'] as const) {
      $(`view-${k}`).hidden = k !== v;
      $(`tab-${k}`).classList.toggle('active', k === v);
      $(`tab-${k}`).setAttribute('aria-selected', String(k === v));
    }
    show();
  }
  for (const k of ['screen', 'listing', 'rom'] as const) $(`tab-${k}`).addEventListener('click', () => setView(k));

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

  function drawScreen(): void {
    const f = sim.display.frame;
    if (f === shownFrame) return;
    shownFrame = f;
    if (canvas.width !== f.width) { canvas.width = f.width; canvas.height = f.height; }
    const img = ctx.createImageData(f.width, f.height);
    frameToRgba(f, img.data);
    ctx.putImageData(img, 0, 0);
  }

  function showInputs(): void {
    const all = sim.inputs;
    const el = $('inputs');
    el.textContent = all.length
      ? `${all.length} input${all.length === 1 ? '' : 's'} (cycle, what)\n` + all.slice(-200).map(inputText).join('\n')
      : 'Keys pressed on the screen and characters typed on the console are logged here with their cycle. Replay feeds them again.';
    el.scrollTop = el.scrollHeight;
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

    $('regs').textContent = registerText(cpu);
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
      : memoryRows(read, at, 8, 4).map((r) => `${octal(r.address)}  ${r.words.map((w) => octal(w)).join(' ')}`).join('\n');
    const base = prog ? (prog.origin >= 0o400 ? prog.origin : 0o1000) : 0o1000;
    const st = stackRows(read, cpu.r[6], base);
    $('stack').textContent = st.length
      ? st.map((r, i) => `${i ? '    ' : 'SP →'} ${octal(r.address)}  ${octal(r.value)}${nameOf(r.value) ? `  ${nameOf(r.value)}` : ''}`).join('\n')
      : `Empty: SP = ${octal(cpu.r[6])}; the stack grows down from ${octal(base)}.`;

    // the screen and its line
    drawScreen();
    const d = sim.display;
    const f = d.frame;
    $('screen-info').textContent = `mode ${f.width === 128 ? 1 : 0} (${f.width} × ${f.height})   frame ${octal(f.number)}   cycle ${sim.machine.cycles}   ${sim.beam === 'scan' ? 'real beam' : 'instant beam'}`;
    if (view !== 'screen') showListing(view);
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
