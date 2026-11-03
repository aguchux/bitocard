/**
 * The home page editor's live preview: udozo.com's `/home-preview` shown inside Udozo's admin (and, later, Seller HQ).
 * Only these sites may frame it (`frame-ancestors` in next.config.ts, for that path alone) and only their messages are
 * followed (`preview-bridge.tsx`). `NEXT_PUBLIC_UDOZO_ADMIN_URL` overrides the admin's address; local development adds
 * the admin's dev server.
 */
export function previewParents(env: Record<string, string | undefined> = process.env): string[] {
  const admin = (env.NEXT_PUBLIC_UDOZO_ADMIN_URL ?? "https://admin.udozo.com").replace(/\/$/, "");
  return env.NODE_ENV === "production" ? [admin] : [admin, "http://localhost:3012"];
}

/** What the editor tells the preview: read the draft again (after a save), or show this block. */
export type EditorMessage = { source: "udozo-editor"; type: "refresh" } | { source: "udozo-editor"; type: "focus"; id: string };
/** What the preview tells the editor: it is ready, or a block (and its row) was chosen. */
export type PreviewMessage = { source: "udozo-preview"; type: "ready" } | { source: "udozo-preview"; type: "select"; row: string | null; block: string | null };

export function isEditorMessage(data: unknown): data is EditorMessage {
  if (!data || typeof data !== "object") return false;
  const message = data as { source?: unknown; type?: unknown; id?: unknown };
  return message.source === "udozo-editor" && (message.type === "refresh" || (message.type === "focus" && typeof message.id === "string" && message.id.length <= 60));
}
