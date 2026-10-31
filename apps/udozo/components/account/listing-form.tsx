"use client";

/* eslint-disable @next/next/no-img-element -- the seller's own photos: local previews, then the media CDN. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bold, Camera, Check, ChevronLeft, Italic, List, ListOrdered, LoaderCircle, Search, Trash2, Video, X } from "lucide-react";
import {
  conditionLabels,
  contactLabels,
  descriptionBlocks,
  type ShopCategory,
  type ShopCondition,
  type ShopContact,
  type ShopDelivery,
  type ShopFeature,
  type ShopMyListing,
  type ShopPriceKind,
  type ShopResaleAvailability,
  type ShopState,
  type ShopTopCategory,
} from "@bitocard/api-client/classifieds";
import { compressImage } from "@bitocard/ui/image";
import { featureValue, fromMinor, toMinor, toggleList, wrapSelection } from "@/lib/shop";
import { TermsAccept } from "@/components/terms-accept";
import { acceptShopTerms, createListing, type ListingFields, loadListing, removeMedia, reorderPhotos, searchFeatures, shopTerms, submitListing, suggestFeature, updateListing, videoUploadUrl } from "@/lib/shop-actions";
import { type DraftPick, FillFromPhotos, ImproveListing, SuggestPrice } from "./assistant-help";
import { ShopIcon } from "./icon";
import { ResaleFields, resaleChanges, type SellWhere, sellWhereFrom } from "./resale-fields";

const maxPhotos = 12;
const maxVideoBytes = 50 * 1024 * 1024;
const maxDescription = 5000;
const maxFeatures = 20;
const saveAfterMs = 700;

type FeatureDef = Pick<ShopFeature, "key" | "name" | "icon" | "data_type" | "unit" | "choices" | "placeholder" | "default_value">;
type FeatureRow = FeatureDef & { value: string | boolean };
type Photo = { key: string; id: string | null; url: string; status: "uploading" | "ready" | "failed"; error?: string };
type VideoState = { id: string | null; status: "uploading" | "processing" | "ready" | "failed"; progress: number; poster: string | null; error: string | null } | null;

const nonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));

/** A saved feature's definition: the category's suggestion when it has one, else read from the value's type. */
function defFor(feature: ShopMyListing["features"][number], suggested: FeatureDef[]): FeatureDef {
  const known = suggested.find(item => item.key === feature.key);
  if (known) return known;
  const type = typeof feature.value === "boolean" ? "boolean" : typeof feature.value === "number" ? "number" : "text";
  return { key: feature.key, name: feature.name, icon: feature.icon, unit: feature.unit, data_type: type, choices: [], placeholder: null, default_value: null };
}

const rawValue = (value: string | number | boolean | null): string | boolean => (typeof value === "boolean" ? value : value === null ? "" : String(value));

/** The leaf category and the top one above it, by id. */
function findCategory(categories: ShopTopCategory[], id: string | null) {
  for (const top of categories) {
    const child = top.children.find(item => item.id === id);
    if (child) return { top, category: child as ShopCategory };
  }
  return null;
}

