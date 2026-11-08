"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@bitocard/admin-ui";
import { type HeroLinkKind, type HeroTarget, useLazyHeroTargetsQuery } from "@bitocard/api-client/admin";

/** How long typing must pause before the suggestions are asked for. */
export const suggestDelayMs = 200;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]!.toUpperCase())
    .join("");

/**
 * A banner link's target with suggestions as the admin types (a combobox): listings by number, SKU or title, brands,
 * sellers and categories, from `GET /v1/admin/classifieds/hero-slides/targets`, up to 8 under the field. Arrow keys move
 * through them, Enter or a click chooses one (its value goes in the field, its name is shown beneath), Escape closes
 * them; anything typed is still sent as it is, and the API checks it. `chosen` is what the target currently names.
 */
export function HeroTargetField({
  id,
  kind,
  scope,
  value,
  chosen,
  placeholder,
  invalid,
  onChange,
}: {
  id: string;
  kind: Exclude<HeroLinkKind, "url">;
  scope: string;
  value: string;
  chosen: string | null;
  placeholder: string;
  invalid?: boolean;
  onChange: (value: string, label: string | null) => void;
}) {
  const list = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState<string | null>(null);
  const [fetch, result] = useLazyHeroTargetsQuery();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ask once typing pauses (and when the field opens), never on every key.
  useEffect(() => {
    if (query === null) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void fetch({ kind, q: query, scope }, true), suggestDelayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetch, kind, query, scope]);

  const options: HeroTarget[] = open && result.data && result.originalArgs?.kind === kind ? result.data.data : [];
  const choose = (option: HeroTarget) => {
    onChange(option.value, option.label);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="grid gap-1.5">
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={options.length > 0}
        aria-controls={list}
        aria-activedescendant={active >= 0 && options[active] ? `${list}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        required
        onFocus={() => {
          setOpen(true);
          setQuery(value);
        }}
        onBlur={() => setOpen(false)}
        onChange={event => {
          onChange(event.target.value, null);
          setOpen(true);
          setActive(-1);
          setQuery(event.target.value);
        }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" && options.length) {
            event.preventDefault();
            setActive(index => (index + 1) % options.length);
          } else if (event.key === "ArrowUp" && options.length) {
            event.preventDefault();
            setActive(index => (index <= 0 ? options.length - 1 : index - 1));
          } else if (event.key === "Enter" && active >= 0 && options[active]) {
            event.preventDefault();
            choose(options[active]);
          } else if (event.key === "Escape" && options.length) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {options.length ? (
        <ul id={list} role="listbox" aria-label="Suggestions" className="max-h-64 overflow-y-auto border border-line bg-white shadow-card">
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${list}-${index}`}
              role="option"
              aria-selected={index === active}
              // Chosen before the field's blur closes the list.
              onMouseDown={event => {
                event.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${index === active ? "bg-pink-50" : ""}`}
            >
              {option.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- logos and photos on Udozo's storage
                <img src={option.image_url} alt="" className="size-8 shrink-0 object-contain" />
              ) : (
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center bg-navy-100 text-xs font-bold text-navy-900">
                  {initials(option.label)}
                </span>
              )}
              <span className="grid min-w-0">
                <span className="truncate font-medium text-navy-900">{option.label}</span>
                {option.detail ? <span className="truncate text-xs text-ink">{option.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : open && result.isSuccess && !result.isFetching && query && result.originalArgs?.kind === kind ? (
        <p className="text-xs text-ink">Nothing matches. Check the spelling, or paste its address.</p>
      ) : null}
      {chosen ? <p className="text-xs text-ink">Links to: <strong className="text-navy-900">{chosen}</strong></p> : null}
    </div>
  );
}
