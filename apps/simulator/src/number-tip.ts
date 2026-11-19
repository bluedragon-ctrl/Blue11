/**
 * Numbers explain themselves in the editor: rest the mouse on a number (`177777`, `10.`,
 * `^B101`, `'A`, `"HI`, `-1`) or on a name of the program (a label, `NAME = expr`) and a
 * tooltip shows its value in octal, decimal, hex, binary and as bytes or a character. Names
 * the help describes (instructions, device registers, directives) keep the help's tooltip.
 */

import type { Extension } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';
import { octal } from 'blue11';
import { numberAt, numberParts } from './debug';
import { inComment, wordRange } from './help/model';
import { el } from './help/view';

export function numberTooltip(symbols: () => ReadonlyMap<string, number> | null, described: (word: string) => boolean): Extension {
  return hoverTooltip((view, pos, side) => {
    const line = view.state.doc.lineAt(pos);
    const col = pos - line.from;
    const at = side < 0 && col > 0 ? col - 1 : col;
    let head: string;
    let value: number | undefined;
    let error: string | undefined;
    let from: number;
    let to: number;
    const n = numberAt(line.text, at);
    if (n) {
      ({ from, to, value, error } = n);
      head = n.text;
    } else {
      const range = wordRange(line.text, at);
      if (!range || at < range.from || at >= range.to || inComment(line.text, at)) return null;
      const word = line.text.slice(range.from, range.to);
      if (described(word)) return null;
      const v = symbols()?.get(word.toUpperCase()) ?? symbols()?.get(word);
      if (v === undefined) return null;
      ({ from, to } = range);
      head = `${word} = ${octal(v)}`;
      value = v;
    }
    return {
      pos: line.from + from,
      end: line.from + to,
      above: true,
      create() {
        const dom = el('div', 'help-tip number-tip');
        dom.append(el('div', 'help-tip-head', head));
        if (error) dom.append(el('div', 'help-tip-text', error));
        else for (const p of numberParts(value!)) dom.append(el('div', 'number-tip-row', p));
        return { dom };
      },
    };
  }, { hoverTime: 450 });
}
