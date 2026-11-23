import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Session, type ToolResult } from '../src/session';
import { SPECS, specSections } from '../src/spec';

const textOf = (r: ToolResult) => r.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n');
const file = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

describe('specSections', () => {
  it('splits on ## and ### headings, not on # inside code blocks', () => {
    const md = '# Title\n\nintro\n\n## 1. One\n\na\n\n```\n## not a heading\n```\n\n### 1.1 Sub\n\nb\n\n## 2. Two\n\nc\n';
    const s = specSections(md);
    expect(s.map((x) => [x.level, x.number, x.title])).toEqual([[2, '1', 'One'], [3, '1.1', 'Sub'], [2, '2', 'Two']]);
    expect(s[0].text).toContain('## not a heading'); // a ## section keeps its ### sections
    expect(s[0].text).toContain('### 1.1 Sub');
    expect(s[0].text).not.toContain('## 2. Two');
    expect(s[1].text).not.toContain('## 2. Two');
  });
});

describe('the spec tool', () => {
  it('lists the topics with their sections and links', () => {
    const t = textOf(new Session().spec({}));
    for (const d of SPECS) {
      expect(t).toContain(`\`${d.id}\``);
      expect(t).toContain(d.url);
    }
    expect(t).toContain('4. Registers'); // the display's sections
  });

  it('serves every document whole, as it is in the repository', () => {
    const s = new Session();
    for (const d of SPECS) {
      const r = s.spec({ topic: d.id });
      expect(r.isError, d.id).toBeUndefined();
      const t = textOf(r);
      expect(t).toContain(file(d.path).split('\n').find((l) => l.startsWith('# '))!);
      expect(t.length).toBeGreaterThan(file(d.path).length * 0.95);
    }
  });

  it('serves every section, by number or by words of its heading', () => {
    const s = new Session();
    for (const d of SPECS) {
      for (const sec of specSections(file(d.path))) {
        const r = s.spec({ topic: d.id, section: sec.number ?? sec.title });
        expect(r.isError, `${d.id} ${sec.title}`).toBeUndefined();
        expect(textOf(r)).toContain(sec.title);
      }
    }
    expect(textOf(s.spec({ topic: 'display', section: '5.1' }))).toContain('The scanning beam');
    expect(textOf(s.spec({ topic: 'machine', section: 'traps' }))).toMatch(/^## 6\. Traps and interrupts/);
    expect(textOf(s.spec({ topic: 'library', section: 'assembler compatibility' }))).toContain('### Assembler compatibility');
  });

  it('turns links between the documents into topics', () => {
    const t = textOf(new Session().spec({ topic: 'display' }));
    expect(t).not.toMatch(/\]\(BLUE11_\w+\.md\)/);
    expect(t).toContain('(spec topic `keyboard`)');
  });

  it('searches every document', () => {
    const t = textOf(new Session().spec({ query: 'DSPVEC' }));
    expect(t).toContain('`display`');
    expect(t).toMatch(/DSPVEC/);
    expect(new Session().spec({ query: 'zzzzqqq' }).isError).toBe(true);
  });

  it('refuses unknown topics and sections, and says what there is', () => {
    const s = new Session();
    const r = s.spec({ topic: 'nope' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('machine');
    const q = s.spec({ topic: 'sound', section: 'nowhere at all' });
    expect(q.isError).toBe(true);
    expect(textOf(q)).toContain('4. Registers');
    expect(s.spec({ section: '4' }).isError).toBe(true);
  });
});
