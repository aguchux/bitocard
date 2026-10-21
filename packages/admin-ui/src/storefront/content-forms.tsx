"use client";

import { useId } from "react";
import { Plus, X } from "lucide-react";
import { type FaqSection, type FeaturesSection, type PromoIllustration, type PromoSection, type TrustBarSection, type TrustIcon } from "@bitocard/api-client/storefront";
import { cn } from "../format";
import { ImageField } from "../ui/image-field";
import { Button, Field, Input, Select, Textarea } from "../ui/primitives";
import { type FormProps, useSources, themes, illustrations, trustIcons, optional, TitleFields } from "./inspector-fields";

export function PromoForm({ section, onChange }: FormProps<PromoSection>) {
  const id = useId();
  const { image } = useSources();
  const cta = section.cta ?? { label: "", href: "" };
  const setCta = (next: { label: string; href: string }) => onChange({ ...section, cta: next.label.trim() || next.href.trim() ? next : undefined });
  const setBullet = (index: number, value: string) => onChange({ ...section, bullets: section.bullets.map((bullet, at) => (at === index ? value : bullet)) });
  return (
    <>
      <TitleFields section={section} onChange={onChange} subtitleMax={120} />
      <Field label="Body" htmlFor={`${id}-body`} hint="Optional.">
        <Textarea id={`${id}-body`} value={section.body} maxLength={300} onChange={event => onChange({ ...section, body: event.target.value })} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{`Bullets (${section.bullets.length} of 5)`}</legend>
        {section.bullets.map((bullet, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input aria-label={`Bullet ${index + 1}`} value={bullet} maxLength={80} onChange={event => setBullet(index, event.target.value)} />
            <button
              type="button"
              aria-label={`Remove bullet ${index + 1}`}
              onClick={() => onChange({ ...section, bullets: section.bullets.filter((_, at) => at !== index) })}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-red-600"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={section.bullets.length >= 5} onClick={() => onChange({ ...section, bullets: [...section.bullets, ""] })}>
          Add bullet
        </Button>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Button label" htmlFor={`${id}-cta-label`} error={cta.href.trim() && !cta.label.trim() ? "Add a label for the button." : undefined}>
          <Input id={`${id}-cta-label`} value={cta.label} maxLength={40} onChange={event => setCta({ ...cta, label: event.target.value })} placeholder="Start selling" />
        </Field>
        <Field label="Button link" htmlFor={`${id}-cta-href`} error={cta.label.trim() && !cta.href.trim() ? "Add a link for the button." : undefined} hint="A path or an https:// address.">
          <Input id={`${id}-cta-href`} value={cta.href} maxLength={500} onChange={event => setCta({ ...cta, href: event.target.value })} placeholder="/catalogs/esim" />
        </Field>
      </div>
      <ImageField
        label="Image"
        realm={image.realm}
        purpose={image.purpose}
        value={section.imageUrl ?? ""}
        onChange={value => onChange({ ...section, imageUrl: optional(value) })}
        shape="wide"
        hint="Leave empty to use the illustration."
      />
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">Theme</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
          {themes.map(theme => {
            const selected = section.theme === theme.value;
            return (
              <button
                key={theme.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ ...section, theme: theme.value })}
                className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm", selected ? "border-brand-500 bg-brand-50 font-semibold" : "border-line hover:bg-canvas")}
              >
                <span aria-hidden className="size-5 rounded-full border border-line" style={{ background: theme.swatch }} />
                {theme.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <Field label="Illustration" htmlFor={`${id}-illustration`} hint="Drawn when there is no image.">
        <Select id={`${id}-illustration`} value={section.illustration} onChange={event => onChange({ ...section, illustration: event.target.value as PromoIllustration })}>
          {illustrations.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

export function TrustBarForm({ section, onChange }: FormProps<TrustBarSection>) {
  const id = useId();
  const setItem = (index: number, change: Partial<TrustBarSection["items"][number]>) => onChange({ ...section, items: section.items.map((item, at) => (at === index ? { ...item, ...change } : item)) });
  return (
    <>
      {section.items.map((item, index) => (
        <div key={index} role="group" aria-label={`Item ${index + 1}`} className="space-y-3 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{`Item ${index + 1}`}</p>
            <Button size="sm" variant="ghost" disabled={section.items.length <= 1} onClick={() => onChange({ ...section, items: section.items.filter((_, at) => at !== index) })}>
              Remove
            </Button>
          </div>
          <Field label="Icon" htmlFor={`${id}-${index}-icon`}>
            <Select id={`${id}-${index}-icon`} value={item.icon} onChange={event => setItem(index, { icon: event.target.value as TrustIcon })}>
              {trustIcons.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" htmlFor={`${id}-${index}-title`} error={item.title.trim() ? undefined : "A title is required."}>
            <Input id={`${id}-${index}-title`} value={item.title} maxLength={60} onChange={event => setItem(index, { title: event.target.value })} />
          </Field>
          <Field label="Text" htmlFor={`${id}-${index}-body`}>
            <Input id={`${id}-${index}-body`} value={item.body} maxLength={120} onChange={event => setItem(index, { body: event.target.value })} />
          </Field>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={section.items.length >= 4} onClick={() => onChange({ ...section, items: [...section.items, { icon: "shield", title: "New item", body: "" }] })}>
        Add item
      </Button>
    </>
  );
}

/** Text items with an icon (features), like the trust bar's but up to six with longer text. */
export function FeaturesForm({ section, onChange }: FormProps<FeaturesSection>) {
  const id = useId();
  const setItem = (index: number, change: Partial<FeaturesSection["items"][number]>) => onChange({ ...section, items: section.items.map((item, at) => (at === index ? { ...item, ...change } : item)) });
  return (
    <>
      <TitleFields section={section} onChange={onChange} />
      {section.items.map((item, index) => (
        <div key={index} role="group" aria-label={`Item ${index + 1}`} className="space-y-3 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{`Item ${index + 1}`}</p>
            <Button size="sm" variant="ghost" disabled={section.items.length <= 1} onClick={() => onChange({ ...section, items: section.items.filter((_, at) => at !== index) })}>
              Remove
            </Button>
          </div>
          <Field label="Icon" htmlFor={`${id}-${index}-icon`}>
            <Select id={`${id}-${index}-icon`} value={item.icon} onChange={event => setItem(index, { icon: event.target.value as TrustIcon })}>
              {trustIcons.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Title" htmlFor={`${id}-${index}-title`} error={item.title.trim() ? undefined : "A title is required."}>
            <Input id={`${id}-${index}-title`} value={item.title} maxLength={60} onChange={event => setItem(index, { title: event.target.value })} />
          </Field>
          <Field label="Text" htmlFor={`${id}-${index}-body`}>
            <Textarea id={`${id}-${index}-body`} value={item.body} maxLength={200} onChange={event => setItem(index, { body: event.target.value })} />
          </Field>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={section.items.length >= 6} onClick={() => onChange({ ...section, items: [...section.items, { icon: "star", title: "New item", body: "" }] })}>
        Add item
      </Button>
    </>
  );
}

export function FaqForm({ section, onChange }: FormProps<FaqSection>) {
  const id = useId();
  const setItem = (index: number, change: Partial<FaqSection["items"][number]>) => onChange({ ...section, items: section.items.map((item, at) => (at === index ? { ...item, ...change } : item)) });
  return (
    <>
      <Field label="Title" htmlFor={`${id}-title`} error={section.title.trim() ? undefined : "A title is required."}>
        <Input id={`${id}-title`} value={section.title} maxLength={80} onChange={event => onChange({ ...section, title: event.target.value })} />
      </Field>
      {section.items.map((item, index) => (
        <div key={index} role="group" aria-label={`Question ${index + 1}`} className="space-y-3 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{`Question ${index + 1}`}</p>
            <Button size="sm" variant="ghost" disabled={section.items.length <= 1} onClick={() => onChange({ ...section, items: section.items.filter((_, at) => at !== index) })}>
              Remove
            </Button>
          </div>
          <Field label="Question" htmlFor={`${id}-${index}-q`} error={item.question.trim() ? undefined : "A question is required."}>
            <Input id={`${id}-${index}-q`} value={item.question} maxLength={160} onChange={event => setItem(index, { question: event.target.value })} />
          </Field>
          <Field label="Answer" htmlFor={`${id}-${index}-a`} error={item.answer.trim() ? undefined : "An answer is required."}>
            <Textarea id={`${id}-${index}-a`} value={item.answer} maxLength={800} onChange={event => setItem(index, { answer: event.target.value })} />
          </Field>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={section.items.length >= 12} onClick={() => onChange({ ...section, items: [...section.items, { question: "New question", answer: "The answer." }] })}>
        Add question
      </Button>
    </>
  );
}
