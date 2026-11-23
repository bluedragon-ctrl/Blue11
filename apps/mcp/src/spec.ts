/**
 * The specification, for agents that need more than the students' help: the design documents
 * (docs/BLUE11_*.md) and the library's README (the assembler's compatibility with MACRO-11,
 * the devices' exact behaviour). They are bundled into the server, so they always describe
 * the machine this server runs, not whatever is on GitHub today.
 */

import MACHINE from '../../../docs/BLUE11_MACHINE.md?raw';
import DISPLAY from '../../../docs/BLUE11_DISPLAY.md?raw';
import KEYBOARD from '../../../docs/BLUE11_KEYBOARD.md?raw';
import SOUND from '../../../docs/BLUE11_SOUND.md?raw';
import LIBRARY from '../../../packages/blue11/README.md?raw';

const REPO = 'https://github.com/bluedragon-ctrl/Blue11/blob/main/';

export interface Spec {
  id: string;
  /** Path in the repository. */
  path: string;
  about: string;
  url: string;
  text: string;
}

const spec = (id: string, path: string, about: string, text: string): Spec => ({ id, path, about, url: REPO + path, text });

export const SPECS: Spec[] = [
  spec('machine', 'docs/BLUE11_MACHINE.md', 'the CPU and the assembly language: lines, directives, octal, the addressing modes, encoding, cycles, flags and branches, traps and interrupts, MUL/DIV and EIS, where it departs from the original', MACHINE),
  spec('display', 'docs/BLUE11_DISPLAY.md', 'the screen: modes 0 and 1, the registers, palettes, frames and the scanning beam, interrupts, the ROM font and DRAWCH', DISPLAY),
  spec('keyboard', 'docs/BLUE11_KEYBOARD.md', 'the keyboard: key codes, the key map (which keys are down), the event queue, interrupts', KEYBOARD),
  spec('sound', 'docs/BLUE11_SOUND.md', 'the one-bit speaker: pitch in cycles, the registers, the tone generator', SOUND),
  spec('library', 'packages/blue11/README.md', 'the npm library blue11: the assembler and its compatibility with MACRO-11 (section "Assembler compatibility"), the CPU and devices from the host side, pitfalls', LIBRARY),
];

export interface SpecSection {
  level: 2 | 3;
  /** "4", "5.1"; undefined for an unnumbered heading. */
  number?: string;
  title: string;
  /** The heading and its text, with its ### sections for a ## one. */
  text: string;
}

/** The ## and ### sections of a Markdown document (headings inside ``` blocks are text). */
export function specSections(md: string): SpecSection[] {
  const lines = md.split('\n');
  const heads: Array<{ line: number; level: 2 | 3; number?: string; title: string }> = [];
  let fenced = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fenced = !fenced;
    const m = fenced ? null : /^(#{2,3}) +(?:(\d+(?:\.\d+)*)\.? +)?(.*?)\s*$/.exec(l);
    if (m) heads.push({ line: i, level: m[1].length as 2 | 3, number: m[2], title: m[3] });
  });
  return heads.map((h, k) => {
    const end = heads.slice(k + 1).find((n) => n.level <= h.level)?.line ?? lines.length;
    return { level: h.level, number: h.number, title: h.title, text: lines.slice(h.line, end).join('\n').trimEnd() };
  });
}

/** Links to the other documents become topics; other relative links, GitHub URLs. */
export function resolveLinks(s: Spec, md: string): string {
  const dir = s.path.slice(0, s.path.lastIndexOf('/') + 1);
  return md.replace(/\[([^\]]*)\]\(((?!https?:|#|mailto:)[^)\s]+)\)/g, (_, label: string, target: string) => {
    const [file, anchor] = target.split('#');
    const parts: string[] = [];
    for (const p of (dir + file).split('/')) {
      if (p === '..') parts.pop();
      else if (p !== '.' && p) parts.push(p);
    }
    const path = parts.join('/');
    const other = SPECS.find((x) => x.path === path);
    return other ? `${label} (spec topic \`${other.id}\`)` : `[${label}](${REPO}${path}${anchor ? `#${anchor}` : ''})`;
  });
}

const contents = (s: Spec) => specSections(s.text)
  .map((x) => `${x.level === 3 ? '  ' : ''}- ${x.number ? `${x.number}${x.number.includes('.') ? '' : '.'} ` : ''}${x.title}`).join('\n');

export function specTool(args: { topic?: string; section?: string; query?: string }): { ok: boolean; text: string } {
  if (args.query) return specSearch(args.query);
  if (!args.topic) {
    if (args.section) return { ok: false, text: 'Give the topic the section is in.' };
    return {
      ok: true,
      text: 'The specification of Blue-11, as built into this server (the students\' help is the help tool). '
        + 'spec { topic } gives a whole document, spec { topic, section } one section (a number such as "5.1", or words of its heading), spec { query } searches them all.\n\n'
        + SPECS.map((s) => `## \`${s.id}\`: ${s.about}\n${s.url}\n\n${contents(s)}`).join('\n\n'),
    };
  }
  const s = SPECS.find((x) => x.id === args.topic!.toLowerCase());
  if (!s) return { ok: false, text: `No topic ${args.topic}. The topics: ${SPECS.map((x) => x.id).join(', ')}.` };
  if (!args.section) return { ok: true, text: `${resolveLinks(s, s.text)}\n\n(${s.url})` };
  const want = args.section.trim().toLowerCase().replace(/\.$/, '');
  const secs = specSections(s.text);
  const sec = secs.find((x) => x.number === want)
    ?? secs.find((x) => x.title.toLowerCase() === want)
    ?? secs.find((x) => x.title.toLowerCase().startsWith(want))
    ?? secs.find((x) => want.split(/\s+/).every((w) => x.title.toLowerCase().includes(w)));
  if (!sec) return { ok: false, text: `No section "${args.section}" in ${s.id}. Its sections:\n${contents(s)}` };
  return { ok: true, text: resolveLinks(s, sec.text) };
}

function specSearch(query: string): { ok: boolean; text: string } {
  const q = query.toLowerCase();
  const out: string[] = [];
  for (const s of SPECS) {
    const secs = specSections(s.text);
    // The innermost section of each matching line, once.
    const hits = new Map<SpecSection, string[]>();
    for (const sec of secs) {
      const all = sec.text.split('\n');
      const sub = sec.level === 2 ? all.findIndex((l, i) => i > 0 && l.startsWith('### ')) : -1;
      const own = sub < 0 ? all : all.slice(0, sub); // a ### section's lines are its own hits
      const lines = own.filter((l) => l.toLowerCase().includes(q));
      if (lines.length) hits.set(sec, lines);
    }
    for (const [sec, lines] of hits) {
      const where = sec.number ?? sec.title;
      const sample = lines.slice(0, 2).map((l) => `    ${l.trim().slice(0, 160)}`).join('\n');
      out.push(`- \`${s.id}\` section "${where}"${sec.number ? ` (${sec.title})` : ''}: ${lines.length} line${lines.length > 1 ? 's' : ''}\n${sample}`);
    }
  }
  if (!out.length) return { ok: false, text: `Nothing in the specification matches "${query}".` };
  const shown = out.slice(0, 25);
  return { ok: true, text: `"${query}" in the specification (spec { topic, section } to read one):\n${shown.join('\n')}${out.length > shown.length ? `\n…and ${out.length - shown.length} more sections` : ''}` };
}
