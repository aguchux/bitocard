'use client';

import { useEffect, useEffectEvent, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { AlertTriangle, FileText, Maximize2, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  type KycDecision,
  type KycDeclineReason,
  type KycReviewCase,
  type KycReviewDocument,
  kycDeclineReasons,
  kycDocumentLabel,
  kycItemLabels,
  kycLivenessGroups,
  kycStatusLabels,
} from '@bitocard/api-client/kyc';
import { cn, formatDate, formatDateTime } from '../format';
import { ActionDialog } from './action-dialog';
import { Badge, Notice, StatusBadge } from './status';
import { Button, Card, CardHeader, Field, Input, KeyValue, Select, Textarea } from './primitives';
import { productName } from '@bitocard/api-client';

/** Reads one document's file with the reviewer's session (the API streams it decrypted, never cached). */
export type KycDocumentFetcher = (document: KycReviewDocument) => Promise<Blob>;

type Loaded = { url?: string; failed?: boolean };

/**
 * Loads every document into an object URL, so images show and PDFs open without the files ever being cached or given
 * a lasting address. The URLs are revoked when the case changes or the page closes.
 */
export function useKycDocuments(documents: KycReviewDocument[], fetchDocument: KycDocumentFetcher) {
  // Keyed by document and upload time, so a replaced file is loaded again and a stale one is never shown.
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const fileKey = (document: KycReviewDocument) => `${document.id}:${document.uploaded_at}`;
  const key = documents.map(fileKey).join(',');

  const load = useEffectEvent(() => {
    let live = true;
    const urls: string[] = [];
    for (const document of documents) {
      fetchDocument(document)
        .then(blob => {
          const url = URL.createObjectURL(blob);
          urls.push(url);
          if (live) setLoaded(current => ({ ...current, [fileKey(document)]: { url } }));
          else URL.revokeObjectURL(url);
        })
        .catch(() => {
          if (live) setLoaded(current => ({ ...current, [fileKey(document)]: { failed: true } }));
        });
    }
    return () => {
      live = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  });

  useEffect(() => load(), [key]);

  return Object.fromEntries(documents.map(document => [document.id, loaded[fileKey(document)]])) as Record<string, Loaded | undefined>;
}

const isImage = (document: KycReviewDocument) => document.content_type.startsWith('image/');

/** Zoom, pan and rotate one image, full screen. Escape or the close button closes it. */
export function ImageViewer({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);

  const zoomTo = (next: number) => {
    const value = Math.min(6, Math.max(1, Math.round(next * 100) / 100));
    setZoom(value);
    if (value === 1) setOffset({ x: 0, y: 0 });
  };
  const reset = () => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom === 1) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: offset };
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setOffset({ x: start.from.x + event.clientX - start.x, y: start.from.y + event.clientY - start.y });
  };
  const up = () => {
    drag.current = null;
  };

  const tool = 'grid size-11 place-items-center rounded-xl text-white hover:bg-white/15';
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-navy-950/95 p-0 text-white"
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <p className="min-w-0 truncate px-2 text-sm font-semibold">{label}</p>
          <div className="flex items-center gap-1" role="toolbar" aria-label="Image controls">
            <button type="button" className={tool} aria-label="Zoom out" onClick={() => zoomTo(zoom / 1.5)} disabled={zoom === 1}>
              <ZoomOut className="size-5" aria-hidden />
            </button>
            <span className="w-12 text-center text-sm tabular-nums" aria-live="polite">{`${Math.round(zoom * 100)}%`}</span>
            <button type="button" className={tool} aria-label="Zoom in" onClick={() => zoomTo(zoom * 1.5)} disabled={zoom === 6}>
              <ZoomIn className="size-5" aria-hidden />
            </button>
            <button type="button" className={tool} aria-label="Rotate left" onClick={() => setRotation(value => value - 90)}>
              <RotateCcw className="size-5" aria-hidden />
            </button>
            <button type="button" className={tool} aria-label="Rotate right" onClick={() => setRotation(value => value + 90)}>
              <RotateCw className="size-5" aria-hidden />
            </button>
            <button type="button" className={tool} aria-label="Reset" onClick={reset}>
              <Maximize2 className="size-5" aria-hidden />
            </button>
            <button type="button" className={tool} aria-label="Close" onClick={onClose}>
              <X className="size-6" aria-hidden />
            </button>
          </div>
        </div>
        <div
          className={cn('relative flex-1 touch-none overflow-hidden', zoom > 1 ? 'cursor-grab active:cursor-grabbing' : '')}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onWheel={event => zoomTo(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15))}
          onDoubleClick={() => (zoom === 1 ? zoomTo(2.5) : reset())}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a private document held only as an object URL */}
          <img
            src={src}
            alt={label}
            draggable={false}
            className="absolute inset-0 m-auto max-h-full max-w-full select-none object-contain transition-transform duration-75"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg)` }}
          />
        </div>
        <p className="px-4 pb-3 text-center text-xs text-white/70">Scroll or use the buttons to zoom, drag to move, double-click to zoom in or out.</p>
      </div>
    </dialog>
  );
}

/** A document: an image that opens the viewer, or a PDF that opens in a new tab. */
function DocumentTile({ document, label, loaded, onOpen, large }: { document: KycReviewDocument; label: string; loaded: Loaded | undefined; onOpen: (src: string, label: string) => void; large?: boolean }) {
  const box = cn('relative grid w-full place-items-center overflow-hidden rounded-xl border border-line bg-canvas', large ? 'aspect-[4/3]' : 'aspect-square');
  let body: ReactNode;
  if (loaded?.failed) body = <div className={box}><p className="p-3 text-center text-sm text-red-700">Could not load this file.</p></div>;
  else if (!loaded?.url) body = <div className={cn(box, 'animate-pulse')} aria-label={`Loading ${label}`} />;
  else if (isImage(document)) {
    const src = loaded.url;
    body = (
      <button type="button" className={cn(box, 'cursor-zoom-in')} onClick={() => onOpen(src, label)} aria-label={`Open ${label}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a private document held only as an object URL */}
        <img src={src} alt="" className="size-full object-contain" />
      </button>
    );
  } else {
    body = (
      <a href={loaded.url} target="_blank" rel="noopener noreferrer" className={cn(box, 'gap-2 text-sm font-semibold text-brand-600 hover:underline')}>
        <span className="grid justify-items-center gap-2 p-3 text-center">
          <FileText className="size-8" aria-hidden />
          Open the PDF
        </span>
      </a>
    );
  }
  return (
    <figure className="min-w-0 space-y-1.5">
      {body}
      <figcaption className="text-xs font-medium text-muted">{label}</figcaption>
    </figure>
  );
}

