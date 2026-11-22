/**
 * Rich text for support messages: the few HTML tags allowed, read into a tree, written back out clean, and as plain
 * text. Nothing here sets HTML: the API stores what `cleanRichText` writes, and the apps draw the tree as elements.
 *
 * This file is kept byte for byte the same in `packages/ui/src/rich-text-core.ts` (the apps) and
 * `apps/api/src/support/rich-text-core.ts` (the API); a test in each fails when they differ. No imports, on purpose.
 *
 * Allowed: paragraphs, line breaks, bold, italic, underline, strikethrough, bulleted and numbered lists, quotes,
 * code (inline and blocks) and links to https:// or mailto: addresses. What editors write instead (`b`, `i`, `div`,
 * `strike`) is read as the same thing; any other tag is dropped and its words kept; attributes never survive but a
 * link's address.
 */

export type RichNode = { tag: string; href?: string; children: Array<RichNode | string> };

const aliases: Record<string, string> = { b: "strong", i: "em", strike: "s", del: "s", div: "p", h1: "p", h2: "p", h3: "p", h4: "p", h5: "p", h6: "p", section: "p", article: "p" };
const blockTags = new Set(["p", "ul", "ol", "li", "blockquote", "pre"]);
const inlineTags = new Set(["strong", "em", "u", "s", "code", "a"]);
const anyTag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
const hrefAttr = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The most a message may hold, as HTML. */
export const richTextMaxLength = 20_000;

export function decodeRichEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return entities[name.toLowerCase()] ?? all;
  });
}

