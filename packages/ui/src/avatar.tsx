"use client";

import { useEffect, useId, useRef, useState } from "react";
import { type SquareFit, squareImage } from "./image";

/** Up to two initials from a name ("Chinedu O." is CO; "Ada" is A). */
export function avatarInitials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)![0]}` : words[0][0]).toUpperCase();
}

/**
 * Someone's profile photo, round, or their initials on navy when they have none (or it fails to load). Decorative by
 * default (`alt=""`): their name is always written beside it.
 */
export function Avatar({ name, url, className = "size-10 text-sm", label }: { name: string; url?: string | null; className?: string; label?: string }) {
  // The address that failed to load, so a new one is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = Boolean(url) && failedUrl === url;
  const shape = `inline-grid shrink-0 place-items-center overflow-hidden rounded-full ${className}`;
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element -- people's photos come from the media CDN, already sized.
    return <img src={url} alt={label ?? ""} onError={() => setFailedUrl(url)} className={`${shape} bg-white object-cover`} />;
  }
  return (
    <span className={`${shape} bg-navy-900 font-bold text-white`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {avatarInitials(name)}
    </span>
  );
}

/** Saving a prepared photo (the app sends it to storage and sets it) and taking it off. Errors are shown as written. */
export type AvatarEditorActions = { upload: (photo: Blob, filename: string) => Promise<void>; remove: () => Promise<void> };

const accepted = "image/png,image/jpeg,image/webp";

/**
 * Choosing a profile photo: a face, a logo or an icon. The picture is shown as it will look (cropped to a circle, or
 * the whole of it for a logo), made square, upright and small in the browser, then saved; it can be taken off again.
 */
export function AvatarEditor({ name, url, actions, disabled, note }: { name: string; url: string | null; actions: AvatarEditorActions; disabled?: string | null; note?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const fitId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fit, setFit] = useState<SquareFit>("cover");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // The chosen picture's address on this device, let go when another is chosen or the editor closes.
  const previewRef = useRef<string | null>(null);
  const showPreview = (chosen: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = chosen ? URL.createObjectURL(chosen) : null;
    setPreview(previewRef.current);
  };
  useEffect(() => () => void (previewRef.current && URL.revokeObjectURL(previewRef.current)), []);

  const choose = (chosen: File | undefined) => {
    setError(null);
    setDone(null);
    if (!chosen) return;
    if (!accepted.split(",").includes(chosen.type)) return setError("Choose a JPEG, PNG or WebP picture.");
    if (chosen.size > 20 * 1024 * 1024) return setError("That picture is too large. Choose one under 20 MB.");
    setFit(chosen.type === "image/png" ? "contain" : "cover");
    setFile(chosen);
    showPreview(chosen);
  };

  const save = async () => {
    if (!file) return;
    setBusy("save");
    setError(null);
    try {
      const photo = await squareImage(file, fit);
      await actions.upload(photo, `${file.name.replace(/\.[^.]+$/, "") || "photo"}.${photo.type === "image/png" ? "png" : "jpg"}`);
      setFile(null);
      showPreview(null);
      setDone("Your photo is saved.");
      if (input.current) input.current.value = "";
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The photo could not be saved. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError(null);
    try {
      await actions.remove();
      setDone("Your photo was taken off. Your initials show instead.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The photo could not be taken off. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-4">
        {preview ? (
          <span className={`inline-grid size-24 shrink-0 place-items-center overflow-hidden rounded-full bg-white ring-1 ring-navy-200`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a picture chosen on this device, shown before upload. */}
            <img src={preview} alt="Your new photo" className={`size-full ${fit === "cover" ? "object-cover" : "object-contain"}`} />
          </span>
        ) : (
          <Avatar name={name} url={url} className="size-24 text-3xl ring-1 ring-navy-200" label={url ? "Your photo" : undefined} />
        )}
        <div className="grid min-w-0 flex-1 gap-2">
          <p className="text-sm text-navy-600">{note ?? "A photo of you, or your logo or icon. It shows wherever your name does."}</p>
          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-navy-200 bg-white px-3.5 text-sm font-semibold text-navy-900 hover:border-navy-400 has-disabled:cursor-not-allowed has-disabled:opacity-60`}>
              {url || preview ? "Choose another" : "Choose a photo"}
              <input ref={input} type="file" accept={accepted} className="sr-only" disabled={Boolean(disabled) || busy !== null} onChange={event => choose(event.target.files?.[0])} />
            </label>
            {file ? (
              <button type="button" onClick={() => void save()} disabled={busy !== null} className="inline-flex min-h-10 items-center rounded-xl bg-navy-900 px-3.5 text-sm font-bold text-white disabled:opacity-60">
                {busy === "save" ? "Saving…" : "Save photo"}
              </button>
            ) : null}
            {file ? (
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  showPreview(null);
                  if (input.current) input.current.value = "";
                }}
                disabled={busy !== null}
                className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold text-navy-600 hover:text-navy-900"
              >
                Cancel
              </button>
            ) : url ? (
              <button type="button" onClick={() => void remove()} disabled={busy !== null} className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold text-brand-700 hover:underline disabled:opacity-60">
                {busy === "remove" ? "Taking it off…" : "Remove photo"}
              </button>
            ) : null}
          </div>
          {file ? (
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <legend className="sr-only">How it fills the circle</legend>
              <label className="inline-flex min-h-9 items-center gap-2" htmlFor={`${fitId}-cover`}>
                <input id={`${fitId}-cover`} type="radio" name={fitId} checked={fit === "cover"} onChange={() => setFit("cover")} className="size-4 accent-navy-900" /> Fill the circle (a face)
              </label>
              <label className="inline-flex min-h-9 items-center gap-2" htmlFor={`${fitId}-contain`}>
                <input id={`${fitId}-contain`} type="radio" name={fitId} checked={fit === "contain"} onChange={() => setFit("contain")} className="size-4 accent-navy-900" /> Show all of it (a logo)
              </label>
            </fieldset>
          ) : null}
        </div>
      </div>
      {disabled ? <p className="text-sm text-navy-600">{disabled}</p> : null}
      {error ? (
        <p className="text-sm text-brand-700" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="text-sm text-mint-700" role="status">
          {done}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Sends a prepared photo to storage with the signed link the API gave (no cookies, only its headers), the way every
 * upload goes. Throws a message to show when storage refuses it.
 */
export async function sendToStorage(upload: { method: "PUT"; url: string; headers: Record<string, string> }, photo: Blob) {
  let res: Response;
  try {
    res = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: photo, credentials: "omit" });
  } catch {
    throw new Error("The photo could not be sent to storage. If your connection is fine, storage does not accept uploads from this site yet: its CORS rule must allow this address.");
  }
  if (!res.ok) throw new Error(res.status === 403 ? "The upload link was refused or has expired. Try again." : "The photo could not be uploaded. Check your connection and try again.");
}
