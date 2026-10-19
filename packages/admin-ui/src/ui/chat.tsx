'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Bot, FileText, Loader2, Paperclip, SendHorizontal, X } from 'lucide-react';
import { chatFileAccept, formatFileSize, initials, prepareChatFile, startsRun } from '@bitocard/ui/chat';
import { cn, formatDateTime } from '../format';

export type ChatPanelAttachment = { id: string; name: string; content_type: string; size: number; width: number | null; height: number | null };
export type ChatPanelMessage = { id: string; author: string; author_name: string | null; body: string; attachments?: ChatPanelAttachment[]; created_at: string };

const roles: Record<string, string> = { customer: 'Customer', reseller: 'Store', bitocard: 'BitoCard', bot: 'Assistant', system: 'Update' };
const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** A participant's face: the assistant's picture or icon, otherwise their initials on their side's colour. */
export function ChatAvatar({ name, author, ours, src, className }: { name: string | null; author: string; ours?: boolean; src?: string | null; className?: string }) {
  const base = cn('grid size-8 shrink-0 place-items-center overflow-hidden rounded-full text-[11px] font-bold', className);
  if (author === 'bot') {
    return src ? (
      // eslint-disable-next-line @next/next/no-img-element -- the assistant's uploaded picture
      <img src={src} alt="" className={cn(base, 'object-cover ring-1 ring-violet-100')} />
    ) : (
      <span className={cn(base, 'bg-violet-100 text-violet-700')} aria-hidden>
        <Bot className="size-4" />
      </span>
    );
  }
  const tone = ours ? 'bg-brand-500 text-white' : author === 'customer' || author === 'reseller' ? 'bg-navy-900 text-white' : 'bg-pink-100 text-pink-700';
  return (
    <span className={cn(base, tone)} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** A file read through the API as a blob (an `<img>` cannot send the account headers), shown from memory. */
function useBlobUrl(load: (() => Promise<Blob>) | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!load) return;
    let live = true;
    let made: string | null = null;
    load()
      .then(blob => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [load]);
  return { url, failed };
}

function Attachment({ file, loadFile, ours }: { file: ChatPanelAttachment; loadFile?: (id: string) => Promise<Blob>; ours: boolean }) {
  const image = file.content_type.startsWith('image/');
  const [load] = useState(() => (loadFile && image ? () => loadFile(file.id) : null));
  const { url, failed } = useBlobUrl(load);
  const open = async () => {
    if (!loadFile) return;
    const blob = await loadFile(file.id).catch(() => null);
    if (blob) window.open(URL.createObjectURL(blob), '_blank', 'noopener');
  };
  if (image) {
    return (
      <button type="button" onClick={() => void open()} className="block overflow-hidden rounded-xl bg-slate-100" aria-label={`Open ${file.name}`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a chat photo read through the API
          <img src={url} alt={file.name} className="max-h-56 w-full max-w-64 object-cover" />
        ) : (
          <span className="grid h-32 w-48 place-items-center text-xs text-muted">{failed ? 'Photo not available' : <Loader2 className="size-4 animate-spin" aria-hidden />}</span>
        )}
      </button>
    );
  }
  return (
    <button type="button" onClick={() => void open()} className={cn('flex w-full max-w-64 items-center gap-2 rounded-xl px-3 py-2 text-left', ours ? 'bg-white/15 hover:bg-white/25' : 'bg-slate-50 ring-1 ring-line hover:bg-slate-100')}>
      <FileText className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{file.name}</span>
        <span className={cn('block text-xs', ours ? 'text-white/70' : 'text-muted')}>PDF · {formatFileSize(file.size)}</span>
      </span>
    </button>
  );
}

/**
 * A live chat: messages oldest first (the reader's own side on the right) with each participant's avatar and name at
 * the start of their run, kept scrolled to the newest; and a compact composer (attach a photo or PDF, Enter sends,
 * Shift+Enter starts a new line). `side` is who the reader writes as.
 */
