"use client";

import { type FormEvent, useId, useState } from "react";
import { Button, Field, ImageField, Input, Notice, Select, Textarea } from "@bitocard/admin-ui";
import { providerLabels, toneLabels, type AssistantContext } from "@bitocard/admin-ui/support";
import type { BotInput, BotProvider, ShopBotLimits, ShopBotRole, SupportBot } from "@bitocard/api-client/admin";

/** BCP 47 codes offered as quick picks; any valid code can be typed. */
export const commonLanguages: Array<{ code: string; name: string }> = [
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "pcm", name: "Nigerian Pidgin" },
  { code: "yo", name: "Yoruba" },
  { code: "ha", name: "Hausa" },
  { code: "ig", name: "Igbo" },
  { code: "sw", name: "Swahili" },
  { code: "tw", name: "Twi" },
  { code: "pt", name: "Portuguese" },
  { code: "ar", name: "Arabic" },
];
const languagePattern = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
export const languageLabel = (code: string) => commonLanguages.find(item => item.code === code)?.name ?? code;

export const shopRoleLabels: Record<ShopBotRole, { title: string; text: string }> = {
  browse: { title: "Buyers", text: "Finds and compares listings on shop.bitocard.com, explains prices and safety, drafts a first message." },
  sell: { title: "Sellers", text: "Fill from photos, a price range, improving a listing and reply suggestions in the Shop tab. Needs a model that reads photos." },
  help: { title: "Shop help", text: "How the Shop, Safe pay, fees and disputes work, and the customer’s own listings and orders." },
};

const defaultLimits: ShopBotLimits = { customer_daily: 50, visitor_daily: 10, photos_per_draft: 8, monthly_budget_usd: null };

