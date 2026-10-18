'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Bot, Send } from 'lucide-react';
import { cn, formatDateTime } from '../format';
import { Button } from './primitives';

export type ChatPanelMessage = { id: string; author: string; author_name: string | null; body: string; created_at: string };

const roles: Record<string, string> = { customer: 'Customer', reseller: 'Store', bitocard: 'BitoCard', bot: 'Assistant', system: 'Update' };
const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/**
 * A live chat: messages oldest first (the reader's own side on the right), kept scrolled to the newest, and a composer
 * (Enter sends, Shift+Enter starts a new line). `side` is who the reader writes as.
 */
export function ChatPanel({
  messages,
  side,
  requesterLabel,
  onSend,
  disabled,
  error,
  placeholder = 'Write a message',
}: {
  messages: ChatPanelMessage[];
  side: 'reseller' | 'bitocard';
  requesterLabel?: string;
  onSend?: (body: string) => Promise<boolean>;
  disabled?: boolean;
  error?: string | null;
  placeholder?: string;
}) {
  const id = useId();
  const end = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const last = messages.at(-1)?.id;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [last]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!onSend || !body.trim() || busy) return;
    setBusy(true);
    const sent = await onSend(body.trim());
    setBusy(false);
    if (sent) setBody('');
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <ol className="max-h-[60vh] min-h-48 space-y-2 overflow-y-auto rounded-2xl bg-canvas p-3" aria-label="Chat messages" aria-live="polite">
        {messages.map(message => {
          if (message.author === 'system') {
            return (
              <li key={message.id} className="text-center text-xs text-muted">
                {message.body} · {time(message.created_at)}
              </li>
            );
          }
          const ours = message.author === side;
          const who = message.author === 'customer' || (message.author === 'reseller' && side === 'bitocard') ? (requesterLabel ?? message.author_name ?? roles[message.author]) : (message.author_name ?? roles[message.author] ?? message.author);
          return (
            <li key={message.id} className={cn('flex', ours ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm', ours ? 'bg-brand-500 text-white' : message.author === 'bot' ? 'bg-violet-50 text-ink ring-1 ring-violet-100' : 'bg-white text-ink ring-1 ring-line')}>
                <p className={cn('mb-0.5 flex items-center gap-1 text-xs', ours ? 'text-white/80' : 'text-muted')} title={formatDateTime(message.created_at)}>
                  {message.author === 'bot' ? <Bot className="size-3" aria-hidden /> : null}
                  <span className="font-semibold">{ours ? 'You' : who}</span> · {time(message.created_at)}
                </p>
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
              </div>
            </li>
          );
        })}
        {!messages.length ? <li className="py-8 text-center text-sm text-muted">No messages yet.</li> : null}
        <div ref={end} />
      </ol>
      {onSend ? (
        <form onSubmit={send} className="flex items-end gap-2" noValidate>
          <label htmlFor={`${id}-body`} className="sr-only">
            Message
          </label>
          <textarea
            id={`${id}-body`}
            rows={2}
            maxLength={2000}
            value={body}
            placeholder={placeholder}
            onChange={event => setBody(event.target.value)}
            onKeyDown={onKey}
            disabled={disabled}
            className="min-h-11 flex-1 resize-y rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:opacity-60"
          />
          <Button type="submit" icon={<Send className="size-4" aria-hidden />} loading={busy} disabled={disabled || !body.trim()}>
            Send
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A chat's state as staff read it. */
export const chatStatusLabels: Record<string, string> = { bot: 'Assistant answering', waiting: 'Waiting for a person', with_staff: 'With a person', closed: 'Ended' };
