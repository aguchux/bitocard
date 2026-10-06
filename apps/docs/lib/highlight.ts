import "server-only";
import { createHighlighter, type Highlighter } from "shiki";
import { Marked, type Tokens } from "marked";

/** Code blocks are highlighted at build time, so pages ship no highlighting script. */
const theme = "github-dark-default";
const langs = ["bash", "shell", "javascript", "typescript", "python", "php", "json", "http", "text"] as const;
const aliases: Record<string, (typeof langs)[number]> = { sh: "bash", js: "javascript", ts: "typescript", py: "python", node: "javascript", curl: "bash", "": "text" };

let highlighter: Promise<Highlighter> | null = null;
const shared = () => (highlighter ??= createHighlighter({ themes: [theme], langs: [...langs] }));

export async function highlight(code: string, lang = "text") {
  const known = (langs as readonly string[]).includes(lang) ? lang : undefined;
  const name = aliases[lang] ?? known ?? "text";
  return (await shared()).codeToHtml(code, { lang: name, theme });
}

export const json = (value: unknown) => highlight(JSON.stringify(value, null, 2), "json");

export type Heading = { depth: number; text: string; id: string };

const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

/**
 * Markdown guides to HTML: front matter read off the top, headings given ids (for links and the page contents),
 * code highlighted, external links opened in a new tab.
 */
export async function renderMarkdown(source: string) {
  const front: Record<string, string> = {};
  const body = source.replace(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/, (_match, block: string) => {
    for (const line of block.split(/\r?\n/)) {
      const [key, ...rest] = line.split(":");
      if (key && rest.length) front[key.trim()] = rest.join(":").trim();
    }
    return "";
  });
  const headings: Heading[] = [];
  const blocks: Array<{ code: string; lang: string }> = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const text = this.parser.parseInline(tokens);
        const plain = tokens.map(token => ("text" in token ? token.text : token.raw)).join("");
        const id = headingId(plain);
        if (depth > 1) headings.push({ depth, text: plain.replace(/`/g, ""), id });
        return `<h${depth} id="${id}"><a href="#${id}" class="heading-anchor">${text}</a></h${depth}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        blocks.push({ code: text, lang: (lang ?? "").split(/\s/)[0] });
        return `<!--code:${blocks.length - 1}-->`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href);
        return `<a href="${href}"${title ? ` title="${title}"` : ""}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
      },
    },
  });
  let html = await marked.parse(body);
  const highlighted = await Promise.all(blocks.map(block => highlight(block.code, block.lang)));
  html = html.replace(/<!--code:(\d+)-->/g, (_match, index: string) => `<div class="code-block">${highlighted[Number(index)]}</div>`);
  return { html, headings, title: front.title ?? "", description: front.description ?? "" };
}