/** Only https:// and mailto: links; anything else (javascript:, data:, relative paths) is dropped. */
export function safeRichHref(href: string) {
  const value = href.trim();
  if (/^https:\/\/[^\s"'<>]+$/i.test(value)) return value;
  if (/^mailto:[^\s"'<>@]+@[^\s"'<>]+$/i.test(value)) return value;
  return null;
}

const canonical = (raw: string) => {
  const tag = raw.toLowerCase();
  return aliases[tag] ?? tag;
};

/** The message as a tree of the allowed tags (`root` holds it all), other tags dropped and mismatched ones mended. */
export function parseRichText(input: string): RichNode {
  // What pasted pages carry and nobody wrote: scripts, styles, comments and Word's conditional blocks, words and all.
  const html = input.replace(/<(script|style|template|head)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[[\s\S]*?\]>/g, "");
  const root: RichNode = { tag: "root", children: [] };
  const known = [...html.matchAll(anyTag)].some(match => {
    const tag = canonical(match[2] ?? "");
    return tag === "br" || blockTags.has(tag) || inlineTags.has(tag);
  });
  if (!known) {
    // Plain text (older messages, API clients): a blank line between paragraphs, a single line break kept.
    for (const part of html.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
      if (!part.trim()) continue;
      const paragraph: RichNode = { tag: "p", children: [] };
      part.trim().split("\n").forEach((line, index) => {
        if (index > 0) paragraph.children.push({ tag: "br", children: [] });
        paragraph.children.push(line);
      });
      root.children.push(paragraph);
    }
    return root;
  }
  const stack: RichNode[] = [root];
  const top = () => stack[stack.length - 1]!;
  const inPre = () => stack.some(node => node.tag === "pre");
  const push = (text: string) => {
    const decoded = decodeRichEntities(text);
    const words = inPre() ? decoded : decoded.replace(/\s+/g, " ");
    if (!words.trim() && ["root", "ul", "ol", "blockquote"].includes(top().tag)) return;
    if (words) top().children.push(words);
  };
  let at = 0;
  for (const match of html.matchAll(anyTag)) {
    const start = match.index ?? 0;
    if (start > at) push(html.slice(at, start));
    at = start + match[0].length;
    const tag = canonical(match[2] ?? "");
    if (tag === "br") {
      if (match[1] !== "/") top().children.push({ tag: "br", children: [] });
      continue;
    }
    if (!blockTags.has(tag) && !inlineTags.has(tag)) continue;
    if (match[1] === "/") {
      const index = stack.map(node => (node.tag === "a-dropped" ? "a" : node.tag)).lastIndexOf(tag);
      if (index > 0) stack.length = index;
      continue;
    }
    // A block never sits inside an inline tag or a paragraph: those close first.
    if (blockTags.has(tag) && tag !== "li") {
      while (stack.length > 1 && (inlineTags.has(top().tag) || top().tag === "p")) stack.pop();
    }
    const attr = tag === "a" ? hrefAttr.exec(match[3] ?? "") : null;
    const href = attr ? safeRichHref(decodeRichEntities(attr[1] ?? attr[2] ?? attr[3] ?? "")) : null;
    if (tag === "a" && !href) {
      // A link without a safe address keeps its words, not the link.
      const dropped: RichNode = { tag: "a-dropped", children: [] };
      top().children.push(dropped);
      stack.push(dropped);
      continue;
    }
    const node: RichNode = href ? { tag, href, children: [] } : { tag, children: [] };
    top().children.push(node);
    stack.push(node);
  }
  if (at < html.length) push(html.slice(at));
  return prune(root);
}

/** Empty elements go (an empty bold, an empty paragraph), dropped links become their words. */
function prune(node: RichNode): RichNode {
  const children: Array<RichNode | string> = [];
  for (const child of node.children) {
    if (typeof child === "string") {
      children.push(child);
      continue;
    }
    const pruned = prune(child);
    if (pruned.tag === "a-dropped") {
      children.push(...pruned.children);
      continue;
    }
    if (pruned.tag === "br") {
      children.push(pruned);
      continue;
    }
    const hasWords = pruned.children.some(item => (typeof item === "string" ? item.trim() !== "" : true));
    if (hasWords) children.push(pruned);
  }
  return { ...node, children };
}

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string) => escapeText(text).replace(/"/g, "&quot;");

function write(node: RichNode | string): string {
  if (typeof node === "string") return escapeText(node);
  if (node.tag === "br") return "<br>";
  const inner = node.children.map(write).join("");
  if (node.tag === "root") return inner;
  if (node.tag === "a") return `<a href="${escapeAttr(node.href ?? "")}">${inner}</a>`;
  return `<${node.tag}>${inner}</${node.tag}>`;
}

/** Loose words at the top level go into paragraphs, so every message is a list of blocks. */
function blocks(root: RichNode): RichNode {
  const children: RichNode[] = [];
  let loose: RichNode | null = null;
  for (const child of root.children) {
    if (typeof child !== "string" && blockTags.has(child.tag)) {
      loose = null;
      children.push(child);
      continue;
    }
    if (!loose) {
      loose = { tag: "p", children: [] };
      children.push(loose);
    }
    loose.children.push(child);
  }
  return { tag: "root", children: children.filter(child => child.children.some(item => (typeof item === "string" ? item.trim() : true))) };
}

/** The message as the clean HTML kept: only the allowed tags, every one closed, text escaped. */
export function cleanRichText(html: string) {
  return write(blocks(parseRichText(html)));
}

/** The message's words without their tags: for the assistant, notices, previews and search. */
export function richTextToPlain(html: string) {
  const text = (node: RichNode | string, list?: { ordered: boolean; index: number }): string => {
    if (typeof node === "string") return node;
    if (node.tag === "br") return "\n";
    if (node.tag === "ul" || node.tag === "ol") {
      const state = { ordered: node.tag === "ol", index: 0 };
      return `${node.children.map(child => text(child, state)).join("").trimEnd()}\n\n`;
    }
    const inner = node.children.map(child => text(child)).join("");
    if (node.tag === "li") {
      if (list) list.index += 1;
      return `${list?.ordered ? `${list.index}.` : "•"} ${inner.trim()}\n`;
    }
    if (node.tag === "blockquote") return `${inner.trim().split("\n").map(line => `> ${line}`).join("\n")}\n\n`;
    if (node.tag === "p" || node.tag === "pre") return `${inner.trim()}\n\n`;
    if (node.tag === "a" && node.href && !inner.includes(node.href.replace(/^mailto:/, ""))) return `${inner} (${node.href.replace(/^mailto:/, "")})`;
    return inner;
  };
  return text(blocks(parseRichText(html))).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
