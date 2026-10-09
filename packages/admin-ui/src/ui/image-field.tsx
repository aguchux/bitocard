'use client';

import { type DragEvent, useId, useRef, useState } from 'react';
import { ImagePlus, Images, LoaderCircle, Trash2 } from 'lucide-react';
import { type MediaAsset, type MediaPurpose, type MediaRealm, useMediaLibraryQuery, useMediaSettingsQuery, useMediaUpload } from '@bitocard/api-client';
import { cn, errorMessage } from '../format';
import { Dialog } from './data';
import { useDebouncedValue } from './hooks';
import { Button, Input } from './primitives';

const https = /^https:\/\/\S+$/;
const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${bytes / (1024 * 1024)} MB` : `${Math.round(bytes / 1024)} KB`);
const typeLabel = (type: string) => ({ 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/svg+xml': 'SVG' })[type] ?? type;

export type ImageFieldProps = {
  label: string;
  /** The saved address, or '' for none. */
  value: string;
  onChange: (url: string) => void;
  /** Whose storage (admin app or SHQ) and what the image is for; decides the folder, types and size limit. */
  realm: MediaRealm;
  purpose: MediaPurpose;
  /** The brand slug, product key, supplier code or category the image belongs to, for purposes that need one. */
  targetId?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  /** Logos and icons are square; card art and banners are wide. */
  shape?: 'square' | 'wide';
};

/** Reusing a file already uploaded for the same purpose (brands often share card art). */
function LibraryDialog({ realm, purpose, onPick, onClose }: { realm: MediaRealm; purpose: MediaPurpose; onPick: (asset: MediaAsset) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim());
  const library = useMediaLibraryQuery({ realm, purpose, q: search || undefined, limit: 60 });
  return (
    <Dialog open onClose={onClose} title="Choose an uploaded image" description="Files uploaded before for the same use.">
      <div className="space-y-3">
        <Input type="search" aria-label="Search files" placeholder="Search by file or folder name…" value={q} onChange={event => setQ(event.target.value)} />
        {/* The last files found stay on screen while a new search or a refresh runs. */}
        {!library.data && library.error ? (
          <p className="text-sm text-red-700" role="alert">
            {errorMessage(library.error)}
          </p>
        ) : !library.data ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !library.data.data.length ? (
          <p className="text-sm text-muted">Nothing uploaded yet.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {library.data.data.map(asset => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => onPick(asset)}
                  className="group flex w-full flex-col gap-1 rounded-xl border border-line p-1.5 text-left hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500"
                  title={asset.filename}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- files on the storage CDN */}
                  <img src={asset.url} alt="" className="aspect-square w-full rounded-lg bg-canvas object-contain" loading="lazy" />
                  <span className="truncate text-xs text-muted">{asset.filename}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

/**
 * An image setting: upload a file (button or drag and drop) or reuse one from the library. Uploads go straight to
 * storage with a signed link and are checked by the API before their address is used. The stored file's address is
 * never shown or typed here (only the preview); until file storage is set up the field says so.
 */
export function ImageField({ label, value, onChange, realm, purpose, targetId, hint, error, disabled, shape = 'square' }: ImageFieldProps) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const settings = useMediaSettingsQuery(realm);
  const upload = useMediaUpload(realm);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [library, setLibrary] = useState(false);

  const rules = settings.data?.purposes.find(item => item.purpose === purpose);
  const canUpload = Boolean(settings.data?.configured && rules) && !disabled;
  const address = value.trim();
  const invalid = Boolean(address) && !https.test(address);
  const shown = error ?? problem;

  async function send(file: File | undefined) {
    if (!file || !rules) return;
    setProblem(null);
    if (!rules.content_types.includes(file.type)) {
      setProblem(`Choose a ${rules.content_types.map(typeLabel).join(', ')} image.`);
      return;
    }
    if (file.size > rules.max_bytes) {
      setProblem(`The image is too large: at most ${sizeLabel(rules.max_bytes)}.`);
      return;
    }
    setBusy(true);
    try {
      const asset = await upload(file, { purpose, ...(targetId ? { target_id: targetId } : {}) });
      onChange(asset.url);
    } catch (failure) {
      setProblem(errorMessage(failure, 'The image could not be uploaded. Try again.'));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (canUpload && !busy) void send(event.dataTransfer.files[0]);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p id={`${id}-label`} className="text-sm font-semibold text-ink">
        {label}
      </p>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className={cn('flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line p-3', dragging && 'border-brand-500 bg-brand-50')}
        onDragOver={event => {
          if (!canUpload) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        data-testid="image-drop"
      >
        <div className={cn('grid shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-canvas', shape === 'square' ? 'size-16' : 'h-16 w-28')}>
          {busy ? (
            <LoaderCircle className="size-5 animate-spin text-muted" aria-label="Uploading" />
          ) : address && !invalid ? (
            // eslint-disable-next-line @next/next/no-img-element -- uploaded files and outside addresses the image optimiser is not set up for
            <img src={address} alt={`${label} preview`} className={cn('size-full', shape === 'square' ? 'object-contain p-1' : 'object-cover')} />
          ) : (
            <ImagePlus className="size-5 text-subtle" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          {canUpload ? (
            <>
              <Button type="button" variant="secondary" size="sm" icon={<ImagePlus className="size-4" aria-hidden />} loading={busy} onClick={() => fileInput.current?.click()}>
                {address ? 'Replace' : 'Upload'}
              </Button>
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-label={`${label} file`}
                accept={rules?.content_types.join(',')}
                onChange={event => void send(event.target.files?.[0])}
              />
              <Button type="button" variant="ghost" size="sm" icon={<Images className="size-4" aria-hidden />} disabled={busy} onClick={() => setLibrary(true)}>
                Library
              </Button>
            </>
          ) : null}
          {address && !disabled ? (
            <Button type="button" variant="ghost" size="sm" icon={<Trash2 className="size-4" aria-hidden />} disabled={busy} onClick={() => onChange('')}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {shown ? (
        <p className="text-sm text-red-700" role="alert">
          {shown}
        </p>
      ) : (
        <p className="text-xs text-muted">
          {[
            hint,
            rules && canUpload ? `${rules.content_types.map(typeLabel).join(', ')}, up to ${sizeLabel(rules.max_bytes)}.` : null,
            settings.data && !settings.data.configured && !disabled ? 'Uploads start once file storage is set up (Settings > Integrations > File storage).' : null,
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}
      {library ? (
        <LibraryDialog
          realm={realm}
          purpose={purpose}
          onClose={() => setLibrary(false)}
          onPick={asset => {
            onChange(asset.url);
            setLibrary(false);
          }}
        />
      ) : null}
    </div>
  );
}
