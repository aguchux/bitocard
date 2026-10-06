import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderMarkdown } from "./highlight";

/** The guides, in reading order. Each is a Markdown file in content/. */
export const guides = [
  { slug: "quickstart", title: "Quickstart", group: "Get started" },
  { slug: "authentication", title: "Authentication", group: "Get started" },
  { slug: "sandbox-and-live", title: "Sandbox and live", group: "Get started" },
  { slug: "try-it", title: "Try it in the docs", group: "Get started" },
  { slug: "orders", title: "Orders", group: "Guides" },
  { slug: "webhooks", title: "Webhooks", group: "Guides" },
  { slug: "errors", title: "Errors", group: "Guides" },
  { slug: "idempotency", title: "Idempotency", group: "Guides" },
  { slug: "pagination", title: "Pagination", group: "Guides" },
  { slug: "rate-limits", title: "Rate limits", group: "Guides" },
  { slug: "changelog", title: "Changelog", group: "Guides" },
] as const;

export type GuideSlug = (typeof guides)[number]["slug"];

const contentDir = path.join(process.cwd(), "content");

export async function loadGuide(slug: string) {
  const guide = guides.find(item => item.slug === slug);
  if (!guide) return null;
  const source = await readFile(path.join(contentDir, `${slug}.md`), "utf8");
  return { ...guide, ...(await renderMarkdown(source)) };
}
