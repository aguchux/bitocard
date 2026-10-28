import type { FormState } from "@afrippa/ui/forms";

/** This site's own cookie holding a signed-out visitor's chat token (host-only, httpOnly, 30 days). */
export const chatCookie = "afr_chat";

/** A message in a chat with Afrippa: from the trader or visitor (`customer`), Afrippa's team, its assistant (`bot`), or the system. */
export type ChatMessage = { id: string; author: string; author_name?: string | null; body: string; attachments: Array<{ id: string; name: string; content_type: string }>; created_at: string };
export type Chat = { id: string; status: "bot" | "waiting" | "with_staff" | "closed"; ticket_reference: string | null; messages: ChatMessage[] };
export type ChatState = FormState & { chat?: Chat };

/**
 * What the chat on the help page calls: a signed-in trader's own actions (`lib/help.ts`), or a signed-out visitor's
 * (`lib/visitor-chat.ts`), and where its files are read through this site.
 */
export type ChatActions = {
  send: (state: ChatState, form: FormData) => Promise<ChatState>;
  since: (id: string, after: string | null) => Promise<{ status: Chat["status"]; data: ChatMessage[] } | null>;
  end: (id: string) => Promise<Chat | null>;
  files: string;
};