function Chips<T extends string>({ label, options, value, onChange, disabled }: { label: string; options: Array<{ value: T; label: string; note?: string }>; value: T | null; onChange: (value: T) => void; disabled?: (value: T) => boolean }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(option => {
          const on = option.value === value;
          const off = disabled?.(option.value) ?? false;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              disabled={off}
              onClick={() => onChange(option.value)}
              className={`h-10 rounded-full border px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-navy-900 hover:border-slate-400"}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Post an ad (`/sell`) and editing one (`/account/listings/<id>`), one screen on a phone as on the design canvas's
 * Post board: photos and video first, then title, category, price and condition, features from Udozo's
 * registry, the description with its small toolbar, then location, delivery and contact. The draft is made on the
 * seller's first change and every change after it is saved as they go; photos upload while they type (scaled to 1600 px
 * JPEG here first), and the video goes from the browser straight to the API with a 15-minute link. Where the country's
 * shop assistant helps sellers: Fill from photos, Suggest a price and Improve this listing, each for the seller to accept.
 */
export function ListingForm({
  listing,
  categories,
  states,
  currency,
  phoneConfirmed,
  minPhotos,
  assistant = null,
  resale = null,
}: {
  listing: ShopMyListing | null;
  categories: ShopTopCategory[];
  states: ShopState[];
  currency: string;
  phoneConfirmed: boolean;
  minPhotos: number;
  assistant?: { name: string } | null;
  /** Whether the seller can open listings to resellers, and Udozo's limits (null: not known). */
  resale?: ShopResaleAvailability | null;
}) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(listing?.id ?? null);
  const status = listing?.status ?? "draft";
  const [title, setTitle] = useState(listing?.title ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(listing?.category?.id ?? null);
  const [priceKind, setPriceKind] = useState<ShopPriceKind>(listing?.price.kind ?? "fixed");
  const [price, setPrice] = useState(fromMinor(listing?.price.amount ?? null));
  const [condition, setCondition] = useState<ShopCondition | null>(listing?.condition ?? null);
  const [delivery, setDelivery] = useState<ShopDelivery>(listing?.delivery ?? "none");
  const [pickup, setPickup] = useState(listing?.pickup ?? true);
  const [feeState, setFeeState] = useState(listing?.delivery_fees.within_state ? fromMinor(listing.delivery_fees.within_state) : "");
  const [feeNation, setFeeNation] = useState(listing?.delivery_fees.nationwide ? fromMinor(listing.delivery_fees.nationwide) : "");
  const [contact, setContact] = useState<ShopContact>(listing?.contact ?? "chat");
  const [stateSlug, setStateSlug] = useState<string>(listing?.area?.state?.slug ?? "");
  const [areaId, setAreaId] = useState<string | null>(listing?.area?.id ?? null);
  const [description, setDescription] = useState(listing?.description ?? "");
  const [sellWhere, setSellWhere] = useState<SellWhere>(() => sellWhereFrom(listing, resale));
  const found = findCategory(categories, categoryId);
  const suggested = useMemo<FeatureDef[]>(() => found?.category.features ?? [], [found?.category.features]);
  const [features, setFeatures] = useState<FeatureRow[]>(() => (listing?.features ?? []).map(feature => ({ ...defFor(feature, findCategory(categories, listing?.category?.id ?? null)?.category.features ?? []), value: rawValue(feature.value) })));
  const [photos, setPhotos] = useState<Photo[]>(() => (listing?.photos ?? []).map(photo => ({ key: photo.id, id: photo.id, url: photo.url, status: photo.status === "failed" ? "failed" : "ready" })));
  const [video, setVideo] = useState<VideoState>(() => (listing?.video ? { id: listing.video.id, status: listing.video.status, progress: 100, poster: listing.video.poster_url, error: listing.video.failure_reason } : null));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(listing ? "saved" : "idle");
  const [problem, setProblem] = useState<{ message: string; param: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Saving: changed fields gather in `pending` and go in one request after a pause; requests run one at a time.
  const idRef = useRef(id);
  const pending = useRef<ListingFields>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = chain.current.then(async () => {
      const changes = pending.current;
      if (idRef.current && !Object.keys(changes).length) return;
      pending.current = {};
      setSaveState("saving");
      const result = idRef.current ? await updateListing(idRef.current, changes) : await createListing(changes, nonce());
      if (!result.ok) {
        setSaveState("error");
        setProblem({ message: result.message, param: result.param });
        return;
      }
      setProblem(null);
      setSaveState("saved");
      if (!idRef.current) {
        idRef.current = result.data.id;
        setId(result.data.id);
        // A reload carries on with this draft.
        window.history.replaceState(null, "", `/account/listings/${result.data.id}`);
      }
    });
    chain.current = next.catch(() => undefined);
    return next;
  }, []);

  const save = useCallback(
    (changes: ListingFields) => {
      pending.current = { ...pending.current, ...changes };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), saveAfterMs);
    },
    [flush],
  );

  /** The listing's id, making the draft first when there is none (photos and the video need one). */
  const ensureDraft = useCallback(async () => {
    if (!idRef.current) await flush();
    return idRef.current;
  }, [flush]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const featureList = (rows: FeatureRow[]) => rows.map(row => ({ key: row.key, value: featureValue(row, row.value) }));
  const updateFeatures = (rows: FeatureRow[]) => {
    setFeatures(rows);
    save({ features: featureList(rows) });
  };

  // ---- Photos ----
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const addPhotos = (files: FileList | null) => {
    const chosen = [...(files ?? [])].slice(0, Math.max(0, maxPhotos - photos.length));
    for (const file of chosen) {
      const key = nonce();
      setPhotos(current => [...current, { key, id: null, url: URL.createObjectURL(file), status: "uploading" }]);
      queue.current = queue.current.then(async () => {
        const fail = (error: string) => setPhotos(current => current.map(photo => (photo.key === key ? { ...photo, status: "failed", error } : photo)));
        try {
          const blob = await compressImage(file, undefined, type => type.startsWith("image/"));
          const listingId = await ensureDraft();
          if (!listingId) return fail("Save the ad first, then add photos.");
          const form = new FormData();
          form.set("file", blob, "photo.jpg");
          const res = await fetch(`/api/account/listings/${listingId}/photos`, { method: "POST", body: form });
          const json = (await res.json().catch(() => null)) as { id?: string; url?: string; error?: { message?: string } } | null;
          if (!res.ok || !json?.id || !json.url) return fail(json?.error?.message ?? "This photo could not be added.");
          setPhotos(current => {
            // The same photo sent twice is one photo.
            if (current.some(photo => photo.id === json.id && photo.key !== key)) return current.filter(photo => photo.key !== key);
            return current.map(photo => (photo.key === key ? { key, id: json.id!, url: json.url!, status: "ready" } : photo));
          });
        } catch {
          fail("This photo could not be added. Try again.");
        }
      });
    }
  };
  const movePhoto = async (from: number, to: number) => {
    if (to < 0 || to >= photos.length || from === to) return;
    const next = [...photos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setPhotos(next);
    const order = next.filter(photo => photo.id && photo.status === "ready").map(photo => photo.id!);
    if (idRef.current && order.length) {
      const result = await reorderPhotos(idRef.current, order);
      if (!result.ok) setProblem({ message: result.message, param: "photos" });
    }
  };
  const dropPhoto = async (photo: Photo) => {
    if (photo.id && idRef.current) {
      const result = await removeMedia(idRef.current, photo.id);
      if (!result.ok) return setProblem({ message: result.message, param: "photos" });
    }
    setPhotos(current => current.filter(item => item.key !== photo.key));
  };
  const dragFrom = useRef<number | null>(null);

  // ---- The video (optional: one being prepared, or one that failed, never holds the ad back) ----
  const sending = useRef<XMLHttpRequest | null>(null);
  const addVideo = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > maxVideoBytes) return setVideo({ id: null, status: "failed", progress: 0, poster: null, error: "Videos can be at most 50 MB." });
    setVideo({ id: null, status: "uploading", progress: 0, poster: null, error: null });
    const listingId = await ensureDraft();
    const link = listingId ? await videoUploadUrl(listingId) : null;
    if (!link?.ok) return setVideo({ id: null, status: "failed", progress: 0, poster: null, error: link && !link.ok ? link.message : "Save the ad first, then add the video." });
    const form = new FormData();
    form.set("file", file, file.name || "video.mp4");
    const request = new XMLHttpRequest();
    sending.current = request;
    request.open("POST", link.data.url);
    request.upload.onprogress = event => event.lengthComputable && setVideo(current => (current ? { ...current, progress: Math.round((event.loaded / event.total) * 100) } : current));
    request.onerror = () => setVideo({ id: null, status: "failed", progress: 0, poster: null, error: "The video could not be sent. Check your connection and try again." });
    request.onload = () => {
      const json = (() => {
        try {
          return JSON.parse(request.responseText) as { id?: string; error?: { message?: string } };
        } catch {
          return null;
        }
      })();
      if (request.status !== 202 || !json?.id) return setVideo({ id: null, status: "failed", progress: 0, poster: null, error: json?.error?.message ?? "The video could not be added." });
      setVideo({ id: json.id, status: "processing", progress: 100, poster: null, error: null });
    };
    request.send(form);
  };
  /** Stops sending the video: the ad is posted without it. */
  const cancelVideo = () => {
    sending.current?.abort();
    sending.current = null;
    setVideo(null);
  };
  // While the video is being prepared, check on it now and then.
  useEffect(() => {
    if (video?.status !== "processing" || !id) return;
    const check = setInterval(async () => {
      if (document.hidden) return;
      const result = await loadListing(id);
      const now = result.ok ? result.data.video : null;
      if (now && now.status !== "processing") setVideo({ id: now.id, status: now.status, progress: 100, poster: now.poster_url, error: now.failure_reason });
    }, 4000);
    return () => clearInterval(check);
  }, [video?.status, id]);
  const dropVideo = async () => {
    if (video?.id && idRef.current) {
      const result = await removeMedia(idRef.current, video.id);
      if (!result.ok) return setProblem({ message: result.message, param: "video" });
    }
    setVideo(null);
  };

  // ---- Posting ----
  const live = status === "active" || status === "pending_review";
  const post = async () => {
    setSubmitting(true);
    setProblem(null);
    await flush();
    await queue.current;
    if (!idRef.current) {
      setSubmitting(false);
      return setProblem({ message: "Add your photos and details first.", param: null });
    }
    if (live) {
      setSubmitting(false);
      router.push("/account");
      return router.refresh();
    }
    const result = await submitListing(idRef.current);
    setSubmitting(false);
    if (!result.ok) return setProblem({ message: result.message, param: result.param });
    router.push(`/account?posted=${result.data.status === "active" ? "live" : "review"}`);
    router.refresh();
  };

  // ---- The shop assistant's suggestions (applied only when the seller accepts them) ----
  /** Everything saved and every photo sent, so a suggestion reads the ad as it is now. */
  const latest = async () => {
    await flush();
    await queue.current;
    return idRef.current;
  };
  const applyDraft = (pick: DraftPick) => {
    const changes: ListingFields = {};
    if (pick.title) {
      setTitle(pick.title);
      changes.title = pick.title;
    }
    const nextCategory = pick.categoryId && findCategory(categories, pick.categoryId) ? pick.categoryId : categoryId;
    if (nextCategory !== categoryId && nextCategory) {
      setCategoryId(nextCategory);
      changes.category_id = nextCategory;
    }
    if (pick.condition) {
      setCondition(pick.condition);
      changes.condition = pick.condition;
    }
    if (pick.description) {
      setDescription(pick.description);
      changes.description = pick.description;
    }
    if (pick.features?.length) {
      const defs = findCategory(categories, nextCategory)?.category.features ?? [];
      const rows = [...features];
      for (const item of pick.features) {
        const at = rows.findIndex(row => row.key === item.key);
        const value = rawValue(item.value);
        if (at >= 0) rows[at] = { ...rows[at]!, value };
        else if (rows.length < maxFeatures) rows.push({ ...defFor({ key: item.key, name: item.name, icon: "tag", unit: null, value: item.value }, defs), value });
      }
      setFeatures(rows);
      changes.features = featureList(rows);
    }
    save(changes);
  };
  const addSuggestedFeature = (key: string) => {
    if (features.some(row => row.key === key) || features.length >= maxFeatures) return;
    const def = suggested.find(item => item.key === key);
    if (def) setFeatures([...features, { ...def, value: def.data_type === "boolean" ? false : (def.default_value ?? "") }]);
  };

  const ready = photos.filter(photo => photo.status === "ready").length;
  const uploading = photos.filter(photo => photo.status === "uploading").length;
  const state = states.find(item => item.slug === stateSlug) ?? null;
  const symbol = useMemo(() => {
    try {
      return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0).find(part => part.type === "currency")?.value ?? currency;
    } catch {
      return currency;
    }
  }, [currency]);
  const marks = (param: string) => (problem?.param?.startsWith(param) ? "border-brand-700 ring-2 ring-brand-500/20" : "border-slate-300");

  return (
    <div className="grid gap-6 pb-28 lg:pb-8">
      <header className="flex items-center gap-2">
        <Link href="/account" aria-label="Back to my listings" className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-slate-100">
          <ChevronLeft className="size-6" aria-hidden="true" />
        </Link>
        <h1 className="flex-1 text-xl font-extrabold tracking-tight sm:text-2xl">{listing ? (status === "draft" ? "Finish your ad" : "Edit your ad") : "Post an ad"}</h1>
        <span role="status" className="text-xs font-semibold text-slate-500">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? (status === "draft" ? "Draft saved" : "Saved") : saveState === "error" ? "Not saved" : ""}
        </span>
      </header>
      {listing?.status === "rejected" ? (
        <p className="rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
          <strong>Sent back by Udozo:</strong> {listing.review_reason ?? "change it and post it again."}
        </p>
      ) : null}
      {assistant && listing && listing.status !== "draft" ? (
        <ImproveListing
          name={assistant.name}
          listingId={listing.id}
          onTitle={value => {
            setTitle(value);
            save({ title: value });
          }}
          onAddFeature={addSuggestedFeature}
        />
      ) : null}

      {/* Photos and video */}
      <section aria-labelledby="photos" className="grid gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="photos" className="text-base font-bold">
            Photos <span className="text-sm font-medium text-slate-500">at least {minPhotos}</span>
          </h2>
          <span className="text-xs text-slate-500">
            {ready} of {maxPhotos}
            {uploading ? ` · uploading ${uploading}` : ""}
          </span>
        </div>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {photos.map((photo, index) => (
            <li
              key={photo.key}
              draggable={photo.status === "ready"}
              onDragStart={() => (dragFrom.current = index)}
              onDragOver={event => event.preventDefault()}
              onDrop={() => dragFrom.current !== null && void movePhoto(dragFrom.current, index)}
              className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100"
            >
              <img src={photo.url} alt={`Photo ${index + 1}`} className={`size-full object-cover ${photo.status === "uploading" ? "opacity-60" : ""}`} />
              {index === 0 && photo.status === "ready" ? <span className="absolute top-1.5 left-1.5 rounded-full bg-navy-900 px-2 py-0.5 text-[11px] font-bold text-white">Cover</span> : null}
              {photo.status === "uploading" ? (
                <span className="absolute inset-0 grid place-items-center">
                  <LoaderCircle className="size-6 animate-spin text-navy-900" aria-label="Uploading" />
                </span>
              ) : null}
              {photo.status === "failed" ? <span className="absolute inset-x-0 bottom-0 bg-brand-700/90 p-1 text-[11px] leading-tight text-white">{photo.error}</span> : null}
              <span className="absolute top-1 right-1 flex gap-1">
                <button type="button" onClick={() => void dropPhoto(photo)} aria-label={`Remove photo ${index + 1}`} className="grid size-7 place-items-center rounded-full bg-white/90 text-navy-900 shadow">
                  <X className="size-4" aria-hidden="true" />
                </button>
              </span>
              {photo.status === "ready" ? (
                <span className="absolute right-1 bottom-1 left-1 flex justify-between">
                  <button type="button" disabled={index === 0} onClick={() => void movePhoto(index, index - 1)} aria-label={`Move photo ${index + 1} earlier`} className="grid size-7 place-items-center rounded-full bg-white/90 text-navy-900 shadow disabled:invisible">
                    <ArrowLeft className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" disabled={index === photos.length - 1} onClick={() => void movePhoto(index, index + 1)} aria-label={`Move photo ${index + 1} later`} className="grid size-7 place-items-center rounded-full bg-white/90 text-navy-900 shadow disabled:invisible">
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
          {photos.length < maxPhotos ? (
            <li>
              <label className={`grid aspect-square cursor-pointer place-content-center justify-items-center gap-1 rounded-xl border-2 border-dashed bg-white text-center text-xs font-semibold text-navy-900 hover:border-slate-400 ${marks("photos")}`}>
                <Camera className="size-6" aria-hidden="true" />
                Add photos
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={event => {
                    addPhotos(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </li>
          ) : null}
          <li>
            {video ? (
              <div className="relative grid aspect-square place-content-center justify-items-center gap-1 overflow-hidden rounded-xl bg-navy-900 p-2 text-center text-xs font-semibold text-white">
                {video.poster && video.status === "ready" ? <img src={video.poster} alt="" className="absolute inset-0 size-full object-cover opacity-70" /> : null}
                <Video className="relative size-6" aria-hidden="true" />
                <span className="relative">
                  {video.status === "uploading" ? `Sending ${video.progress}%` : video.status === "processing" ? "Preparing…" : video.status === "ready" ? "Video ready" : "Not added"}
                </span>
                {video.status === "failed" && video.error ? <span className="relative text-[11px] leading-tight font-normal">{video.error}</span> : null}
                {video.status !== "uploading" ? (
                  <button type="button" onClick={() => void dropVideo()} aria-label="Remove the video" className="absolute top-1 right-1 grid size-7 place-items-center rounded-full bg-white/90 text-navy-900">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                ) : (
                  <button type="button" onClick={cancelVideo} aria-label="Stop sending the video" className="absolute top-1 right-1 grid size-7 place-items-center rounded-full bg-white/90 text-navy-900">
                    <X className="size-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            ) : (
              <label className="grid aspect-square cursor-pointer place-content-center justify-items-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-white text-center text-xs font-semibold text-navy-900 hover:border-slate-400">
                <Video className="size-6" aria-hidden="true" />
                Add video
                <span className="font-normal text-slate-500">optional, 60 s</span>
                <input type="file" accept="video/mp4,video/quicktime,video/webm" className="sr-only" onChange={event => void addVideo(event.target.files?.[0])} />
              </label>
            )}
          </li>
        </ul>
        <p className="text-xs text-slate-500">The first photo is the cover: drag them, or use the arrows, to change the order. Locations stored in photos are removed.</p>
        {assistant ? <FillFromPhotos name={assistant.name} ensureListing={latest} ready={ready >= minPhotos && !uploading} onAccept={applyDraft} /> : null}
      </section>

      {/* Title, category, price, condition */}
      <section className="grid gap-5">
        <label className="grid gap-1.5 text-sm font-semibold">
          Title
          <input
            value={title}
            maxLength={90}
            onChange={event => {
              setTitle(event.target.value);
              // Saved once it is long enough to be a title (5 characters), so typing never shows an error.
              const length = event.target.value.trim().length;
              if (length === 0 || length >= 5) save({ title: event.target.value });
            }}
            placeholder="e.g. iPhone 13 Pro, 256 GB, Sierra Blue"
            className={`h-12 rounded-xl border bg-white px-3.5 text-base font-normal ${marks("title")}`}
          />
        </label>
        <CategoryPicker
          categories={categories}
          value={found}
          invalid={problem?.param === "category_id"}
          onChange={category => {
            setCategoryId(category.id);
            save({ category_id: category.id });
          }}
        />
        <div className="grid gap-2">
          <label htmlFor="price" className="text-sm font-semibold">
            Price
          </label>
          {priceKind !== "on_request" ? (
            <span className={`flex h-12 items-center gap-2 rounded-xl border bg-white px-3.5 ${marks("price")}`}>
              <span className="text-slate-500">{symbol}</span>
              <input
                id="price"
                inputMode="decimal"
                value={price}
                onChange={event => {
                  setPrice(event.target.value);
                  save({ price: event.target.value });
                }}
                onBlur={() => {
                  const minor = price.trim() ? Number(price.replace(/[,\s]/g, "")) * 100 : null;
                  if (minor && Number.isFinite(minor)) setPrice(fromMinor(Math.round(minor)));
                }}
                placeholder="0"
                className="min-w-0 flex-1 bg-transparent text-base outline-none"
              />
            </span>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["fixed", "Fixed"],
                ["negotiable", "Negotiable"],
                ["on_request", "Contact for price"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                aria-pressed={priceKind === kind}
                onClick={() => {
                  setPriceKind(kind);
                  save({ price_kind: kind, ...(kind === "on_request" ? {} : { price }) });
                }}
                className={`h-9 rounded-full border px-3.5 text-[13px] font-semibold ${priceKind === kind ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-navy-900"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {assistant ? (
            <SuggestPrice
              name={assistant.name}
              ensureListing={latest}
              enabled={Boolean(categoryId)}
              currency={currency}
              onUse={minor => {
                const value = fromMinor(minor);
                setPrice(value);
                const kind = priceKind === "on_request" ? "fixed" : priceKind;
                setPriceKind(kind);
                save({ price: value, price_kind: kind });
              }}
            />
          ) : null}
        </div>
        <Chips
          label="Condition"
          options={(Object.keys(conditionLabels) as ShopCondition[]).map(value => ({ value, label: conditionLabels[value] }))}
          value={condition}
          onChange={value => {
            setCondition(value);
            save({ condition: value });
          }}
        />
      </section>

      <FeaturesField
        suggested={suggested}
        rows={features}
        categoryId={categoryId}
        onChange={updateFeatures}
        invalid={problem?.param?.startsWith("features") ? problem.message : null}
      />

      <DescriptionField
        value={description}
        invalid={problem?.param === "description"}
        onChange={value => {
          setDescription(value);
          save({ description: value });
        }}
      />

      <ResaleFields
        value={sellWhere}
        availability={resale}
        priceMinor={toMinor(price)}
        priceOnRequest={priceKind === "on_request"}
        currency={currency}
        invalid={param => Boolean(problem?.param?.startsWith(param))}
        onChange={(next, keys) => {
          setSellWhere(next);
          const changes: ListingFields = {};
          if (keys.includes("on_shop")) changes.on_shop = next.onShop;
          if (keys.includes("stock")) changes.stock = next.stock;
          if (keys.includes("resale")) Object.assign(changes, resaleChanges(next));
          if (Object.keys(changes).length) save(changes);
        }}
      />

      {/* Location, delivery, contact */}
      <section className="grid gap-5">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold">
            State
            <select
              value={stateSlug}
              onChange={event => {
                setStateSlug(event.target.value);
                setAreaId(null);
              }}
              className={`h-12 rounded-xl border bg-white px-3 text-base font-normal ${marks("area_id")}`}
            >
              <option value="">Choose your state</option>
              {states.map(item => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            City or area
            <select
              value={areaId ?? ""}
              disabled={!state}
              onChange={event => {
                setAreaId(event.target.value || null);
                if (event.target.value) save({ area_id: event.target.value });
              }}
              className={`h-12 rounded-xl border bg-white px-3 text-base font-normal disabled:bg-slate-50 ${marks("area_id")}`}
            >
              <option value="">{state ? "Choose the area" : "Choose a state first"}</option>
              {state?.areas.map(area => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Chips
          label="Delivery"
          options={[
            { value: "none" as const, label: "No delivery" },
            { value: "state" as const, label: state ? `Delivers in ${state.name}` : "Delivers in my state" },
            { value: "nationwide" as const, label: "Nationwide" },
          ]}
          value={delivery}
          onChange={value => {
            setDelivery(value);
            // Without delivery, it must be handed over in person.
            if (value === "none" && !pickup) setPickup(true);
            save({ delivery: value, ...(value === "none" && !pickup ? { pickup: true } : {}) });
          }}
        />
        {delivery !== "none" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-semibold">
              {state ? `Delivery charge in ${state.name}` : "Delivery charge in your state"}
              <input value={feeState} onChange={event => setFeeState(event.target.value)} onBlur={() => save({ delivery_fee_state: feeState })} inputMode="decimal" placeholder="Free" className={`h-12 rounded-xl border bg-white px-3 text-base font-normal ${marks("delivery_fee_state")}`} />
            </label>
            {delivery === "nationwide" ? (
              <label className="grid gap-1.5 text-sm font-semibold">
                Delivery charge elsewhere
                <input value={feeNation} onChange={event => setFeeNation(event.target.value)} onBlur={() => save({ delivery_fee_nationwide: feeNation })} inputMode="decimal" placeholder="Free" className={`h-12 rounded-xl border bg-white px-3 text-base font-normal ${marks("delivery_fee_nationwide")}`} />
              </label>
            ) : null}
            <p className="text-xs text-slate-600 sm:col-span-2">The buyer pays it on top and it is yours in full once they have the item; it is refunded if it never arrives. You ship with a courier and tracking number, after photographing the item and the sealed parcel.</p>
          </div>
        ) : null}
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={pickup}
            disabled={delivery === "none"}
            onChange={event => {
              setPickup(event.target.checked);
              save({ pickup: event.target.checked });
            }}
            className="mt-1 size-4 accent-navy-900"
          />
          <span>
            <strong className="block">Hand it over in person</strong>
            <span className="text-slate-600">You meet the buyer; they check it and give you their release code.{delivery === "none" ? " Needed without delivery." : ""}</span>
          </span>
        </label>
        <div className="grid gap-2">
          <Chips
            label="How buyers reach you"
            options={(Object.keys(contactLabels) as ShopContact[]).map(value => ({ value, label: contactLabels[value] }))}
            value={contact}
            disabled={value => value !== "chat" && !phoneConfirmed}
            onChange={value => {
              setContact(value);
              save({ contact: value });
            }}
          />
          {!phoneConfirmed ? (
            <p className="text-xs text-slate-600">
              To show your phone number, confirm it on{" "}
              <Link href="/account/profile" className="font-semibold text-brand-700 hover:underline">
                your profile
              </Link>{" "}
              first.
            </p>
          ) : null}
        </div>
      </section>

      {/* Posting: fixed above the bottom bar on phones, in place on desktop. */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto grid max-w-6xl gap-2">
          {problem?.param === "terms" ? (
            <TermsAccept
              load={shopTerms}
              accept={acceptShopTerms}
              onAccepted={() => {
                setProblem(null);
                void post();
              }}
            />
          ) : problem ? (
            <p role="alert" className="text-sm font-semibold text-brand-700">
              {problem.message}
            </p>
          ) : null}
          {video?.status === "uploading" ? (
            <p className="text-sm text-slate-600">The video is still sending: wait for it, or stop it to post your ad without one. The video is optional.</p>
          ) : video?.status === "processing" ? (
            <p className="text-sm text-slate-600">You can post now: your video joins the ad as soon as it is ready.</p>
          ) : null}
          <button
            type="button"
            disabled={submitting || uploading > 0 || video?.status === "uploading"}
            onClick={() => void post()}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand-700 px-6 font-bold text-white hover:bg-brand-600 disabled:opacity-60 lg:justify-self-start"
          >
            {submitting ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Check className="size-5" aria-hidden="true" />}
            {live ? "Save changes" : status === "rejected" ? "Post it again" : "Post ad"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The category, picked by search or from the list of top categories and their subcategories. */
function CategoryPicker({ categories, value, invalid, onChange }: { categories: ShopTopCategory[]; value: ReturnType<typeof findCategory>; invalid: boolean; onChange: (category: ShopCategory) => void }) {
  const [open, setOpen] = useState(!value);
  const [q, setQ] = useState("");
  const [top, setTop] = useState<string | null>(null);
  const words = q.trim().toLowerCase();
  const matches = words
    ? categories.flatMap(parent => parent.children.filter(child => `${child.name} ${parent.name}`.toLowerCase().includes(words)).map(child => ({ parent, child }))).slice(0, 20)
    : [];
  if (!open && value) {
    return (
      <div className="grid gap-1.5">
        <span className="text-sm font-semibold">Category</span>
        <div className="flex h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5">
          <ShopIcon name={value.category.icon} className="size-5 text-slate-500" />
          <span className="min-w-0 flex-1 truncate">
            {value.top.name} › {value.category.name}
          </span>
          <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-brand-700 hover:underline">
            Change
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`grid gap-2 rounded-2xl border bg-white p-3 ${invalid ? "border-brand-700" : "border-slate-200"}`}>
      <span className="text-sm font-semibold">Category</span>
      <label className="flex h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 focus-within:border-slate-400">
        <Search className="size-4 text-slate-400" aria-hidden="true" />
        <input value={q} onChange={event => setQ(event.target.value)} placeholder="Search: phones, cars, sofa…" aria-label="Search categories" className="min-w-0 flex-1 bg-transparent outline-none" />
      </label>
      <ul className="grid max-h-72 gap-1 overflow-y-auto">
        {words
          ? matches.map(({ parent, child }) => (
              <li key={child.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(child);
                    setOpen(false);
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm hover:bg-slate-50"
                >
                  <ShopIcon name={child.icon} className="size-4 text-slate-500" />
                  <span>
                    {child.name} <span className="text-slate-500">in {parent.name}</span>
                  </span>
                </button>
              </li>
            ))
          : categories.map(parent => (
              <li key={parent.id}>
                <button type="button" aria-expanded={top === parent.id} onClick={() => setTop(top === parent.id ? null : parent.id)} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm font-semibold hover:bg-slate-50">
                  <ShopIcon name={parent.icon} className="size-4 text-slate-500" />
                  {parent.name}
                </button>
                {top === parent.id ? (
                  <ul className="ml-6 grid gap-0.5 border-l border-slate-200 pl-2">
                    {parent.children.map(child => (
                      <li key={child.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onChange(child);
                            setOpen(false);
                          }}
                          className="flex min-h-10 w-full items-center rounded-lg px-2 text-left text-sm hover:bg-slate-50"
                        >
                          {child.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
        {words && !matches.length ? <li className="px-2 py-3 text-sm text-slate-600">No category matches “{q}”.</li> : null}
      </ul>
    </div>
  );
}

/** One feature's value field, as its registry entry says: a number with its unit, a choice, yes or no, or text. */
function FeatureInput({ row, onChange }: { row: FeatureRow; onChange: (value: string | boolean) => void }) {
  if (row.data_type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        {row.value === true ? "Yes" : "No"}
        <input type="checkbox" role="switch" checked={row.value === true} onChange={event => onChange(event.target.checked)} aria-label={row.name} className="size-5 accent-navy-900" />
      </label>
    );
  }
  if (row.data_type === "choice" && row.choices.length) {
    return (
      <span className="flex flex-wrap justify-end gap-1.5">
        {row.choices.map(choice => (
          <button
            key={choice}
            type="button"
            aria-pressed={row.value === choice}
            onClick={() => onChange(row.value === choice ? "" : choice)}
            className={`h-8 rounded-full border px-3 text-[13px] font-semibold ${row.value === choice ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white"}`}
          >
            {choice}
          </button>
        ))}
      </span>
    );
  }
  return (
    <span className="flex h-10 w-40 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 sm:w-48">
      <input
        value={typeof row.value === "string" ? row.value : ""}
        onChange={event => onChange(event.target.value)}
        inputMode={row.data_type === "number" ? "decimal" : "text"}
        placeholder={row.placeholder ?? ""}
        aria-label={row.name}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
      {row.unit ? <span className="text-xs text-slate-500">{row.unit}</span> : null}
    </span>
  );
}

/** Features as key and value pairs, the keys from the registry: the category's suggestions as chips, and a search. */
function FeaturesField({ suggested, rows, categoryId, onChange, invalid }: { suggested: FeatureDef[]; rows: FeatureRow[]; categoryId: string | null; onChange: (rows: FeatureRow[]) => void; invalid: string | null }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ShopFeature[]>([]);
  const [asked, setAsked] = useState<string | null>(null);
  const keys = new Set(rows.map(row => row.key));
  const add = (def: FeatureDef) => {
    if (keys.has(def.key) || rows.length >= maxFeatures) return;
    onChange([...rows, { ...def, value: def.data_type === "boolean" ? def.default_value === "true" : (def.default_value ?? "") }]);
    setQ("");
    setResults([]);
  };
  useEffect(() => {
    const words = q.trim();
    // Shorter searches show nothing (the list is hidden), so the last results simply wait.
    if (words.length < 2) return;
    const wait = setTimeout(async () => {
      const result = await searchFeatures(words);
      if (result.ok) setResults(result.data);
    }, 250);
    return () => clearTimeout(wait);
  }, [q]);
  const chips = suggested.filter(def => !keys.has(def.key)).slice(0, 8);
  return (
    <section aria-labelledby="features" className="grid gap-3">
      <div>
        <h2 id="features" className="text-base font-bold">
          Features
        </h2>
        <p className="text-sm text-slate-600">Tap to add. Each one knows what to ask for.</p>
      </div>
      {chips.length ? (
        <div className="flex flex-wrap gap-2">
          {chips.map(def => (
            <button key={def.key} type="button" onClick={() => add(def)} className="flex h-9 items-center gap-1.5 rounded-full border border-dashed border-slate-400 bg-white px-3 text-[13px] font-semibold hover:border-navy-900">
              <ShopIcon name={def.icon} className="size-4 text-slate-500" />
              {def.name}
            </button>
          ))}
        </div>
      ) : null}
      {rows.length ? (
        <ul className="grid divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {rows.map(row => (
            <li key={row.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <ShopIcon name={row.icon} className="size-5 shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1 text-sm font-semibold">{row.name}</span>
              <FeatureInput row={row} onChange={value => onChange(rows.map(item => (item.key === row.key ? { ...item, value } : item)))} />
              <button type="button" onClick={() => onChange(rows.filter(item => item.key !== row.key))} aria-label={`Remove ${row.name}`} className="grid size-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {invalid ? (
        <p role="alert" className="text-sm font-semibold text-brand-700">
          {invalid}
        </p>
      ) : null}
      <div className="relative">
        <label className="flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 focus-within:border-slate-400">
          <Search className="size-4 text-slate-400" aria-hidden="true" />
          <input type="search" value={q} onChange={event => setQ(event.target.value)} placeholder="Any other feature: ram, size, bedrooms…" aria-label="Search all features" className="min-w-0 flex-1 bg-transparent outline-none" />
        </label>
        {q.trim().length >= 2 ? (
          <ul className="absolute inset-x-0 top-12 z-10 grid max-h-64 gap-0.5 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
            {results
              .filter(item => !keys.has(item.key))
              .map(item => (
                <li key={item.key}>
                  <button type="button" onClick={() => add(item)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-slate-50">
                    <ShopIcon name={item.icon} className="size-4 text-slate-500" />
                    {item.name}
                    {item.unit ? <span className="text-slate-500">({item.unit})</span> : null}
                  </button>
                </li>
              ))}
            <li>
              {asked === q.trim() ? (
                <p className="px-2 py-2 text-sm text-emerald-800">Thanks: we will look at adding “{q.trim()}”.</p>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    const result = await suggestFeature(q, categoryId);
                    if (result.ok || result.code === "feature_exists") setAsked(q.trim());
                  }}
                  className="flex min-h-10 w-full items-center rounded-lg px-2 text-left text-sm font-semibold text-brand-700 hover:bg-slate-50"
                >
                  Not listed? Suggest “{q.trim()}”
                </button>
              )}
            </li>
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/** The description: limited Markdown with a small toolbar (bold, italic, lists), its count and a preview. */
function DescriptionField({ value, invalid, onChange }: { value: string; invalid: boolean; onChange: (value: string) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const apply = (edit: (text: string, start: number, end: number) => { text: string; start: number; end: number }) => {
    const field = area.current;
    if (!field) return;
    const next = edit(value, field.selectionStart, field.selectionEnd);
    if (next.text.length > maxDescription) return;
    onChange(next.text);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(next.start, next.end);
    });
  };
  const tool = "grid size-9 place-items-center rounded-lg text-navy-900 hover:bg-slate-100 disabled:opacity-40";
  return (
    <section aria-labelledby="description" className="grid gap-2">
      <h2 id="description" className="text-base font-bold">
        Description
      </h2>
      <div className={`overflow-hidden rounded-2xl border bg-white ${invalid ? "border-brand-700" : "border-slate-300"}`}>
        <div className="flex items-center gap-1 border-b border-slate-100 px-2 py-1">
          <button type="button" aria-label="Bold" disabled={preview} onClick={() => apply((text, start, end) => wrapSelection(text, start, end, "**"))} className={tool}>
            <Bold className="size-4" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Italic" disabled={preview} onClick={() => apply((text, start, end) => wrapSelection(text, start, end, "*"))} className={tool}>
            <Italic className="size-4" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Bullet list" disabled={preview} onClick={() => apply((text, start, end) => toggleList(text, start, end, "ul"))} className={tool}>
            <List className="size-4" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Numbered list" disabled={preview} onClick={() => apply((text, start, end) => toggleList(text, start, end, "ol"))} className={tool}>
            <ListOrdered className="size-4" aria-hidden="true" />
          </button>
          <button type="button" aria-pressed={preview} onClick={() => setPreview(!preview)} className="ml-auto h-8 rounded-lg px-2.5 text-[13px] font-semibold text-brand-700 hover:bg-slate-100">
            {preview ? "Write" : "Preview"}
          </button>
        </div>
        {preview ? (
          <div className="min-h-40 space-y-2 px-3.5 py-3 text-[15px] leading-relaxed">
            {descriptionBlocks(value).map((block, index) =>
              block.kind === "p" ? (
                <p key={index}>
                  {block.spans.map((span, i) => (span.bold ? <strong key={i}>{span.text}</strong> : span.italic ? <em key={i}>{span.text}</em> : <span key={i}>{span.text}</span>))}
                </p>
              ) : (
                (() => {
                  const ListTag = block.kind;
                  return (
                    <ListTag key={index} className={`${block.kind === "ul" ? "list-disc" : "list-decimal"} space-y-1 pl-5`}>
                      {block.items.map((item, i) => (
                        <li key={i}>{item.map((span, j) => (span.bold ? <strong key={j}>{span.text}</strong> : span.italic ? <em key={j}>{span.text}</em> : <span key={j}>{span.text}</span>))}</li>
                      ))}
                    </ListTag>
                  );
                })()
              ),
            )}
            {!value.trim() ? <p className="text-slate-500">Nothing written yet.</p> : null}
          </div>
        ) : (
          <textarea
            ref={area}
            value={value}
            onChange={event => onChange(event.target.value.slice(0, maxDescription))}
            rows={7}
            aria-label="Description"
            placeholder="What it is, its condition, what comes with it. No links or phone numbers: buyers reach you through Udozo."
            className="block w-full resize-y px-3.5 py-3 text-[15px] leading-relaxed outline-none"
          />
        )}
        <div className="border-t border-slate-100 px-3.5 py-1.5 text-right text-xs text-slate-500">
          {value.length.toLocaleString("en-GB")} / {maxDescription.toLocaleString("en-GB")}
        </div>
      </div>
    </section>
  );
}