const applicantType = { customer: 'Store customer', reseller: 'Reseller' } as const;

/**
 * One BitoCard Verify case for a reviewer: who applied, what they typed, any other case with the same ID number, the
 * selfie beside the ID photo, every document and the liveness frames by step. The same view in the admin app and on
 * verify.bitocard.com for registered resellers. `caseLink` renders a link to another case (duplicates).
 */
export function KycCaseView({ kase, fetchDocument, caseLink }: { kase: KycReviewCase; fetchDocument: KycDocumentFetcher; caseLink?: (id: string) => ReactNode }) {
  const loaded = useKycDocuments(kase.documents, fetchDocument);
  const [viewing, setViewing] = useState<{ src: string; label: string } | null>(null);
  const open = (src: string, label: string) => setViewing({ src, label });
  const find = (kind: string) => kase.documents.find(document => document.kind === kind);
  const selfie = find('selfie');
  const front = find('id_front');
  const others = kase.documents.filter(document => !/^liveness_/.test(document.kind) && document.kind !== 'selfie');
  const liveness = kycLivenessGroups(kase.documents, kase.liveness?.steps);

  return (
    <div className="space-y-6">
      {kase.duplicates.length ? (
        <Notice tone="amber" title="The same ID number is on another case">
          <ul className="mt-1 space-y-1">
            {kase.duplicates.map(duplicate => (
              <li key={duplicate.case_id} className="flex flex-wrap items-center gap-2">
                <AlertTriangle className="size-4" aria-hidden />
                {caseLink ? caseLink(duplicate.case_id) : <span className="font-mono text-xs">{duplicate.case_id}</span>}
                <StatusBadge status={duplicate.status} label={kycStatusLabels[duplicate.status]} />
                <span className="text-xs">{`started ${formatDate(duplicate.created_at)}`}</span>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {kase.duplicates_elsewhere ? (
        <Notice tone="amber" title="ID number seen elsewhere">{`The same ID number is on ${kase.duplicates_elsewhere} other ${kase.duplicates_elsewhere === 1 ? "check" : "checks"} at other stores.`}</Notice>
      ) : null}
      {kase.purged ? <Notice tone="grey" title="Documents deleted">This case’s documents were deleted under the retention rules. Its details and decision are kept.</Notice> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Applicant"
            description={`${applicantType[kase.applicant.type]}${kase.kind === 'kyb' ? ' · business check' : ''}`}
            actions={
              <span className="flex flex-wrap items-center gap-2">
                {kase.mode === 'test' ? <Badge tone="amber">Test</Badge> : null}
                <StatusBadge status={kase.status} label={kycStatusLabels[kase.status]} />
              </span>
            }
          />
          <div className="p-5 sm:p-6">
            <KeyValue
              items={[
                { label: 'Name', value: kase.applicant.name },
                { label: 'Email', value: kase.applicant.email ? <span className="break-all">{kase.applicant.email}</span> : '—' },
                ...(kase.store ? [{ label: 'Store', value: `${kase.store.name} (${kase.store.subdomain})` }] : []),
                { label: kase.subject === 'reseller' ? 'Business' : 'Seller', value: kase.reseller.name },
                { label: 'Country', value: kase.country },
                { label: 'Reviewed by', value: kase.reviewer === 'reseller' ? 'The store’s business' : productName() },
                { label: 'Submitted', value: formatDateTime(kase.submitted_at) },
                ...(kase.decided_at ? [{ label: 'Decided', value: `${formatDateTime(kase.decided_at)}${kase.decided_by ? ` by ${kase.decided_by.name} (${kase.decided_by.realm === 'admin' ? productName() : 'the store’s business'})` : ''}` }] : []),
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Identity" description="As the applicant typed it. Compare it with the document." />
          <div className="space-y-5 p-5 sm:p-6">
            {kase.identity ? (
              <KeyValue
                items={[
                  { label: 'Full name on the ID', value: kase.identity.full_name },
                  { label: 'Date of birth', value: formatDate(kase.identity.date_of_birth) },
                  { label: 'ID type', value: kase.identity.id_type_label },
                  { label: 'ID number', value: <span className="font-mono">{kase.identity.id_number}</span> },
                  ...(kase.verified_name ? [{ label: 'Verified name', value: kase.verified_name }] : []),
                ]}
              />
            ) : (
              <p className="text-sm text-muted">No ID details yet.</p>
            )}
            {kase.kind === 'kyb' ? (
              kase.business_type === 'registered' && kase.business ? (
                <KeyValue
                  items={[
                    { label: 'Business', value: 'Registered' },
                    { label: 'Registered name', value: kase.business.registered_name },
                    { label: 'Registration number', value: <span className="font-mono">{kase.business.registration_number}</span> },
                    { label: 'Business address', value: kase.business.business_address },
                  ]}
                />
              ) : (
                <KeyValue items={[{ label: 'Business', value: kase.business_type === 'unregistered' ? 'Unregistered: personal check only' : 'Not chosen yet' }]} />
              )
            ) : null}
          </div>
        </Card>
      </div>

      {kase.status !== 'submitted' && (kase.reason || kase.note || kase.resubmit_items.length) ? (
        <Card>
          <CardHeader title="Decision" />
          <div className="space-y-2 p-5 text-sm sm:p-6">
            {kase.reason ? <p>{`Reason: ${kycDeclineReasons[kase.reason as KycDeclineReason] ?? kase.reason}`}</p> : null}
            {kase.resubmit_items.length ? <p>{`Asked to redo: ${kase.resubmit_items.map(item => kycItemLabels[item] ?? item).join(', ')}`}</p> : null}
            {kase.note ? <p className="whitespace-pre-line text-muted">{`Note to the applicant: ${kase.note}`}</p> : null}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Face" description="The selfie beside the photo on the ID. Do they show the same person?" />
        <div className="grid grid-cols-2 gap-4 p-5 sm:p-6">
          {selfie ? <DocumentTile document={selfie} label="Selfie" loaded={loaded[selfie.id]} onOpen={open} large /> : <p className="text-sm text-muted">No selfie.</p>}
          {front ? <DocumentTile document={front} label="Front of the ID" loaded={loaded[front.id]} onOpen={open} large /> : <p className="text-sm text-muted">No ID photo.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Documents" description="Select an image to zoom, move or rotate it. PDFs open in a new tab." />
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 sm:p-6 lg:grid-cols-4">
          {others.length ? others.map(document => <DocumentTile key={document.id} document={document} label={kycDocumentLabel(document.kind)} loaded={loaded[document.id]} onOpen={open} />) : <p className="text-sm text-muted">No documents.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Liveness" description="Frames taken a moment apart while the applicant followed each instruction. Check the movement is real and it is the same face." />
        <div className="space-y-5 p-5 sm:p-6">
          {liveness.length ? (
            liveness.map(group => (
              <section key={group.step} className="space-y-2">
                <h3 className="text-sm font-semibold">{`${group.step + 1}. ${group.label}`}</h3>
                <div className="grid grid-cols-3 gap-3">
                  {group.frames.map(document => (
                    <DocumentTile key={document.id} document={document} label={kycDocumentLabel(document.kind, kase.liveness?.steps)} loaded={loaded[document.id]} onOpen={open} />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <p className="text-sm text-muted">No liveness frames.</p>
          )}
        </div>
      </Card>

      {viewing ? <ImageViewer src={viewing.src} label={viewing.label} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}

/** Whether a case can be decided now: submitted cases, and (for admins, overriding) any decided one. */
export function kycCanDecide(kase: Pick<KycReviewCase, 'status'>, options: { override?: boolean } = {}) {
  if (kase.status === 'submitted') return true;
  return Boolean(options.override) && (kase.status === 'approved' || kase.status === 'declined' || kase.status === 'resubmit');
}

/**
 * Approve (with the verified name, from the name on the ID), decline (a reason and an optional note to the applicant)
 * or ask to resubmit (what to redo and a note). Each asks for confirmation; the API's error stays in the dialog.
 */
export function KycCaseActions({ kase, onDecide, override }: { kase: KycReviewCase; onDecide: (decision: KycDecision) => Promise<unknown>; override?: boolean }) {
  const id = useId();
  const [dialog, setDialog] = useState<'approve' | 'decline' | 'resubmit' | null>(null);
  const [name, setName] = useState(kase.verified_name ?? kase.identity?.full_name ?? kase.applicant.name);
  const [reason, setReason] = useState<KycDeclineReason>('document_unreadable');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<string[]>([]);
  const close = () => {
    setDialog(null);
    setNote('');
    setItems([]);
  };
  if (!kycCanDecide(kase, { override })) return null;
  const decided = kase.status !== 'submitted';

  return (
    <div className="space-y-3">
      {decided ? <Notice tone="amber">{`This case was already decided${kase.decided_by ? ` by ${kase.decided_by.name}` : ''}. A new decision replaces it.`}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDialog('approve')}>Approve</Button>
        <Button variant="secondary" onClick={() => setDialog('resubmit')}>
          Ask to resubmit
        </Button>
        <Button variant="danger" onClick={() => setDialog('decline')}>
          Decline
        </Button>
      </div>

      <ActionDialog
        open={dialog === 'approve'}
        onClose={close}
        title="Approve this check"
        description="Only approve when the documents are genuine, the details match and the selfie and liveness frames show the same living person as the ID."
        confirmLabel="Approve"
        requireReason={false}
        onConfirm={async () => {
          if (!name.trim()) throw new Error('Enter the verified name.');
          await onDecide({ action: 'approve', verified_name: name });
        }}
      >
        <Field label="Verified name" htmlFor={`${id}-name`} hint="As it appears on the ID. Payout accounts must match it.">
          <Input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} maxLength={200} />
        </Field>
      </ActionDialog>

      <ActionDialog
        open={dialog === 'decline'}
        onClose={close}
        title="Decline this check"
        description="The applicant is told the reason and your note."
        confirmLabel="Decline"
        tone="danger"
        requireReason={false}
        onConfirm={() => onDecide({ action: 'decline', reason, note })}
      >
        <Field label="Reason" htmlFor={`${id}-reason`}>
          <Select id={`${id}-reason`} value={reason} onChange={event => setReason(event.target.value as KycDeclineReason)}>
            {Object.entries(kycDeclineReasons).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note to the applicant (optional)" htmlFor={`${id}-decline-note`}>
          <Textarea id={`${id}-decline-note`} value={note} onChange={event => setNote(event.target.value)} maxLength={500} />
        </Field>
      </ActionDialog>

      <ActionDialog
        open={dialog === 'resubmit'}
        onClose={close}
        title="Ask to resubmit"
        description="The applicant redoes only what you tick; everything else is kept."
        confirmLabel="Ask to resubmit"
        requireReason={false}
        onConfirm={async () => {
          if (!items.length) throw new Error('Tick what the applicant should redo.');
          if (note.trim().length < 5) throw new Error('Tell the applicant what to fix (at least 5 characters).');
          await onDecide({ action: 'resubmit', items, note });
        }}
      >
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">What to redo</legend>
          {kase.required
            .filter(item => item !== 'consent')
            .map(item => (
              <label key={item} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-brand-500"
                  checked={items.includes(item)}
                  onChange={event => setItems(current => (event.target.checked ? [...current, item] : current.filter(value => value !== item)))}
                />
                {kycItemLabels[item] ?? item}
              </label>
            ))}
        </fieldset>
        <Field label="Note to the applicant" htmlFor={`${id}-resubmit-note`} hint="Say what was wrong, for example “The photo of the front of your ID is blurred.”">
          <Textarea id={`${id}-resubmit-note`} value={note} onChange={event => setNote(event.target.value)} maxLength={500} />
        </Field>
      </ActionDialog>
    </div>
  );
}