/** A shop assistant's profile: what it does, its AI, its face and voice, the languages it speaks and its limits. */
export function ShopAssistantForm({
  context,
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  context: AssistantContext;
  initial?: SupportBot;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (input: BotInput) => void;
}) {
  const id = useId();
  // Shop assistants run on Anthropic or OpenAI (DeepSeek is not offered for them until lawyers clear it).
  const models = Object.fromEntries((["anthropic", "openai"] as const).map(provider => [provider, context.ai.bitocard[provider] ?? []])) as Record<"anthropic" | "openai", string[]>;
  const [roles, setRoles] = useState<ShopBotRole[]>((initial?.roles.filter(role => role in shopRoleLabels) as ShopBotRole[] | undefined) ?? ["browse", "help"]);
  const [provider, setProvider] = useState<"anthropic" | "openai">(initial?.provider === "openai" ? "openai" : "anthropic");
  const [model, setModel] = useState(initial?.model ?? models[provider][0] ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [avatar, setAvatar] = useState(initial?.avatar_url ?? "");
  const [tone, setTone] = useState<"friendly" | "formal" | "brief">(initial?.tone ?? "friendly");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [languages, setLanguages] = useState<string[]>(initial?.shop?.languages.map(item => item.code) ?? ["en"]);
  const [greetings, setGreetings] = useState<Record<string, string>>(initial?.shop?.greetings ?? {});
  const [typed, setTyped] = useState("");
  const [limits, setLimits] = useState<ShopBotLimits>(initial?.shop?.limits ?? defaultLimits);
  const valid = roles.length > 0 && name.trim().length >= 2 && model.trim().length >= 2 && languages.length > 0;
  const noVision = roles.includes("sell") && !["anthropic", "openai"].includes(provider);

  const toggleRole = (role: ShopBotRole) => setRoles(current => (current.includes(role) ? current.filter(item => item !== role) : [...current, role]));
  const addLanguage = (code: string) => {
    const clean = code.trim();
    if (!languagePattern.test(clean) || languages.includes(clean)) return;
    setLanguages(current => [...current, clean]);
    setTyped("");
  };
  const removeLanguage = (code: string) => {
    setLanguages(current => current.filter(item => item !== code));
    setGreetings(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== code)));
  };
  const makeMain = (code: string) => setLanguages(current => [code, ...current.filter(item => item !== code)]);
  const limit = (key: keyof ShopBotLimits, raw: string) => setLimits(current => ({ ...current, [key]: raw === "" ? (key === "monthly_budget_usd" ? null : current[key]) : Math.max(1, Math.round(Number(raw))) }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      scope: "shop",
      funding: "bitocard",
      roles,
      provider,
      model: model.trim(),
      name: name.trim(),
      avatar_url: avatar || null,
      greeting: greetings[languages[0]]?.trim() || null,
      tone,
      instructions: instructions.trim() || null,
      languages,
      greetings: Object.fromEntries(languages.map(code => [code, greetings[code]?.trim() ?? ""]).filter(([, text]) => text)),
      limits,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error ? <Notice tone="red">{error}</Notice> : null}
      <section className="space-y-3">
        <h3 className="font-bold text-ink">1. What it does</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(shopRoleLabels) as ShopBotRole[]).map(role => (
            <label key={role} className={`flex cursor-pointer gap-3 rounded-2xl border p-4 ${roles.includes(role) ? "border-brand-400 bg-brand-50" : "border-line"}`}>
              <input type="checkbox" className="mt-0.5 size-4" checked={roles.includes(role)} onChange={() => toggleRole(role)} />
              <span>
                <span className="block font-semibold text-ink">{shopRoleLabels[role].title}</span>
                <span className="block text-sm text-muted">{shopRoleLabels[role].text}</span>
              </span>
            </label>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="font-bold text-ink">2. AI agent</h3>
        <p className="text-sm text-muted">Always on BitoCard’s AI. DeepSeek is not offered for shop assistants (it processes data in China) until lawyers clear it.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Provider" htmlFor={`${id}-provider`}>
            <Select
              id={`${id}-provider`}
              value={provider}
              onChange={event => {
                const next = event.target.value as "anthropic" | "openai";
                setProvider(next);
                setModel(models[next][0] ?? "");
              }}
            >
              {(["anthropic", "openai"] as const).map(item => (
                <option key={item} value={item} disabled={!models[item].length}>
                  {providerLabels[item as BotProvider]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Model" htmlFor={`${id}-model`}>
            {models[provider].length ? (
              <Select id={`${id}-model`} value={model} onChange={event => setModel(event.target.value)}>
                {models[provider].map(item => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={`${id}-model`} value={model} onChange={event => setModel(event.target.value)} placeholder="Model name" />
            )}
          </Field>
        </div>
        {noVision ? <Notice tone="amber">Helping sellers reads their photos: choose a model that reads images.</Notice> : null}
      </section>
      <section className="space-y-3">
        <h3 className="font-bold text-ink">3. Profile</h3>
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          <ImageField label="Face or avatar" value={avatar} onChange={setAvatar} realm="admin" purpose="shop_bot_avatar" shape="square" hint="A square image, at least 128 px." />
          <div className="space-y-3">
            <Field label="Name" htmlFor={`${id}-name`} hint="People see it with “AI assistant” beside it.">
              <Input id={`${id}-name`} maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="Anjio" />
            </Field>
            <Field label="Tone" htmlFor={`${id}-tone`}>
              <Select id={`${id}-tone`} value={tone} onChange={event => setTone(event.target.value as typeof tone)}>
                {(["friendly", "formal", "brief"] as const).map(item => (
                  <option key={item} value={item}>
                    {toneLabels[item]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
        <Field label="Extra guidance (optional)" htmlFor={`${id}-instructions`} hint="How it should come across. It can never override BitoCard Shop’s rules.">
          <Textarea id={`${id}-instructions`} rows={3} maxLength={2000} value={instructions} onChange={event => setInstructions(event.target.value)} />
        </Field>
      </section>
      <section className="space-y-3">
        <h3 className="font-bold text-ink">4. Languages and greetings</h3>
        <p className="text-sm text-muted">It answers in the person’s language when it speaks it, else in its main language (the first). The Shop’s pages stay in English.</p>
        <div className="flex flex-wrap gap-2">
          {commonLanguages
            .filter(item => !languages.includes(item.code))
            .map(item => (
              <button key={item.code} type="button" onClick={() => addLanguage(item.code)} className="min-h-9 rounded-full border border-line px-3 text-sm font-semibold text-ink hover:border-brand-400">
                + {item.name}
              </button>
            ))}
          <span className="flex items-center gap-2">
            <Input aria-label="Another language code" className="w-28" value={typed} onChange={event => setTyped(event.target.value)} placeholder="Code" />
            <Button type="button" variant="secondary" disabled={!languagePattern.test(typed.trim())} onClick={() => addLanguage(typed)}>
              Add
            </Button>
          </span>
        </div>
        <ul className="space-y-3">
          {languages.map((code, index) => (
            <li key={code} className="space-y-2 rounded-2xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-ink">
                  {languageLabel(code)} <span className="text-sm font-normal text-muted">({code})</span> {index === 0 ? <span className="ml-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">Main</span> : null}
                </p>
                <div className="flex gap-2">
                  {index > 0 ? (
                    <Button type="button" variant="secondary" onClick={() => makeMain(code)}>
                      Make main
                    </Button>
                  ) : null}
                  {languages.length > 1 ? (
                    <Button type="button" variant="secondary" onClick={() => removeLanguage(code)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
              <Field label={`Greeting in ${languageLabel(code)}`} htmlFor={`${id}-greeting-${code}`}>
                <Input id={`${id}-greeting-${code}`} maxLength={300} value={greetings[code] ?? ""} onChange={event => setGreetings(current => ({ ...current, [code]: event.target.value }))} placeholder={code === "en" ? "Hi, I’m Anjio. What are you looking for?" : ""} />
              </Field>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <h3 className="font-bold text-ink">5. Limits</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Questions a day, signed in" htmlFor={`${id}-customer`}>
            <Input id={`${id}-customer`} type="number" min={1} max={1000} value={limits.customer_daily} onChange={event => limit("customer_daily", event.target.value)} />
          </Field>
          <Field label="Questions a day, signed out" htmlFor={`${id}-visitor`} hint="Per address.">
            <Input id={`${id}-visitor`} type="number" min={1} max={500} value={limits.visitor_daily} onChange={event => limit("visitor_daily", event.target.value)} />
          </Field>
          <Field label="Photos read per draft" htmlFor={`${id}-photos`}>
            <Input id={`${id}-photos`} type="number" min={1} max={12} value={limits.photos_per_draft} onChange={event => limit("photos_per_draft", event.target.value)} />
          </Field>
          <Field label="Monthly cap (US$)" htmlFor={`${id}-budget`} hint="Empty: no cap. It stops and says so when reached.">
            <Input id={`${id}-budget`} type="number" min={1} value={limits.monthly_budget_usd ?? ""} onChange={event => limit("monthly_budget_usd", event.target.value)} />
          </Field>
        </div>
      </section>
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!valid}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
