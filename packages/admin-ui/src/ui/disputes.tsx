'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Lock, Send } from 'lucide-react';
import { ClampedBody, FoldedThread, RichText, RichTextEditor, snippetOf, type RichValue } from '@bitocard/ui/rich-text';
import { cn, formatDateTime, formatRelative } from '../format';
import { Button, Field, Textarea, Toggle } from './primitives';
import { productName } from '@bitocard/api-client';

/** One message on a dispute, as the API returns it. */
export type DisputeThreadMessage = {
  id: string;
  author: 'customer' | 'reseller' | 'bitocard' | 'afrippa' | 'system' | (string & {});
  author_name: string | null;
  /** A support assistant's picture (support tickets). */
  author_avatar_url?: string | null;
  visibility: 'all' | 'staff' | (string & {});
  body: string;
  /** The message as rich text (support tickets), drawn instead of `body` when present. */
  body_html?: string | null;
  created_at: string;
};

export const disputeActionLabels: Record<string, string> = {
  refund_customer: 'Refund the customer',
  credit_reseller: 'Credit the reseller’s wallet',
  reject: 'Reject the dispute',
  contest_chargeback: 'Contest the chargeback',
  accept_chargeback: 'Accept the chargeback',
};

export const disputeOutcomeLabels: Record<string, string> = {
  resolved_by_reseller: 'Resolved by the store',
  refunded_customer: 'Customer refunded',
  credited_reseller: 'Reseller credited',
  rejected: 'Rejected',
  chargeback_won: 'Chargeback won',
  chargeback_lost: 'Chargeback lost',
  chargeback_accepted: 'Chargeback accepted',
};

export const disputeKindLabels: Record<string, string> = {
  customer: 'Customer',
  get reseller() {
    return `Reseller with ${productName()}`;
  },
  chargeback: 'Chargeback',
};
export const disputeTopicLabels: Record<string, string> = { order: 'Order', payment: 'Payment', funding: 'Wallet funding', trade: 'Trade', other: 'Other' };

/** Who wrote a message, as the reader sees it: "You" for their own side. */
function authorLabel(message: DisputeThreadMessage, viewer: 'reseller' | 'admin') {
  // The admin's own side: BitoCard's team, or Afrippa's on admin.afrippa.com.
  const own = (viewer === 'reseller' && message.author === 'reseller') || (viewer === 'admin' && (message.author === 'bitocard' || message.author === 'afrippa'));
  const roles: Record<string, string> = { customer: 'Customer', reseller: 'Store', bitocard: productName(), afrippa: 'Afrippa', bot: 'Assistant', system: productName() };
  const role = roles[message.author] ?? message.author;
  if (message.author === 'system') return 'Update';
  return own ? `${message.author_name ?? role} (you)` : message.author_name ? `${message.author_name} · ${role}` : role;
}

const ownSide = (message: DisputeThreadMessage, viewer: 'reseller' | 'admin') =>
  (viewer === 'reseller' && message.author === 'reseller') || (viewer === 'admin' && (message.author === 'bitocard' || message.author === 'afrippa'));

/** Each kind of message's colours: updates dashed, staff notes amber, the reader's own side tinted. */
function tone(message: DisputeThreadMessage, viewer: 'reseller' | 'admin') {
  if (message.author === 'system') return { box: 'border-dashed border-line bg-canvas', fade: 'from-canvas' };
  if (message.visibility === 'staff') return { box: 'border-amber-200 bg-amber-50', fade: 'from-amber-50' };
  if (ownSide(message, viewer)) return { box: 'border-brand-100 bg-brand-50', fade: 'from-brand-50' };
  return { box: 'border-line bg-white', fade: 'from-white' };
}

/** The writer's face: an assistant's picture, else their initials. */
function Face({ message, viewer }: { message: DisputeThreadMessage; viewer: 'reseller' | 'admin' }) {
  if (message.author === 'bot' && message.author_avatar_url) {
    // eslint-disable-next-line @next/next/no-img-element -- the assistant's uploaded picture
    return <img src={message.author_avatar_url} alt="" className="size-7 shrink-0 rounded-full object-cover ring-1 ring-violet-100" />;
  }
  const name = (message.author_name ?? authorLabel(message, viewer)).replace(/\(you\)/, '').split('·')[0]!.trim();
  const letters =
    name
      .split(/\s+/)
      .map(word => word[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '•';
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold',
        ownSide(message, viewer) ? 'bg-brand-500 text-white' : message.visibility === 'staff' ? 'bg-amber-200 text-amber-900' : 'bg-slate-200 text-slate-700',
      )}
    >
      {letters}
    </span>
  );
}

function Meta({ message, viewer, requester, children }: { message: DisputeThreadMessage; viewer: 'reseller' | 'admin'; requester: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span className="font-semibold text-ink">{authorLabel(message, viewer)}</span>
      <span title={formatDateTime(message.created_at)}>{formatRelative(message.created_at)}</span>
      {message.visibility === 'staff' ? (
        <span className="inline-flex items-center gap-1 font-medium text-amber-700">
          <Lock className="size-3" aria-hidden />
          {`Staff only: the ${requester} never sees this`}
        </span>
      ) : null}
      {children}
    </div>
  );
}

