"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, X } from "lucide-react";
import { sendToStorage } from "@bitocard/ui/avatar";
import { coverImage } from "@bitocard/ui/image";
import { AvatarForm } from "@/components/account/avatar-form";
import { removeBanner, setBanner, startBannerUpload } from "@/lib/avatar-actions";

const accepted = "image/png,image/jpeg,image/webp";

/** A sheet over the page: from the bottom on phones, centred above (a native modal dialog: Escape closes it). */
function Sheet({ dialog, title, children, onClose }: { dialog: React.RefObject<HTMLDialogElement | null>; title: string; children: React.ReactNode; onClose?: () => void }) {
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      onClose={onClose}
      className="sheet m-0 mt-auto w-full max-w-none rounded-t-3xl bg-white p-0 text-navy-900 sm:m-auto sm:max-w-lg sm:rounded-3xl"
      onClick={event => event.target === event.currentTarget && event.currentTarget.close()}
    >
      <div className="grid gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={() => dialog.current?.close()} className="grid size-10 place-items-center rounded-full hover:bg-navy-50" aria-label="Close">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/**
 * On the seller's own page: **Change photo** over their avatar, opening the profile photo editor (a face, a logo or an
 * icon) in place, saved everywhere they are shown.
 */
export function PhotoButton({ name, url }: { name: string; url: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="absolute right-0 bottom-0 grid size-9 place-items-center rounded-full bg-navy-900 text-white shadow-md ring-2 ring-white hover:bg-navy-700"
        aria-label={url ? "Change your photo or logo" : "Add a photo or logo"}
        title={url ? "Change your photo or logo" : "Add a photo or logo"}
      >
        <Camera className="size-4" aria-hidden="true" />
      </button>
      <Sheet dialog={dialog} title="Your photo or logo">
        <AvatarForm name={name} url={url} />
      </Sheet>
    </>
  );
}

/** Which way a picture of this shape moves inside the 4:1 cover: up and down for most, sideways for a very wide one. */
export const coverAxis = (width: number, height: number) => (height > 0 && width / height > 4 ? "x" : "y");

/**
 * On the seller's own page: **Edit cover** on the banner. Choose a picture, slide it to the part that shows (it is cut to
 * 4:1, as wide as the page), save it (made 1600 × 400 at most in the browser, sent straight to storage, then checked by
 * Udozo), or take it off so Udozo's own banner shows again.
 */
export function CoverButton({ url }: { url: string | null }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [axis, setAxis] = useState<"x" | "y">("y");
  const [focus, setFocus] = useState(50);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The chosen picture's address on this device, let go when another is chosen or the editor closes.
  const previewRef = useRef<string | null>(null);
  const showPreview = (chosen: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = chosen ? URL.createObjectURL(chosen) : null;
    setPreview(previewRef.current);
  };
  useEffect(() => () => void (previewRef.current && URL.revokeObjectURL(previewRef.current)), []);

  const reset = () => {
    setFile(null);
    showPreview(null);
    setFocus(50);
    setError(null);
    if (input.current) input.current.value = "";
  };

  const choose = (chosen: File | undefined) => {
    setError(null);
    if (!chosen) return;
    if (!accepted.split(",").includes(chosen.type)) return setError("Choose a JPEG, PNG or WebP picture.");
    if (chosen.size > 20 * 1024 * 1024) return setError("That picture is too large. Choose one under 20 MB.");
    setFocus(50);
    setFile(chosen);
    showPreview(chosen);
  };

  const save = async () => {
    if (!file) return;
    setBusy("save");
    setError(null);
    try {
      const cover = await coverImage(file, focus / 100);
      const link = await startBannerUpload({ filename: `${file.name.replace(/\.[^.]+$/, "") || "cover"}.jpg`, content_type: cover.type, size: cover.size });
      if (!link.ok) throw new Error(link.message);
      await sendToStorage(link.data.upload, cover);
      const set = await setBanner(link.data.id);
      if (!set.ok) throw new Error(set.message);
      reset();
      dialog.current?.close();
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The cover could not be saved. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError(null);
    try {
      const result = await removeBanner();
      if (!result.ok) throw new Error(result.message);
      dialog.current?.close();
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The cover could not be taken off. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const shown = preview ?? url;
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="absolute top-3 right-3 z-10 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/90 px-3.5 text-sm font-semibold text-navy-900 shadow-sm backdrop-blur hover:bg-white"
      >
        <ImagePlus className="size-4" aria-hidden="true" /> {url ? "Edit cover" : "Add a cover"}
      </button>
      <Sheet dialog={dialog} title="Your page's cover" onClose={reset}>
        <p className="text-sm text-navy-600">A wide picture across the top of your page: your shop, your goods or your logo. It is cut to fit, about four times as wide as it is tall.</p>
        <div className="relative aspect-[4/1] overflow-hidden rounded-2xl bg-gradient-to-br from-navy-900 via-navy-700 to-brand-600 ring-1 ring-navy-200">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- the saved cover, or a picture chosen on this device before upload.
            <img
              src={shown}
              alt={preview ? "Your new cover" : "Your cover"}
              className="size-full object-cover"
              style={preview ? { objectPosition: axis === "x" ? `${focus}% 50%` : `50% ${focus}%` } : undefined}
              onLoad={event => preview && setAxis(coverAxis(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight))}
            />
          ) : (
            <span className="grid size-full place-items-center text-sm font-semibold text-white/80">Udozo&apos;s banner</span>
          )}
        </div>
        {file ? (
          <label className="grid gap-1.5 text-sm font-semibold">
            {axis === "x" ? "Move it left or right" : "Move it up or down"}
            <input type="range" min={0} max={100} value={focus} onChange={event => setFocus(Number(event.target.value))} className="h-2 w-full cursor-pointer accent-navy-900" />
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-navy-200 bg-white px-3.5 text-sm font-semibold hover:border-navy-400 has-disabled:cursor-not-allowed has-disabled:opacity-60">
            {shown ? "Choose another" : "Choose a picture"}
            <input ref={input} type="file" accept={accepted} className="sr-only" disabled={busy !== null} onChange={event => choose(event.target.files?.[0])} />
          </label>
          {file ? (
            <button type="button" onClick={() => void save()} disabled={busy !== null} className="inline-flex min-h-11 items-center rounded-xl bg-navy-900 px-4 text-sm font-bold text-white disabled:opacity-60">
              {busy === "save" ? "Saving…" : "Save cover"}
            </button>
          ) : null}
          {file ? (
            <button type="button" onClick={reset} disabled={busy !== null} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-navy-600 hover:text-navy-900">
              Cancel
            </button>
          ) : url ? (
            <button type="button" onClick={() => void remove()} disabled={busy !== null} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-brand-700 hover:underline disabled:opacity-60">
              {busy === "remove" ? "Taking it off…" : "Remove cover"}
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-brand-700">
            {error}
          </p>
        ) : null}
      </Sheet>
    </>
  );
}
