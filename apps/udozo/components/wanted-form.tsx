"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { listingPath, shopPriceText, type ShopState, type ShopTopCategory } from "@bitocard/api-client/classifieds";
import { postWanted, type WantedState } from "@/lib/wanted-actions";
import { wantedConditionChoices, wantedScreen } from "@/lib/wanted";

const field = "h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[15px] focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20";
const label = "grid gap-1.5 text-sm font-semibold";

/**
 * Post a request: what they need, its category, where (a state, or an area in it), the most they would pay and the
 * condition. Once posted: its number, how many sellers Udozo told, and listings on Udozo already that may fit.
 */
export function WantedForm({ categories, states, region, currency }: { categories: ShopTopCategory[]; states: ShopState[]; region: string; currency: string }) {
  const [state, action, pending] = useActionState<WantedState, FormData>(postWanted, null);
  const [stateId, setStateId] = useState("");
  const areas = states.find(item => item.id === stateId)?.areas ?? [];
  const problem = state && !state.ok ? state : null;

  if (state?.ok) {
    const request = state.data;
    return (
      <div className="grid gap-4">
        <div className="grid gap-1 rounded-2xl bg-mint-50 p-4">
          <strong className="text-lg">Request {request.number} is up for 14 days</strong>
          <p className="text-sm text-navy-700">{request.sellers_told ? `We told ${request.sellers_told} seller${request.sellers_told === 1 ? "" : "s"} who sell this. Their answers come to your messages.` : "We will tell sellers who sell this as they post. Their answers come to your messages."}</p>
        </div>
        {request.matches.length ? (
          <section aria-labelledby="fit" className="grid gap-2">
            <h2 id="fit" className="font-bold">
              Already on Udozo, and may fit
            </h2>
            <ul className="grid gap-2">
              {request.matches.map(card => (
                <li key={card.id}>
                  <Link href={listingPath(card.country, card.ref, card.slug)} className="flex justify-between gap-3 rounded-xl border border-navy-200 bg-white p-3 hover:border-navy-400">
                    <span className="min-w-0 truncate font-semibold">{card.title}</span>
                    <span className="shrink-0 text-sm text-navy-700">{shopPriceText(card.price)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <Link href={`${wantedScreen}/${request.id}`} className="inline-flex h-11 w-fit items-center rounded-xl bg-brand-700 px-4 font-bold text-white hover:bg-brand-600">
          See your request
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <label className={label}>
        What are you looking for?
        <input name="words" required minLength={3} maxLength={80} placeholder="For example: Toyota Corolla 2012, iPhone 13 Pro" className={field} aria-invalid={problem?.param === "words" || undefined} />
      </label>
      <label className={label}>
        Category
        <select name="category_id" required defaultValue="" className={field} aria-invalid={problem?.param === "category_id" || undefined}>
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map(top => (
            <optgroup key={top.id} label={top.name}>
              {top.children.map(child => (
                <option key={child.id} value={child.id}>
                  {child.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Where ({region})
          <select name="state_id" value={stateId} onChange={event => setStateId(event.target.value)} className={field}>
            <option value="">Anywhere</option>
            {states.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Area
          <select name="area_id" defaultValue="" disabled={!areas.length} className={field}>
            <option value="">Anywhere in it</option>
            {areas.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={label}>
        Most you would pay ({currency}, optional)
        <input name="budget_max" inputMode="decimal" placeholder="450,000" className={field} aria-invalid={problem?.param === "budget_max" || undefined} />
      </label>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Condition</legend>
        <div className="flex flex-wrap gap-2">
          {wantedConditionChoices.map((choice, index) => (
            <label key={choice.value} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-navy-200 px-3 has-checked:border-brand-600 has-checked:bg-brand-50">
              <input type="radio" name="condition" value={choice.value} defaultChecked={index === 0} /> {choice.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className={label}>
        Anything else sellers should know (optional)
        <textarea name="details" rows={3} maxLength={300} placeholder="Colour, size, when you need it…" className="w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-[15px]" />
      </label>
      {problem ? (
        <p role="alert" className="text-sm text-red-700">
          {problem.message}
        </p>
      ) : null}
      <p className="text-xs text-navy-500">Sellers see what you wrote and your first name and initial, never your number. They answer with a listing, in your messages.</p>
      <button type="submit" disabled={pending} className="inline-flex h-11 w-fit items-center rounded-xl bg-brand-700 px-5 font-bold text-white hover:bg-brand-600 disabled:opacity-60">
        {pending ? "Posting…" : "Post request"}
      </button>
    </form>
  );
}
