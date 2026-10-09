'use client';

import { useId, useState, type FormEvent } from 'react';
import { Lock, Send } from 'lucide-react';
import { cn, formatDateTime, formatRelative } from '../format';
import { Button, Field, Textarea, Toggle } from './primitives';

/** One message on a dispute, as the API returns it. */
export type DisputeThreadMessage = {
  id: string;
  author: 'customer' | 'reseller' | 'bitocard' | 'system' | (string & {});
  author_name: string | null;
  visibility: 'all' | 'staff' | (string & {});
  body: string;
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
};

export const disputeKindLabels: Record<string, string> = { customer: 'Customer', reseller: 'Reseller with BitoCard', chargeback: 'Chargeback' };
export const disputeTopicLabels: Record<string, string> = { order: 'Order', payment: 'Payment', funding: 'Wallet funding', trade: 'Trade', other: 'Other' };

/** Who wrote a message, as the reader sees it: "You" for their own side. */
function authorLabel(message: DisputeThreadMessage, viewer: 'reseller' | 'admin') {
  const own = (viewer === 'reseller' && message.author === 'reseller') || (viewer === 'admin' && message.author === 'bitocard');
  const roles: Record<string, string> = { customer: 'Customer', reseller: 'Store', bitocard: 'BitoCard', system: 'BitoCard' };
  const role = roles[message.author] ?? message.author;
  if (message.author === 'system') return 'Update';
  return own ? `${message.author_name ?? role} (you)` : message.author_name ? `${message.author_name} · ${role}` : role;
}

/** The messages on a dispute, oldest first; staff notes are marked as never shown to the customer. */
export function DisputeThread({ messages, viewer }: { messages: DisputeThreadMessage[]; viewer: 'reseller' | 'admin' }) {
  if (!messages.length) return <p className="text-sm text-muted">No messages yet.</p>;
  return (
    <ol className="space-y-3" aria-label="Messages">
      {messages.map(message => {
        const ours = (viewer === 'reseller' && message.author === 'reseller') || (viewer === 'admin' && message.author === 'bitocard');
        return (
          <li
            key={message.id}
            className={cn(
              'rounded-2xl border p-4',
              message.author === 'system' ? 'border-dashed border-line bg-canvas' : message.visibility === 'staff' ? 'border-amber-200 bg-amber-50' : ours ? 'border-brand-100 bg-brand-50' : 'border-line bg-white',
            )}
          >
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className="font-semibold text-ink">{authorLabel(message, viewer)}</span>
              <span title={formatDateTime(message.created_at)}>{formatRelative(message.created_at)}</span>
              {message.visibility === 'staff' ? (
                <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                  <Lock className="size-3" aria-hidden />
                  Staff only: the customer never sees this
                </span>
              ) : null}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-ink">{message.body}</p>
          </li>
        );
      })}
    </ol>
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
}: {
  onSend: (body: string, visibility: 'all' | 'staff') => Promise<boolean>;
  staffOption?: boolean;
  staffFirst?: boolean;
  disabled?: boolean;
  error?: string | null;
}) {
  const id = useId();
  const [body, setBody] = useState('');
  const [staff, setStaff] = useState(staffFirst);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    const sent = await onSend(body.trim(), staffOption && staff ? 'staff' : 'all');
    setBusy(false);
    if (sent) setBody('');
  };
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Field label={staffOption && staff ? 'Staff note' : 'Message'} htmlFor={`${id}-body`} error={error ?? undefined}>
        <Textarea id={`${id}-body`} rows={4} maxLength={5000} value={body} onChange={event => setBody(event.target.value)} disabled={disabled} />
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
        <Button type="submit" icon={<Send className="size-4" aria-hidden />} loading={busy} disabled={disabled || !body.trim()}>
          Send
        </Button>
      </div>
    </form>
  );
}
