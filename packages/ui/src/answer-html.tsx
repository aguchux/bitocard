import { createElement, Fragment, type ReactNode } from "react";

/**
 * An AI assistant's answer, drawn from the few HTML tags the API lets through (Udozo's `answerHtml` in
 * `apps/udozo-api/src/classifieds/assistant/sanitise.ts`): paragraphs, line breaks, `strong`, `em`, lists and links to
 * `https://` addresses or this site's own paths. It is read tag by tag into React elements, never set as HTML, so
 * anything else (another tag, an attribute, a script) can only ever show as words. Older answers kept as plain text
 * show as paragraphs and line breaks. Style the tags from the container (`className`): Tailwind's reset removes list
 * bullets and spacing.
 */
const blockTags = new Set(["p", "ul", "ol", "li"]);
const inlineTags = new Set(["strong", "em", "a"]);
const anyTag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
const hrefAttr = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

type Node = { tag: string; href?: string; children: Array<Node | string> };

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return entities[name.toLowerCase()] ?? all;
  });
}

const safeHref = (href: string) => (/^https:\/\/[^\s"'<>]+$/i.test(href) || /^\/(?!\/)[^\s"'<>]*$/.test(href) ? href : null);

/** The answer as a tree of the allowed tags (`root` holds it all), unknown tags dropped and mismatched ones mended. */
export function parseAnswer(html: string): Node {
  const root: Node = { tag: "root", children: [] };
  const known = [...html.matchAll(anyTag)].some(match => {
    const tag = (match[2] ?? "").toLowerCase();
    return tag === "br" || blockTags.has(tag) || inlineTags.has(tag);
  });
  if (!known) {
    // Plain text: a blank line between paragraphs, a single line break kept.
    for (const part of html.split(/\n{2,}/)) {
      if (!part.trim()) continue;
      const paragraph: Node = { tag: "p", children: [] };
      part.trim().split("\n").forEach((line, index) => {
        if (index > 0) paragraph.children.push({ tag: "br", children: [] });
        paragraph.children.push(line);
      });
      root.children.push(paragraph);
    }
    return root;
  }
  const stack: Node[] = [root];
  const top = () => stack[stack.length - 1]!;
  const push = (text: string) => {
    const words = decodeEntities(text).replace(/\s+/g, " ");
    if (!words.trim() && (top() === root || top().tag === "ul" || top().tag === "ol")) return;
    top().children.push(words);
  };
  let at = 0;
  for (const match of html.matchAll(anyTag)) {
    const start = match.index ?? 0;
    if (start > at) push(html.slice(at, start));
    at = start + match[0].length;
    const tag = (match[2] ?? "").toLowerCase();
    if (tag === "br") {
      top().children.push({ tag: "br", children: [] });
      continue;
    }
    if (!blockTags.has(tag) && !inlineTags.has(tag)) continue;
    if (match[1] === "/") {
      const index = stack.map(node => node.tag).lastIndexOf(tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const attr = tag === "a" ? hrefAttr.exec(match[3] ?? "") : null;
    const href = attr ? safeHref(decodeEntities(attr[1] ?? attr[2] ?? attr[3] ?? "").trim()) : null;
    const node: Node = href ? { tag, href, children: [] } : { tag, children: [] };
    top().children.push(node);
    stack.push(node);
  }
  if (at < html.length) push(html.slice(at));
  return root;
}

function render(node: Node | string, key: number): ReactNode {
  if (typeof node === "string") return node;
  const children = node.children.map(render);
  if (node.tag === "br") return createElement("br", { key });
  if (node.tag === "a") return node.href ? createElement("a", { key, href: node.href }, ...children) : createElement(Fragment, { key }, ...children);
  return createElement(node.tag, { key }, ...children);
}

/** The answer's words without their tags, for previews and screen readers' summaries. */
export function answerPlainText(html: string) {
  const text = (node: Node | string): string => {
    if (typeof node === "string") return node;
    const inner = node.children.map(text).join("");
    if (node.tag === "br") return "\n";
    if (node.tag === "li") return `• ${inner.trim()}\n`;
    if (node.tag === "p" || node.tag === "ul" || node.tag === "ol") return `${inner.trim()}\n\n`;
    return inner;
  };
  return text(parseAnswer(html)).replace(/\n{3,}/g, "\n\n").trim();
}

export function AnswerHtml({ html, className }: { html: string; className?: string }) {
  return createElement("div", { className }, ...parseAnswer(html).children.map(render));
}
