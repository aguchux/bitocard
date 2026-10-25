"use client";

import { useState } from "react";
import { Check, LoaderCircle, Sparkles, X } from "lucide-react";
import { conditionLabels, shopMoney, type ShopDraftSuggestion, type ShopImproveSuggestion, type ShopPriceSuggestion } from "@bitocard/api-client/classifieds";
import { assistantSuggestion } from "@/lib/shop-actions";

/** The shop assistant's name and that it is AI, beside every suggestion. */
function Byline({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
      <Sparkles className="size-3.5 text-brand-700" aria-hidden="true" /> {name}, AI assistant · check before you use it
    </span>
  );
}

const button = "inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-navy-900 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50";
const accept = "inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-navy-900 px-3 text-xs font-bold text-white hover:bg-navy-700";

/** What a seller can take from Fill from photos, field by field. */
export type DraftPick = { title?: string; categoryId?: string; condition?: ShopDraftSuggestion["condition"]; features?: ShopDraftSuggestion["features"]; description?: string };

/**
 * Fill from photos: the assistant reads the listing's photos and suggests its title, category, condition, features and
 * description; each is shown to accept on its own (or all at once). Nothing changes until the seller accepts.
 */
export function FillFromPhotos({ name, ensureListing, ready, onAccept }: { name: string; ensureListing: () => Promise<string | null>; ready: boolean; onAccept: (pick: DraftPick) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<ShopDraftSuggestion | null>(null);
  const [taken, setTaken] = useState<string[]>([]);
  const run = async () => {
    setBusy(true);
    setError(null);
    const listingId = await ensureListing();
    const result = listingId ? await assistantSuggestion("draft", { listingId }) : null;
    setBusy(false);
    if (!result) return setError("Save the ad first.");
    if (!result.ok) return setError(result.message);
    if (result.data.kind !== "draft" || !result.data.suggestion) return setError(`${name} could not read enough from these photos. Fill it in yourself.`);
    setSuggestion(result.data.suggestion);
    setTaken([]);
  };
  const take = (key: string, pick: DraftPick) => {
    onAccept(pick);
    setTaken(current => [...current, key]);
  };
  const rows: Array<{ key: string; label: string; value: string; pick: DraftPick }> = suggestion
    ? [
        ...(suggestion.title ? [{ key: "title", label: "Title", value: suggestion.title, pick: { title: suggestion.title } }] : []),
        ...(suggestion.category ? [{ key: "category", label: "Category", value: suggestion.category.name, pick: { categoryId: suggestion.category.id } }] : []),
        ...(suggestion.condition ? [{ key: "condition", label: "Condition", value: conditionLabels[suggestion.condition], pick: { condition: suggestion.condition } }] : []),
        ...(suggestion.features.length ? [{ key: "features", label: "Features", value: suggestion.features.map(item => `${item.name}: ${item.value === true ? "Yes" : item.value === false ? "No" : item.value}`).join(" · "), pick: { features: suggestion.features } }] : []),
        ...(suggestion.description ? [{ key: "description", label: "Description", value: suggestion.description, pick: { description: suggestion.description } }] : []),
      ]
    : [];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={!ready || busy} onClick={() => void run()}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4 text-brand-700" aria-hidden="true" />} Fill from photos
        </button>
        {!ready ? <span className="text-xs text-slate-500">Once 4 photos are in.</span> : null}
      </div>
      {error ? <p className="text-sm text-brand-700">{error}</p> : null}
      {suggestion && rows.length ? (
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <Byline name={name} />
            <button type="button" onClick={() => setSuggestion(null)} aria-label="Close the suggestions" className="grid size-8 place-items-center rounded-full hover:bg-slate-100">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <ul className="grid gap-2">
            {rows.map(row => (
              <li key={row.key} className="flex items-start gap-3 text-sm">
                <span className="grid min-w-0 flex-1">
                  <span className="text-xs font-semibold text-slate-500">{row.label}</span>
                  <span className="line-clamp-4 whitespace-pre-wrap">{row.value}</span>
                </span>
                {taken.includes(row.key) ? (
                  <span className="inline-flex h-8 items-center gap-1 text-xs font-semibold text-emerald-700">
                    <Check className="size-4" aria-hidden="true" /> Used
                  </span>
                ) : (
                  <button type="button" className={accept} onClick={() => take(row.key, row.pick)}>
                    Accept
                  </button>
                )}
              </li>
            ))}
          </ul>
          {rows.some(row => !taken.includes(row.key)) ? (
            <button
              type="button"
              className={`${button} justify-self-start`}
              onClick={() => {
                const left = rows.filter(row => !taken.includes(row.key));
                onAccept(Object.assign({}, ...left.map(row => row.pick)));
                setTaken(rows.map(row => row.key));
              }}
            >
              Accept all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Suggest a price: the usual range of comparable listings in the country (no AI), with the middle one to use. */
export function SuggestPrice({ name, ensureListing, enabled, currency, onUse }: { name: string; ensureListing: () => Promise<string | null>; enabled: boolean; currency: string; onUse: (minor: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [range, setRange] = useState<ShopPriceSuggestion | null>(null);
  const run = async () => {
    setBusy(true);
    setNote(null);
    const listingId = await ensureListing();
    const result = listingId ? await assistantSuggestion("price", { listingId }) : null;
    setBusy(false);
    if (!result) return setNote("Save the ad first.");
    if (!result.ok) return setNote(result.message);
    if (result.data.kind !== "price") return;
    setRange(result.data.suggestion);
    setNote(result.data.note);
  };
  return (
    <div className="grid gap-2">
      <button type="button" className={`${button} justify-self-start`} disabled={!enabled || busy} onClick={() => void run()} title={enabled ? undefined : "Choose a category first"}>
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4 text-brand-700" aria-hidden="true" />} Suggest a price
      </button>
      {range ? (
        <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm">
          <Byline name={name} />
          <p>
            Similar listings usually sell for <strong>{shopMoney(range.low, currency)}</strong> to <strong>{shopMoney(range.high, currency)}</strong> ({range.count} listings).
          </p>
          <button type="button" className={`${accept} justify-self-start`} onClick={() => onUse(range.median)}>
            Use {shopMoney(range.median, currency)}
          </button>
          {note ? <p className="text-xs text-slate-500">{note}</p> : null}
        </div>
      ) : note ? (
        <p className="text-xs text-slate-500">{note}</p>
      ) : null}
    </div>
  );
}

/** Improve this listing: tips, features worth adding (each added with a press) and a clearer title to accept. */
export function ImproveListing({ name, listingId, onTitle, onAddFeature }: { name: string; listingId: string; onTitle: (title: string) => void; onAddFeature: (key: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tips, setTips] = useState<ShopImproveSuggestion | null>(null);
  const [used, setUsed] = useState<string[]>([]);
  const run = async () => {
    setBusy(true);
    setError(null);
    const result = await assistantSuggestion("improve", { listingId });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    if (result.data.kind !== "improve" || !result.data.suggestion) return setError(`${name} has nothing to add just now.`);
    setTips(result.data.suggestion);
    setUsed([]);
  };
  return (
    <section id="improve" className="grid gap-2">
      <button type="button" className={`${button} justify-self-start`} disabled={busy} onClick={() => void run()}>
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4 text-brand-700" aria-hidden="true" />} Improve this listing
      </button>
      {error ? <p className="text-sm text-brand-700">{error}</p> : null}
      {tips ? (
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <Byline name={name} />
          {tips.tips.length ? (
            <ul className="grid list-disc gap-1 pl-5">
              {tips.tips.map(tip => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          ) : null}
          {tips.title ? (
            <div className="flex items-start gap-3">
              <span className="grid min-w-0 flex-1">
                <span className="text-xs font-semibold text-slate-500">A clearer title</span>
                {tips.title}
              </span>
              {used.includes("title") ? (
                <span className="text-xs font-semibold text-emerald-700">Used</span>
              ) : (
                <button
                  type="button"
                  className={accept}
                  onClick={() => {
                    onTitle(tips.title!);
                    setUsed(current => [...current, "title"]);
                  }}
                >
                  Accept
                </button>
              )}
            </div>
          ) : null}
          {tips.missing_features.length ? (
            <div className="grid gap-2">
              <span className="text-xs font-semibold text-slate-500">Buyers look for these: add them below</span>
              <div className="flex flex-wrap gap-2">
                {tips.missing_features.map(feature =>
                  used.includes(feature.key) ? (
                    <span key={feature.key} className="inline-flex h-8 items-center gap-1 rounded-full bg-emerald-50 px-3 text-xs font-semibold text-emerald-800">
                      <Check className="size-3.5" aria-hidden="true" /> {feature.name}
                    </span>
                  ) : (
                    <button
                      key={feature.key}
                      type="button"
                      className={button}
                      onClick={() => {
                        onAddFeature(feature.key);
                        setUsed(current => [...current, feature.key]);
                      }}
                    >
                      + {feature.name}
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Suggest a reply in a chat: written into the box for the seller to edit and send themselves. */
export function SuggestReply({ name, conversationId, onText }: { name: string; conversationId: string; onText: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={button}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await assistantSuggestion("reply", { conversationId });
          setBusy(false);
          if (!result.ok) return setError(result.message);
          if (result.data.kind === "reply" && result.data.suggestion) onText(result.data.suggestion.text);
          else setError(`${name} could not suggest a reply here. Write your own.`);
        }}
        title={`${name}, AI assistant: you edit it and send it yourself`}
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4 text-brand-700" aria-hidden="true" />} Suggest a reply
      </button>
      {error ? <span className="text-xs text-brand-700">{error}</span> : null}
    </span>
  );
}