/**
 * The messages on a dispute (or support ticket), oldest first; staff notes are marked as never shown to the requester
 * (`requester`: who that is, the customer unless said otherwise). With `fold` a long conversation stays short: the
 * newest messages in full, older ones as one-line previews to open, many of them behind "Show N earlier messages",
 * and long messages cut short with Show more. Messages written as rich text are drawn with their formatting.
 */
export function DisputeThread({ messages, viewer, requester = 'customer', fold = false }: { messages: DisputeThreadMessage[]; viewer: 'reseller' | 'admin'; requester?: string; fold?: boolean }) {
  if (!messages.length) return <p className="text-sm text-muted">No messages yet.</p>;
  const full = (message: DisputeThreadMessage, close?: () => void) => {
    const colours = tone(message, viewer);
    return (
      <article className={cn('rounded-2xl border p-4', colours.box)}>
        <div className="mb-2 flex items-start gap-2.5">
          <Face message={message} viewer={viewer} />
          <Meta message={message} viewer={viewer} requester={requester}>
            {close ? (
              <button type="button" onClick={close} className="ml-auto inline-flex items-center gap-0.5 font-semibold text-muted hover:text-ink">
                <ChevronUp className="size-3.5" aria-hidden />
                Fold
              </button>
            ) : null}
          </Meta>
        </div>
        <ClampedBody fade={colours.fade}>
          <RichText html={message.body_html} text={message.body} className="text-sm text-ink" />
        </ClampedBody>
      </article>
    );
  };
  if (!fold) {
    return (
      <ol className="space-y-3" aria-label="Messages">
        {messages.map(message => (
          <li key={message.id}>{full(message)}</li>
        ))}
      </ol>
    );
  }
  return (
    <FoldedThread
      items={messages}
      full={full}
      preview={(message, open) => (
        <button
          type="button"
          onClick={open}
          aria-label={`Open the message from ${authorLabel(message, viewer)}`}
          className={cn('flex w-full min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-shadow hover:shadow-card', tone(message, viewer).box)}
        >
          <Face message={message} viewer={viewer} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2 text-xs">
              <span className="truncate font-semibold text-ink">{authorLabel(message, viewer)}</span>
              <span className="shrink-0 text-muted" title={formatDateTime(message.created_at)}>
                {formatRelative(message.created_at)}
              </span>
              {message.visibility === 'staff' ? <Lock className="size-3 shrink-0 text-amber-700" aria-label="Staff only" /> : null}
            </span>
            <span className="block truncate text-sm text-muted">{snippetOf(message.body_html, message.body)}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-subtle" aria-hidden />
        </button>
      )}
    />
  );
}

/**
 * A reply box. `staffOption` offers a note that only the store and BitoCard see; it starts as a message to everyone,
 * or as a staff note when `staffFirst` is set.
 */
export function DisputeReply({
  onSend,
  staffOption = true,
  staffFirst = false,
  disabled,
  error,
  rich = false,
}: {
  /** `html`: the message as rich text, with `rich`. */
  onSend: (body: string, visibility: 'all' | 'staff', html?: string) => Promise<boolean>;
  staffOption?: boolean;
  staffFirst?: boolean;
  disabled?: boolean;
  error?: string | null;
  /** A rich text editor (support tickets) in place of the plain box. */
  rich?: boolean;
}) {
  const id = useId();
  const [body, setBody] = useState('');
  const [value, setValue] = useState<RichValue>({ html: '', text: '' });
  const [sentCount, setSentCount] = useState(0);
  const [staff, setStaff] = useState(staffFirst);
  const [busy, setBusy] = useState(false);
  const words = rich ? value.text : body.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!words || busy) return;
    setBusy(true);
    const visibility = staffOption && staff ? 'staff' : 'all';
    const sent = rich ? await onSend(words, visibility, value.html) : await onSend(words, visibility);
    setBusy(false);
    if (sent) {
      setBody('');
      setValue({ html: '', text: '' });
      setSentCount(count => count + 1);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Field label={staffOption && staff ? 'Staff note' : 'Message'} htmlFor={`${id}-body`} error={error ?? undefined}>
        {rich ? (
          <RichTextEditor id={`${id}-body`} label={staffOption && staff ? 'Staff note' : 'Message'} resetKey={sentCount} disabled={disabled} invalid={Boolean(error)} placeholder="Write your reply…" onChange={setValue} />
        ) : (
          <Textarea id={`${id}-body`} rows={4} maxLength={5000} value={body} onChange={event => setBody(event.target.value)} disabled={disabled} />
        )}
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {staffOption ? (
          <span className="flex items-center gap-2 text-sm text-muted">
            <Toggle checked={staff} onChange={setStaff} label="Staff note: the customer never sees it" disabled={disabled} />
            Staff note: the customer never sees it
          </span>
        ) : (
          <span />
        )}
        <Button type="submit" icon={<Send className="size-4" aria-hidden />} loading={busy} disabled={disabled || !words || words.length > 5000}>
          Send
        </Button>
      </div>
    </form>
  );
}