export function ChatPanel({
  messages,
  side,
  requesterLabel,
  onSend,
  onAttach,
  loadFile,
  assistantAvatar,
  disabled,
  error,
  placeholder = 'Write a message',
  className,
}: {
  messages: ChatPanelMessage[];
  side: 'reseller' | 'bitocard';
  requesterLabel?: string;
  onSend?: (body: string) => Promise<boolean>;
  onAttach?: (file: File, body: string) => Promise<boolean>;
  loadFile?: (id: string) => Promise<Blob>;
  assistantAvatar?: string | null;
  disabled?: boolean;
  error?: string | null;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const end = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const last = messages.at(-1)?.id;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [last]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [body]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || disabled) return;
    if (file && onAttach) {
      setBusy(true);
      const sent = await onAttach(file, body.trim());
      setBusy(false);
      if (sent) {
        setFile(null);
        setBody('');
      }
      return;
    }
    if (!onSend || !body.trim()) return;
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
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    const ready = await prepareChatFile(picked);
    if ('problem' in ready) {
      setProblem(ready.problem);
      return;
    }
    setProblem(null);
    setFile(ready.file);
  };
  const nameOf = (message: ChatPanelMessage) =>
    message.author === 'customer' || (message.author === 'reseller' && side === 'bitocard') ? (requesterLabel ?? message.author_name ?? roles[message.author]) : (message.author_name ?? roles[message.author] ?? message.author);
  const canSend = !disabled && !busy && (Boolean(file) || Boolean(body.trim()));

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <ol className="max-h-[60vh] min-h-48 flex-1 space-y-1 overflow-y-auto rounded-2xl bg-canvas p-3" aria-label="Chat messages" aria-live="polite">
        {messages.map((message, index) => {
          if (message.author === 'system') {
            return (
              <li key={message.id} className="py-2 text-center text-xs text-muted">
                <span className="rounded-full bg-white px-3 py-1 ring-1 ring-line">
                  {message.body} · {time(message.created_at)}
                </span>
              </li>
            );
          }
          const ours = message.author === side;
          const first = startsRun(messages, index);
          const who = nameOf(message);
          return (
            <li key={message.id} className={cn('flex items-end gap-2', ours ? 'flex-row-reverse' : 'flex-row', first ? 'pt-2' : '')}>
              {first ? <ChatAvatar name={who} author={message.author} ours={ours} src={message.author === 'bot' ? assistantAvatar : null} /> : <span className="w-8 shrink-0" aria-hidden />}
              <div className={cn('flex max-w-[78%] flex-col gap-1', ours ? 'items-end' : 'items-start')}>
                {first ? (
                  <p className="flex items-center gap-1 px-1 text-xs text-muted" title={formatDateTime(message.created_at)}>
                    <span className="font-semibold text-ink">{ours ? 'You' : who}</span>
                    {message.author === 'bot' ? <span className="rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-700">AI</span> : null}
                    <span>· {time(message.created_at)}</span>
                  </p>
                ) : null}
                {message.attachments?.map(attached => <Attachment key={attached.id} file={attached} loadFile={loadFile} ours={ours} />)}
                {message.body ? (
                  <p className={cn('rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words', ours ? 'rounded-br-md bg-brand-500 text-white' : message.author === 'bot' ? 'rounded-bl-md bg-violet-50 text-ink ring-1 ring-violet-100' : 'rounded-bl-md bg-white text-ink ring-1 ring-line')}>
                    {message.body}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
        {!messages.length ? <li className="py-8 text-center text-sm text-muted">No messages yet.</li> : null}
        <div ref={end} />
      </ol>
      {onSend ? (
        <form onSubmit={send} noValidate>
          <div className="rounded-2xl border border-line bg-white p-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
            {file ? (
              <div className="mb-1 flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-1.5 text-sm">
                <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="text-xs text-muted">{formatFileSize(file.size)}</span>
                <button type="button" onClick={() => setFile(null)} className="grid size-6 place-items-center rounded-full text-muted hover:bg-slate-200" aria-label="Remove file">
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            ) : null}
            <div className="flex items-end gap-1">
              {onAttach ? (
                <>
                  <button type="button" onClick={() => picker.current?.click()} disabled={disabled || busy} className="grid size-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-slate-100 hover:text-ink disabled:opacity-50" aria-label="Attach a photo or PDF">
                    <Paperclip className="size-[18px]" aria-hidden />
                  </button>
                  <input ref={picker} type="file" accept={chatFileAccept} className="hidden" onChange={event => void choose(event)} tabIndex={-1} />
                </>
              ) : null}
              <label htmlFor={`${id}-body`} className="sr-only">
                Message
              </label>
              <textarea
                ref={area}
                id={`${id}-body`}
                rows={1}
                maxLength={2000}
                value={body}
                placeholder={file ? 'Add a caption (optional)' : placeholder}
                onChange={event => setBody(event.target.value)}
                onKeyDown={onKey}
                disabled={disabled}
                className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-ink outline-none placeholder:text-muted focus:ring-0 disabled:opacity-60"
              />
              <button type="submit" disabled={!canSend} className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-500 text-white transition hover:bg-brand-600 disabled:bg-slate-200 disabled:text-slate-400" aria-label="Send">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <SendHorizontal className="size-4" aria-hidden />}
              </button>
            </div>
          </div>
          <p className="mt-1 px-1 text-[11px] text-muted">Enter to send · Shift+Enter for a new line{onAttach ? ' · Photos and PDFs up to 4 MB' : ''}</p>
        </form>
      ) : null}
      {problem || error ? (
        <p role="alert" className="text-sm text-red-700">
          {problem ?? error}
        </p>
      ) : null}
    </div>
  );
}

/** A chat's state as staff read it. */
export const chatStatusLabels: Record<string, string> = { bot: 'Assistant answering', waiting: 'Waiting for a person', with_staff: 'With a person', closed: 'Ended' };
