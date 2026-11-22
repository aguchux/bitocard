"use client";

import { createElement, Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cleanRichText, parseRichText, richTextToPlain, safeRichHref, type RichNode } from "./rich-text-core";

export { cleanRichText, richTextToPlain } from "./rich-text-core";

/**
 * Support messages as rich text: `RichText` draws a message, `RichTextEditor` writes one, `FoldedThread` shows a long
 * conversation with its older messages folded away, and `ClampedBody` cuts a long message short until asked.
 * Messages are drawn from the tree `parseRichText` reads, element by element, never set as HTML.
 */

/** How messages look inside: lists, quotes, code and links styled from the container (Tailwind's reset clears them). */
export const richTextClass =
  "break-words [overflow-wrap:anywhere] [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-current/25 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:opacity-85 [&_code]:rounded [&_code]:bg-black/[0.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/[0.06] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-2";

function draw(node: RichNode | string, key: number): ReactNode {
  if (typeof node === "string") return node;
  const children = node.children.map(draw);
  if (node.tag === "br") return createElement("br", { key });
  if (node.tag === "a") return node.href ? createElement("a", { key, href: node.href, target: "_blank", rel: "noopener noreferrer nofollow ugc" }, ...children) : createElement(Fragment, { key }, ...children);
  return createElement(node.tag, { key }, ...children);
}

/** A message: its rich text when it has some, else its plain words as paragraphs. */
export function RichText({ html, text, className }: { html?: string | null; text?: string | null; className?: string }) {
  return createElement("div", { className: [richTextClass, className].filter(Boolean).join(" ") }, ...parseRichText(html || text || "").children.map(draw));
}

/** A message's first words on one line, for a folded preview. */
export function snippetOf(html: string | null | undefined, text: string | null | undefined, length = 140) {
  const words = (html ? richTextToPlain(html) : (text ?? "")).replace(/\s+/g, " ").trim();
  return words.length > length ? `${words.slice(0, length - 1).trimEnd()}…` : words;
}

// -- Writing -------------------------------------------------------------------------------------------------------

export type RichValue = { html: string; text: string };

type Command = "bold" | "italic" | "underline" | "strikeThrough" | "insertUnorderedList" | "insertOrderedList";

const icons: Record<string, ReactNode> = {
  bold: <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zm0 7h7a3.5 3.5 0 0 1 0 7H7z" />,
  italic: <path d="M14 5h-4m4 14h-4m3-14-2 14" />,
  underline: <path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" />,
  strikeThrough: <path d="M5 12h14M16 7.5C15.4 5.9 13.9 5 12 5c-2.5 0-4 1.3-4 3 0 3.8 8 2.2 8 6.5 0 1.9-1.8 3.5-4.2 3.5-2.2 0-3.8-1-4.4-2.7" />,
  insertUnorderedList: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  insertOrderedList: <path d="M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5c.6-.6 2.8-.8 2.8.6 0 1.1-2.8 1.9-2.8 3.4h3" />,
  quote: <path d="M7 7h4v4c0 3-1.5 5-4 6m8-10h4v4c0 3-1.5 5-4 6" />,
  code: <path d="m8 8-4 4 4 4m8-8 4 4-4 4m-5 2 2-12" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1m-1.9 7.4a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 7 22.4l1-1" />,
  clear: <path d="M6 5h12M12 5 9 19m-3 0h6m4-5 5 5m0-5-5 5" />,
};

const tools: Array<{ key: string; label: string; shortcut?: string; command?: Command }> = [
  { key: "bold", label: "Bold", shortcut: "Ctrl+B", command: "bold" },
  { key: "italic", label: "Italic", shortcut: "Ctrl+I", command: "italic" },
  { key: "underline", label: "Underline", shortcut: "Ctrl+U", command: "underline" },
  { key: "strikeThrough", label: "Strikethrough", command: "strikeThrough" },
  { key: "insertUnorderedList", label: "Bulleted list", command: "insertUnorderedList" },
  { key: "insertOrderedList", label: "Numbered list", command: "insertOrderedList" },
  { key: "quote", label: "Quote" },
  { key: "code", label: "Code" },
  { key: "link", label: "Link", shortcut: "Ctrl+K" },
  { key: "clear", label: "Clear formatting" },
];

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The editor's commands go through the browser's own editing (`execCommand`), still the one every browser supports. */
const exec = (command: string, value?: string) => {
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
};

