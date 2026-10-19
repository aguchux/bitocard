'use client';

import { useState } from 'react';
import { Bot, Send, Trash2 } from 'lucide-react';
import { formatRelative } from '../format';
import { Button, Textarea } from './primitives';

export type TicketDraft = { id: string; author_name: string | null; body: string; created_at: string };

/**
 * The assistant's suggested replies on a ticket, for staff: Send as it is (the assistant's words), edit then send
 * (yours), or Discard. The requester never sees a draft.
 */
export function TicketDrafts({ drafts, onSend, onDiscard, disabled }: { drafts: TicketDraft[]; onSend: (id: string, body?: string) => Promise<boolean>; onDiscard: (id: string) => Promise<boolean>; disabled?: boolean }) {
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!drafts.length) return null;
  const run = async (id: string, work: () => Promise<boolean>) => {
    setBusy(id);
    const done = await work();
    setBusy(null);
    if (done) {
      setEditing(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };
  return (
    <div className="space-y-3">
      {drafts.map(draft => {
        const text = editing[draft.id];
        return (
          <div key={draft.id} className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <p className="flex items-center gap-1.5 text-xs text-violet-800">
              <Bot className="size-3.5" aria-hidden />
              <span className="font-semibold">{`${draft.author_name ?? 'Assistant'}’s suggested reply`}</span> · {formatRelative(draft.created_at)} · the requester has not seen it
            </p>
            {text === undefined ? (
              <p className="whitespace-pre-wrap break-words text-sm text-ink">{draft.body}</p>
            ) : (
              <Textarea rows={5} maxLength={5000} value={text} onChange={event => setEditing({ ...editing, [draft.id]: event.target.value })} aria-label="Edit the reply" />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" aria-hidden />} disabled={disabled || busy !== null} onClick={() => void run(draft.id, () => onDiscard(draft.id))}>
                Discard
              </Button>
              {text === undefined ? (
                <Button variant="secondary" size="sm" disabled={disabled || busy !== null} onClick={() => setEditing({ ...editing, [draft.id]: draft.body })}>
                  Edit
                </Button>
              ) : null}
              <Button size="sm" icon={<Send className="size-4" aria-hidden />} loading={busy === draft.id} disabled={disabled || (busy !== null && busy !== draft.id) || (text !== undefined && !text.trim())} onClick={() => void run(draft.id, () => onSend(draft.id, text))}>
                {text === undefined ? 'Send' : 'Send edited'}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
