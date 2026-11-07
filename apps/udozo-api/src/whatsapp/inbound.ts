/** One message a person sent to Udozo's number, as the bot reads it. */
export type Inbound = {
  wamid: string;
  from: string;
  profileName: string | null;
  /** text (typed), choice (a button or list row, or a template's quick reply), image, or other (stickers, voice notes...). */
  kind: 'text' | 'choice' | 'image' | 'other';
  text: string;
  /** A button's or row's id (a template's quick reply: its payload). */
  choice: string | null;
  imageId: string | null;
  /** The Udozo message they replied to (WhatsApp's reply), if any. */
  replyTo: string | null;
  at: Date;
};

export type StatusUpdate = { wamid: string; status: string; error?: { code?: number; title?: string } };

type MetaMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
  button?: { payload?: string; text?: string };
  image?: { id?: string; caption?: string };
  context?: { id?: string };
};

type MetaBody = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: MetaMessage[];
        statuses?: Array<{ id?: string; status?: string; errors?: Array<{ code?: number; title?: string }> }>;
      };
    }>;
  }>;
};

/** The messages and delivery reports in one webhook body (anything unexpected is left out). */
export function readBody(raw: unknown): { messages: Inbound[]; statuses: StatusUpdate[] } {
  const body = (raw && typeof raw === 'object' ? raw : {}) as MetaBody;
  const messages: Inbound[] = [];
  const statuses: StatusUpdate[] = [];
  if (body.object !== 'whatsapp_business_account') return { messages, statuses };
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages' || !change.value) continue;
      const names = new Map((change.value.contacts ?? []).map(contact => [contact.wa_id ?? '', contact.profile?.name?.slice(0, 80) ?? null]));
      for (const message of change.value.messages ?? []) {
        if (!message.id || !message.from || !/^\d{6,20}$/.test(message.from)) continue;
        const choice = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? message.button?.payload ?? null;
        const text = message.text?.body ?? message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? message.button?.text ?? message.image?.caption ?? '';
        const kind: Inbound['kind'] = choice ? 'choice' : message.type === 'text' ? 'text' : message.type === 'image' && message.image?.id ? 'image' : 'other';
        messages.push({
          wamid: message.id,
          from: message.from,
          profileName: names.get(message.from) ?? null,
          kind,
          text: text.slice(0, 4000),
          choice: choice?.slice(0, 256) ?? null,
          imageId: message.image?.id ?? null,
          replyTo: message.context?.id ?? null,
          at: message.timestamp && /^\d+$/.test(message.timestamp) ? new Date(Number(message.timestamp) * 1000) : new Date(),
        });
      }
      for (const status of change.value.statuses ?? []) {
        if (status.id && status.status) statuses.push({ wamid: status.id, status: status.status, error: status.errors?.[0] });
      }
    }
  }
  return { messages, statuses };
}