/**
 * A rich text box: bold, italic, underline, strikethrough, lists, quotes, code and links, from its toolbar or the usual
 * shortcuts. What it holds is cleaned to the allowed tags on every change, and pasted pages arrive cleaned too. With
 * `name` it carries the message in a form (`name` the plain words, `name_html` the rich text); `onChange` gives both.
 * Change `resetKey` to empty it (after a message is sent).
 */
export function RichTextEditor({
  id,
  label,
  name,
  initialHtml = "",
  placeholder,
  disabled,
  invalid,
  maxLength = 5000,
  resetKey,
  onChange,
  className,
}: {
  id?: string;
  label: string;
  name?: string;
  initialHtml?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  maxLength?: number;
  resetKey?: unknown;
  onChange?: (value: RichValue) => void;
  className?: string;
}) {
  const generated = useId();
  const editorId = id ?? `${generated}-editor`;
  const box = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const [value, setValue] = useState<RichValue>(() => {
    const html = cleanRichText(initialHtml);
    return { html, text: richTextToPlain(html) };
  });
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [linking, setLinking] = useState<{ href: string; error: string | null } | null>(null);
  const changed = useRef(onChange);
  useLayoutEffect(() => {
    changed.current = onChange;
  });

  // A new resetKey starts again from the initial message (empty after a message is sent).
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    const html = cleanRichText(initialHtml);
    setValue({ html, text: richTextToPlain(html) });
  }
  // The box itself is the browser's to edit: it is filled once, and again on a new resetKey.
  useLayoutEffect(() => {
    if (box.current) box.current.innerHTML = cleanRichText(initialHtml);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new resetKey starts again
  }, [resetKey]);

  const read = useCallback(() => {
    const html = cleanRichText(box.current?.innerHTML ?? "");
    const next = { html, text: richTextToPlain(html) };
    setValue(next);
    changed.current?.(next);
  }, []);

  const refreshActive = useCallback(() => {
    const selection = document.getSelection();
    if (!box.current || !selection?.anchorNode || !box.current.contains(selection.anchorNode)) return;
    const within = (tag: string) => {
      let node: Node | null = selection.anchorNode;
      while (node && node !== box.current) {
        if (node.nodeName.toLowerCase() === tag) return true;
        node = node.parentNode;
      }
      return false;
    };
    const state = (command: string) => {
      try {
        return document.queryCommandState(command);
      } catch {
        return false;
      }
    };
    setActive({
      bold: state("bold"),
      italic: state("italic"),
      underline: state("underline"),
      strikeThrough: state("strikeThrough"),
      insertUnorderedList: within("ul"),
      insertOrderedList: within("ol"),
      quote: within("blockquote"),
      code: within("code"),
      link: within("a"),
    });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", refreshActive);
    return () => document.removeEventListener("selectionchange", refreshActive);
  }, [refreshActive]);

  const keepSelection = () => {
    const selection = document.getSelection();
    if (selection?.rangeCount && box.current?.contains(selection.anchorNode)) saved.current = selection.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    box.current?.focus();
    const selection = document.getSelection();
    if (saved.current && selection) {
      selection.removeAllRanges();
      selection.addRange(saved.current);
    }
  };

  const apply = (key: string) => {
    if (disabled) return;
    box.current?.focus();
    exec("defaultParagraphSeparator", "p");
    const tool = tools.find(item => item.key === key);
    if (tool?.command) exec(tool.command);
    else if (key === "quote") exec("formatBlock", active.quote ? "p" : "blockquote");
    else if (key === "code") {
      const words = document.getSelection()?.toString() ?? "";
      if (active.code) exec("removeFormat");
      else exec("insertHTML", `<code>${escape(words || "code")}</code>&#8203;`);
    } else if (key === "link") {
      if (active.link) exec("unlink");
      else {
        keepSelection();
        setLinking({ href: "", error: null });
        return;
      }
    } else if (key === "clear") {
      exec("removeFormat");
      exec("unlink");
      exec("formatBlock", "p");
    }
    read();
    refreshActive();
  };

  const addLink = () => {
    if (!linking) return;
    const typed = linking.href.trim();
    const href = safeRichHref(/^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : /@/.test(typed) && !typed.includes("/") ? `mailto:${typed}` : `https://${typed}`);
    if (!href) {
      setLinking({ ...linking, error: "Use a web address (https://…) or an email address." });
      return;
    }
    restoreSelection();
    const selection = document.getSelection();
    if (selection && selection.isCollapsed) exec("insertHTML", `<a href="${escape(href).replace(/"/g, "&quot;")}">${escape(href.replace(/^mailto:/, ""))}</a>&nbsp;`);
    else exec("createLink", href);
    setLinking(null);
    read();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      apply("link");
    }
  };

  const over = value.text.length > maxLength;
  return (
    <div
      className={[
        "overflow-hidden rounded-xl border bg-white transition-shadow focus-within:ring-2",
        invalid || over ? "border-red-400 focus-within:ring-red-200" : "border-slate-200 focus-within:border-slate-400 focus-within:ring-slate-200",
        disabled ? "opacity-60" : "",
        className ?? "",
      ].join(" ")}
    >
      <div role="toolbar" aria-label={`${label}: formatting`} aria-controls={editorId} className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 bg-slate-50/80 px-1.5 py-1">
        {tools.map((tool, index) => (
          <Fragment key={tool.key}>
            {index === 4 || index === 6 || index === 9 ? <span aria-hidden className="mx-1 h-5 w-px bg-slate-200" /> : null}
            <button
              type="button"
              title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
              aria-label={tool.label}
              aria-pressed={tool.key === "clear" ? undefined : Boolean(active[tool.key])}
              disabled={disabled}
              onMouseDown={event => event.preventDefault()}
              onClick={() => apply(tool.key)}
              className={[
                "grid size-8 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed",
                active[tool.key] ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "",
              ].join(" ")}
            >
              <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth={tool.key === "bold" ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
                {icons[tool.key]}
              </svg>
            </button>
          </Fragment>
        ))}
      </div>
      {linking ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-3 py-2">
          <label htmlFor={`${editorId}-link`} className="text-xs font-semibold text-slate-600">
            Link to
          </label>
          <input
            id={`${editorId}-link`}
            autoFocus
            inputMode="url"
            placeholder="https://… or name@example.com"
            value={linking.href}
            onChange={event => setLinking({ href: event.target.value, error: null })}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                addLink();
              }
              if (event.key === "Escape") setLinking(null);
            }}
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 text-sm focus:border-slate-400 focus:outline-none"
          />
          <button type="button" onClick={addLink} className="min-h-9 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white hover:bg-black">
            Add link
          </button>
          <button type="button" onClick={() => setLinking(null)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          {linking.error ? (
            <p role="alert" className="w-full text-xs text-red-600">
              {linking.error}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="relative">
        {!value.text ? (
          <span aria-hidden className="pointer-events-none absolute left-3.5 top-3 text-[15px] text-slate-400">
            {placeholder}
          </span>
        ) : null}
        <div
          ref={box}
          id={editorId}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          aria-invalid={invalid || over || undefined}
          aria-disabled={disabled || undefined}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={read}
          onBlur={read}
          onKeyDown={onKeyDown}
          onKeyUp={refreshActive}
          onMouseUp={refreshActive}
          onPaste={event => {
            event.preventDefault();
            const html = event.clipboardData.getData("text/html");
            const text = event.clipboardData.getData("text/plain");
            exec("insertHTML", cleanRichText(html || escape(text)));
            read();
          }}
          onDrop={event => event.preventDefault()}
          className={`${richTextClass} min-h-32 max-h-[24rem] overflow-y-auto px-3.5 py-3 text-[15px] text-slate-900 outline-none`}
        />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-1.5 text-xs text-slate-500">
        <span className="hidden sm:inline">Bold, lists, quotes and links show as you write them.</span>
        <span className={over ? "font-semibold text-red-600" : ""} aria-live="polite">{`${value.text.length.toLocaleString("en-GB")} / ${maxLength.toLocaleString("en-GB")}`}</span>
      </div>
      {name ? (
        <>
          <input type="hidden" name={name} value={value.text} />
          <input type="hidden" name={`${name}_html`} value={value.text ? value.html : ""} />
        </>
      ) : null}
    </div>
  );
}

// -- Reading long conversations ------------------------------------------------------------------------------------

/** A message's body cut to `maxHeight` pixels with a fade, and Show more / Show less once it is longer. */
export function ClampedBody({ children, maxHeight = 260, fade = "from-white" }: { children: ReactNode; maxHeight?: number; fade?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element) return;
    const measure = () => setLong(element.scrollHeight > maxHeight + 40);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [maxHeight]);
  return (
    <div>
      <div className="relative overflow-hidden" style={long && !open ? { maxHeight } : undefined}>
        <div ref={inner}>{children}</div>
        {long && !open ? <div aria-hidden className={`pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t ${fade} to-transparent`} /> : null}
      </div>
      {long ? (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-2 text-xs font-bold underline underline-offset-2 opacity-80 hover:opacity-100">
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A conversation that stays short: the newest `keep` messages in full; before them the first message and the rest
 * folded to one-line previews (`preview`), and when there are many, hidden behind "Show N earlier messages". A preview
 * opens in place; "Expand all" opens every one.
 */
export function FoldedThread<T extends { id: string }>({
  items,
  keep = 2,
  full,
  preview,
  label = "Messages",
  className,
}: {
  items: T[];
  keep?: number;
  full: (item: T, fold?: () => void) => ReactNode;
  preview: (item: T, open: () => void) => ReactNode;
  label?: string;
  className?: string;
}) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const older = items.slice(0, Math.max(0, items.length - keep));
  const newest = items.slice(older.length);
  // With many older messages, only the first stays as a preview and the rest wait behind one button.
  const hideFrom = older.length > 3 && !showHidden ? 1 : older.length;
  const hidden = older.slice(hideFrom);
  const shownOlder = older.slice(0, hideFrom);
  const toggle = (id: string, open: boolean) =>
    setOpened(current => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const allOpen = older.length > 0 && showHidden && older.every(item => opened.has(item.id));
  const row = (item: T) => <li key={item.id}>{opened.has(item.id) ? full(item, () => toggle(item.id, false)) : preview(item, () => toggle(item.id, true))}</li>;

  return (
    <div className={className}>
      {older.length ? (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => {
              if (allOpen) {
                setOpened(new Set());
                setShowHidden(false);
              } else {
                setOpened(new Set(older.map(item => item.id)));
                setShowHidden(true);
              }
            }}
            className="text-xs font-semibold underline underline-offset-2 opacity-75 hover:opacity-100"
          >
            {allOpen ? "Collapse earlier messages" : "Expand all"}
          </button>
        </div>
      ) : null}
      <ol className="space-y-2" aria-label={label}>
        {shownOlder.map(row)}
        {hidden.length && !showHidden ? (
          <li>
            <button
              type="button"
              onClick={() => setShowHidden(true)}
              className="group relative flex w-full items-center justify-center py-2 text-xs font-bold focus-visible:outline-2"
            >
              <span aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed border-current opacity-20" />
              <span className="relative rounded-full border border-current/20 bg-white px-3.5 py-1 text-slate-700 shadow-sm group-hover:shadow">{`Show ${hidden.length} earlier message${hidden.length === 1 ? "" : "s"}`}</span>
            </button>
          </li>
        ) : (
          hidden.map(row)
        )}
        {newest.map(item => (
          <li key={item.id}>{full(item)}</li>
        ))}
      </ol>
    </div>
  );
}
