/**
 * An assistant's answer (Anjio's), read from the few HTML tags the API lets through (`answerHtml` in
 * apps/udozo-api/src/classifieds/assistant/sanitise.ts): paragraphs, line breaks, `strong`, `em`, lists and links to
 * `https://` addresses or udozo.com's own paths. It is read tag by tag into blocks the app draws as React Native text,
 * never shown in a web view, so anything else (another tag, an attribute, a script) can only ever show as words. Older
 * answers kept as plain text become paragraphs and line breaks. The same rules as udozo.com's `parseAnswer`
 * (packages/ui/src/answer-html.tsx); kept free of React Native so it runs under `node --test`.
 */

/** A run of words with its marks; `br` is a line break. */
export type AnswerRun = { text: string; bold?: true; italic?: true; href?: string } | { br: true };
/** A paragraph, or a list whose items are each a line of runs. */
export type AnswerBlock = { kind: 'p'; runs: AnswerRun[] } | { kind: 'list'; ordered: boolean; items: AnswerRun[][] };

const blockTags = new Set(['p', 'ul', 'ol', 'li']);
const inlineTags = new Set(['strong', 'b', 'em', 'i', 'a']);
const anyTag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
const hrefAttr = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return entities[name.toLowerCase()] ?? all;
  });
}

/** Only `https://` addresses and the site's own paths are links; anything else is just words. */
const safeHref = (href: string) => (/^https:\/\/[^\s"'<>]+$/i.test(href) || /^\/(?!\/)[^\s"'<>]*$/.test(href) ? href : null);

type Marks = { bold?: true; italic?: true; href?: string };

/** The answer as blocks to draw: unknown tags dropped, unclosed ones closed, empty paragraphs left out. */
export function answerBlocks(html: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  const known = [...html.matchAll(anyTag)].some(match => {
    const tag = (match[2] ?? '').toLowerCase();
    return tag === 'br' || blockTags.has(tag) || inlineTags.has(tag);
  });
  if (!known) {
    // Plain text: a blank line between paragraphs, a single line break kept.
    for (const part of decodeEntities(html).split(/\n{2,}/)) {
      if (!part.trim()) continue;
      const runs: AnswerRun[] = [];
      part.trim().split('\n').forEach((line, index) => {
        if (index > 0) runs.push({ br: true });
        runs.push({ text: line });
      });
      blocks.push({ kind: 'p', runs });
    }
    return blocks;
  }

  let paragraph: AnswerRun[] | null = null;
  let list: Extract<AnswerBlock, { kind: 'list' }> | null = null;
  let item: AnswerRun[] | null = null;
  const marks: { tag: string; marks: Marks }[] = [];
  const current = (): Marks => Object.assign({}, ...marks.map(entry => entry.marks));

  const endParagraph = () => {
    if (paragraph && paragraph.some(run => 'br' in run || run.text.trim())) blocks.push({ kind: 'p', runs: trimRuns(paragraph) });
    paragraph = null;
  };
  const endItem = () => {
    if (list && item && item.some(run => 'br' in run || run.text.trim())) list.items.push(trimRuns(item));
    item = null;
  };
  const endList = () => {
    endItem();
    if (list?.items.length) blocks.push(list);
    list = null;
  };
  /** Where words go now: the open list item, else a paragraph (made when needed). */
  const target = (): AnswerRun[] => {
    if (list) return (item ??= []);
    return (paragraph ??= []);
  };
  const push = (raw: string) => {
    const text = decodeEntities(raw).replace(/\s+/g, ' ');
    if (!text.trim() && !(paragraph || item)) return;
    target().push({ text, ...current() });
  };

  let at = 0;
  for (const match of html.matchAll(anyTag)) {
    const start = match.index ?? 0;
    if (start > at) push(html.slice(at, start));
    at = start + match[0].length;
    const closing = match[1] === '/';
    const tag = (match[2] ?? '').toLowerCase();
    if (tag === 'br') {
      target().push({ br: true });
      continue;
    }
    if (tag === 'p') {
      if (list) continue;
      endParagraph();
      if (!closing) paragraph = [];
    } else if (tag === 'ul' || tag === 'ol') {
      endParagraph();
      if (closing) endList();
      else {
        endList();
        list = { kind: 'list', ordered: tag === 'ol', items: [] };
      }
    } else if (tag === 'li') {
      if (!list) {
        endParagraph();
        list = { kind: 'list', ordered: false, items: [] };
      }
      endItem();
      if (!closing) item = [];
    } else if (inlineTags.has(tag)) {
      const name = tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag;
      if (closing) {
        const index = marks.map(entry => entry.tag).lastIndexOf(name);
        if (index >= 0) marks.length = index;
        continue;
      }
      const attr = name === 'a' ? hrefAttr.exec(match[3] ?? '') : null;
      const href = attr ? safeHref(decodeEntities(attr[1] ?? attr[2] ?? attr[3] ?? '').trim()) : null;
      marks.push({ tag: name, marks: name === 'strong' ? { bold: true } : name === 'em' ? { italic: true } : href ? { href } : {} });
    }
  }
  if (at < html.length) push(html.slice(at));
  endParagraph();
  endList();
  return blocks;
}

const sameMarks = (a: Marks, b: Marks) => a.bold === b.bold && a.italic === b.italic && a.href === b.href;

/** Neighbouring runs with the same marks are joined, and spaces at a block's start and end dropped (as a browser does). */
function trimRuns(runs: AnswerRun[]) {
  const out: AnswerRun[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && 'text' in last && 'text' in run && sameMarks(last, run)) last.text += run.text;
    else out.push({ ...run });
  }
  const first = out.find((run): run is Extract<AnswerRun, { text: string }> => 'text' in run);
  const last = [...out].reverse().find((run): run is Extract<AnswerRun, { text: string }> => 'text' in run);
  if (first) first.text = first.text.replace(/^\s+/, '');
  if (last) last.text = last.text.replace(/\s+$/, '');
  return out.filter(run => 'br' in run || run.text);
}

/** The answer's words without their tags (a screen reader's summary, a copied answer). */
export function answerText(html: string) {
  const line = (runs: AnswerRun[]) => runs.map(run => ('br' in run ? '\n' : run.text)).join('');
  return answerBlocks(html)
    .map(block => (block.kind === 'p' ? line(block.runs) : block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '•'} ${line(item)}`).join('\n')))
    .join('\n\n');
}
