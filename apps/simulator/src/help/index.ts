/**
 * The simulator's help: the sections (sections.ts), the search and F1 lookup (model.ts),
 * the dialog (view.ts) and hover tooltips in the editor (tooltip.ts).
 */

import { HelpIndex } from './model';
import { SECTIONS } from './sections';

export { HelpIndex, inComment, parseInline, wordAt, type Block, type Entry, type SearchHit, type Section, type Span, type Topic } from './model';
export { SECTIONS } from './sections';

export const HELP = new HelpIndex(SECTIONS);
