import Image from "next/image";
import Link from "next/link";
import { ArrowLeftRight, ArrowRight, BarChart3, Check, ChevronDown, Coins, ShieldCheck, Sparkles, TrendingUp, Users, Zap } from "lucide-react";
import type { ResolvedSection, StoreBrand, StoreCountry, StoreDesign, StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { BrandArt } from "./product-card";
import { ProductDetail } from "./product-detail";
import { QuickBuyForm } from "./quick-buy";
import { SearchForm } from "./layout";
import { GroupIcon } from "./category-icon";
import { trustIcon } from "./theme";
import { isServiceHero, ServiceHero } from "./service-heroes";
import { isResaleHero, ResaleHero } from "./resale";

/**
 * Reseller store templates' sections, drawn in the store's variant (`design.style`) with its theme's colours (the
 * `--st-*` variables on the store's shell). Each variant has its own hero; the quick-buy form, the crypto desk and the
 * product spotlight change shape with it too.
 */

type Style = StoreDesign["style"];
type Of<T extends ResolvedSection["type"]> = Extract<ResolvedSection, { type: T }>;

const heroBand = { background: "linear-gradient(135deg, var(--st-hero-from), var(--st-hero-to))", color: "var(--st-hero-ink)" } as const;
const groupHref = (group: StoreNavigationGroup) => `/catalogs/${group.categories.length === 1 ? group.categories[0].category : group.key}`;
const bleedClass = "ml-[calc(50%-50vw)] w-screen overflow-x-clip";
const inner = "mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8";

function Title({ id, section, className = "", accentClass = "text-[var(--st-accent)]" }: { id: string; section: Of<"hero">; className?: string; accentClass?: string }) {
  return (
    <h1 id={id} className={`font-display font-extrabold tracking-tight ${className}`}>
      {section.title}
      {section.accent ? (
        <>
          {" "}
          <span className={accentClass}>{section.accent}</span>
        </>
      ) : null}
    </h1>
  );
}

function Chips({ groups, ink = "text-[var(--st-hero-ink)]" }: { groups: StoreNavigationGroup[]; ink?: string }) {
  return (
    <ul className="mt-6 flex flex-wrap gap-2">
      {groups.map(group => (
        <li key={group.key}>
          <Link href={groupHref(group)} className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-semibold ring-1 ring-white/25 backdrop-blur transition hover:bg-white/25 ${ink}`}>
            <GroupIcon group={group} className="size-6" ink={ink} tile="bg-transparent" />
            {group.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function LogoTile({ brand, className = "" }: { brand: StoreBrand; className?: string }) {
  return (
    <span className={`grid place-items-center overflow-hidden rounded-2xl bg-white p-3 shadow-md ring-1 ring-black/5 ${className}`}>
      {brand.logo_url ? (
        <Image src={brand.logo_url} alt={brand.name} width={96} height={96} className="h-full w-full object-contain" unoptimized />
      ) : (
        <span className="font-display text-lg font-extrabold" style={{ color: brand.color ?? "var(--st-primary)" }}>
          {brand.initials}
        </span>
      )}
    </span>
  );
}

/** The variant's own hero for a store's hero section. */
export function VariantHero({ section, style, groups, countries, bleed }: { section: Of<"hero">; style: Style; groups: StoreNavigationGroup[]; countries: StoreCountry[]; bleed: boolean }) {
  const id = `hero-${section.id}`;
  const featured = section.data.featured;
  const frame = bleed ? bleedClass : "overflow-hidden rounded-3xl";
  const search = section.search ? (
    <div className="mt-6 max-w-2xl text-navy-900">
      <SearchForm countries={countries} size="md" />
    </div>
  ) : null;

  if (isServiceHero(style.hero)) return <ServiceHero kind={style.hero} section={section} id={id} frame={frame} inner={bleed ? inner : "px-6"} />;
  if (isResaleHero(style.hero)) return <ResaleHero section={section} style={style} frame={frame} inner={bleed ? inner : "px-6"} />;

  switch (style.hero) {
    case "minimal":
      return (
        <section aria-labelledby={id} className={`${bleed ? bleedClass : ""} border-b border-slate-200 bg-[var(--st-hero-from)]`}>
          <div className={`${bleed ? inner : "px-6"} py-12 sm:py-16 lg:py-20`}>
            <Title id={id} section={section} className="max-w-3xl text-4xl leading-tight text-[var(--st-hero-ink)] sm:text-5xl" accentClass="text-[var(--st-primary)]" />
            {section.subtitle ? <p className="mt-3 max-w-xl text-lg text-[var(--st-muted)]">{section.subtitle}</p> : null}
            {search}
          </div>
        </section>
      );
    case "networks":
      return (
        <section aria-labelledby={id} className={frame} style={{ background: "linear-gradient(180deg, var(--st-hero-from), var(--st-hero-to))", color: "var(--st-hero-ink)" }}>
          <div className={`${bleed ? inner : "px-6"} grid gap-8 py-10 sm:py-14 lg:grid-cols-2 lg:items-center`}>
            <div>
              <Title id={id} section={section} className="text-4xl leading-tight sm:text-5xl" accentClass="text-[var(--st-primary)]" />
              {section.subtitle ? <p className="mt-3 max-w-xl text-lg opacity-80">{section.subtitle}</p> : null}
              {section.categoryChips ? <Chips groups={groups} ink="text-[var(--st-hero-ink)]" /> : null}
              {search}
            </div>
            <ul aria-label="Providers" className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {featured.slice(0, 8).map(brand => (
                <li key={brand.slug}>
                  <LogoTile brand={brand} className="aspect-square w-full" />
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    case "card_wall":
      return (
        <section aria-labelledby={id} className={frame} style={heroBand}>
          <div className={`${bleed ? inner : "px-6"} grid gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center`}>
            <div>
              <Title id={id} section={section} className="text-4xl leading-[1.05] sm:text-6xl" accentClass="text-[var(--st-primary)]" />
              {section.subtitle ? <p className="mt-4 max-w-xl text-lg opacity-80">{section.subtitle}</p> : null}
              {search}
            </div>
            <div aria-hidden="true" className="relative grid grid-cols-3 gap-3 [transform:rotate(-6deg)] sm:gap-4">
              {featured.slice(0, 6).map((brand, index) => (
                <div key={brand.slug} className={`aspect-[16/10] overflow-hidden rounded-xl shadow-xl ring-1 ring-black/10 ${index % 2 ? "translate-y-6" : ""}`}>
                  <BrandArt brand={brand} className="text-sm" />
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    case "boutique":
      return (
        <section aria-labelledby={id} className={`${frame} text-center`} style={heroBand}>
          <div className={`${bleed ? inner : "px-6"} py-16 sm:py-24`}>
            <p className="text-xs font-semibold tracking-[0.3em] uppercase opacity-70">Gift cards</p>
            <div className="mx-auto mt-5 h-px w-16 bg-current opacity-40" />
            <Title id={id} section={section} className="mx-auto mt-6 max-w-3xl text-4xl leading-tight font-semibold sm:text-6xl" accentClass="italic text-[var(--st-primary)]" />
            {section.subtitle ? <p className="mx-auto mt-5 max-w-lg text-lg opacity-80">{section.subtitle}</p> : null}
            {featured.length ? (
              <ul aria-label="Brands" className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-4">
                {featured.slice(0, 6).map(brand => (
                  <li key={brand.slug}>
                    <LogoTile brand={brand} className="size-16" />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      );
    case "neon":
      return (
        <section aria-labelledby={id} className={`${frame} relative isolate`} style={heroBand}>
          <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-30 [background-image:linear-gradient(var(--st-primary)_1px,transparent_1px),linear-gradient(90deg,var(--st-primary)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,#000_30%,transparent_75%)]" />
          <div className={`${bleed ? inner : "px-6"} py-14 sm:py-20`}>
            <Title id={id} section={section} className="text-5xl leading-none uppercase sm:text-7xl" accentClass="text-[var(--st-primary)] [text-shadow:0_0_24px_var(--st-primary)]" />
            {section.subtitle ? <p className="mt-5 max-w-xl text-lg opacity-80">{section.subtitle}</p> : null}
            {featured.length ? (
              <ul aria-label="Platforms" className="mt-8 flex flex-wrap gap-3">
                {featured.slice(0, 6).map(brand => (
                  <li key={brand.slug} className="rounded-xl p-0.5 [background:linear-gradient(135deg,var(--st-primary),var(--st-accent))]">
                    <LogoTile brand={brand} className="size-16 rounded-[10px]" />
                  </li>
                ))}
              </ul>
            ) : null}
            {search}
          </div>
        </section>
      );
    case "market":
      return (
        <section aria-labelledby={id} className={frame} style={heroBand}>
          <div className={`${bleed ? inner : "px-6"} py-12 sm:py-16`}>
            <Title id={id} section={section} className="max-w-3xl text-4xl leading-tight sm:text-6xl" accentClass="opacity-80" />
            {section.subtitle ? <p className="mt-4 max-w-2xl text-lg opacity-85">{section.subtitle}</p> : null}
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/account/crypto" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-5 font-semibold text-[var(--st-primary)] shadow-md hover:opacity-90">
                <Users className="size-5" aria-hidden="true" /> Open the P2P market
              </Link>
              <Link href="/account/crypto/exchange" className="inline-flex min-h-12 items-center gap-2 rounded-xl px-5 font-semibold ring-1 ring-current hover:bg-white/10">
                <Zap className="size-5" aria-hidden="true" /> Instant buy and sell
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm opacity-85">
              {[
                [ShieldCheck, "Verified traders"],
                [Zap, "Paid instantly from your wallet"],
                [TrendingUp, "Prices set by traders"],
              ].map(([Icon, text]) => {
                const I = Icon as typeof Zap;
                return (
                  <li key={text as string} className="flex items-center gap-2">
                    <I className="size-4" aria-hidden="true" /> {text as string}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      );
    case "story":
      return (
        <section aria-labelledby={id} className={`${frame} relative`} style={heroBand}>
          <div className={`${bleed ? inner : "px-6"} flex min-h-[52svh] flex-col justify-center py-16`}>
            <Sparkles className="size-8 text-[var(--st-primary)]" aria-hidden="true" />
            <Title id={id} section={section} className="mt-6 max-w-4xl text-5xl leading-[1.02] sm:text-7xl" accentClass="text-[var(--st-primary)]" />
            {section.subtitle ? <p className="mt-6 max-w-xl text-xl opacity-80">{section.subtitle}</p> : null}
            <ChevronDown className="mt-12 size-8 animate-bounce opacity-60 motion-reduce:animate-none" aria-hidden="true" />
          </div>
        </section>
      );
    default:
      // `gradient` (and any variant whose page normally starts with another section).
      return (
        <section aria-labelledby={id} className={frame} style={heroBand}>
          <div className={`${bleed ? inner : "px-6 sm:px-10"} py-12 sm:py-16`}>
            <Title id={id} section={section} className="max-w-3xl text-4xl leading-[1.05] sm:text-6xl" accentClass="underline decoration-[var(--st-accent)] decoration-4 underline-offset-8" />
            {section.subtitle ? <p className="mt-4 max-w-2xl text-lg opacity-85">{section.subtitle}</p> : null}
            {search}
            {section.categoryChips ? <Chips groups={groups} /> : null}
          </div>
        </section>
      );
  }
}

function SectionTitle({ id, title, subtitle, light = false }: { id: string; title: string; subtitle?: string; light?: boolean }) {
  return (
    <div className="mb-4">
      <h2 id={id} className={`font-display text-2xl font-extrabold tracking-tight sm:text-3xl ${light ? "text-[var(--st-hero-ink)]" : "text-navy-900"}`}>
        {title}
      </h2>
      {subtitle ? <p className={`mt-1 ${light ? "text-[var(--st-hero-ink)] opacity-80" : "text-slate-500"}`}>{subtitle}</p> : null}
    </div>
  );
}

/** The quick-buy form: the hero of the Quick buy and Bills hub variants, a card elsewhere. */
export function QuickBuy({ section, style }: { section: Of<"quick_buy">; style: Style }) {
  const id = `quick-${section.id}`;
  const lead = style.hero === "quick_buy" || style.hero === "billers";
  const tabs = section.data.categories.filter(tab => tab.products.length);
  return (
    <section aria-labelledby={id} className={`rounded-3xl p-5 sm:p-8 ${lead ? "" : "border border-slate-200 bg-white shadow-sm"}`} style={lead ? heroBand : undefined}>
      <SectionTitle id={id} title={section.title} subtitle={section.subtitle} light={lead} />
      <div className={lead ? "rounded-2xl bg-white/95 p-4 sm:p-5" : ""}>
        <QuickBuyForm id={id} tabs={tabs} tone="light" />
      </div>
    </section>
  );
}

/** The crypto desk's quote form: pick a coin, buy or sell, an amount in the store's money; the exchange page quotes it. */
export function CryptoQuote({ section, style }: { section: Of<"crypto_quote">; style: Style }) {
  const id = `quote-${section.id}`;
  const lead = style.hero === "swap" || style.hero === "terminal";
  const assets = section.data.assets;
  return (
    <section aria-labelledby={id} className={`h-full rounded-3xl p-5 sm:p-8 ${lead ? "" : "border border-slate-200 bg-white shadow-sm"} ${style.hero === "swap" ? "mx-auto max-w-xl text-center" : ""}`} style={lead ? heroBand : undefined}>
      <SectionTitle id={id} title={section.title} subtitle={section.subtitle} light={lead} />
      {assets.length ? (
        <form action="/account/crypto/exchange" method="get" className={`space-y-4 text-left ${lead ? "rounded-2xl bg-white/95 p-4 text-navy-900 sm:p-5" : ""}`}>
          <fieldset>
            <legend className="text-sm font-semibold">I want to</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["buy", "sell"] as const).map(side => (
                <label key={side} className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-slate-200 font-semibold has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
                  <input type="radio" name="side" value={side} defaultChecked={side === section.side} className="sr-only" />
                  {side === "buy" ? "Buy" : "Sell"}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`${id}-asset`} className="block text-sm font-semibold">
                Coin
              </label>
              <select id={`${id}-asset`} name="asset" className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3">
                {assets.map(asset => (
                  <option key={asset.code} value={asset.code}>
                    {asset.code} · {asset.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-fiat`} className="block text-sm font-semibold">
                Amount
              </label>
              <input id={`${id}-fiat`} name="fiat" inputMode="decimal" placeholder="10000" className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3" />
            </div>
          </div>
          <button type="submit" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 font-semibold text-white hover:bg-brand-600">
            <ArrowLeftRight className="size-4" aria-hidden="true" /> See my price
          </button>
          <p className="text-xs text-slate-500">The live price is held for 30 seconds once quoted. You sign in first.</p>
        </form>
      ) : (
        <p className={lead ? "opacity-80" : "text-slate-500"}>Coins are not on sale here yet.</p>
      )}
    </section>
  );
}

/** The P2P market for a coin: what it is and a way in (offers are live, so they are read on the market page). */
export function P2pMarket({ section, style }: { section: Of<"p2p_market">; style: Style }) {
  const id = `p2p-${section.id}`;
  const asset = section.data.asset;
  const dense = style.density === "compact";
  return (
    <section aria-labelledby={id} className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <SectionTitle id={id} title={section.title} subtitle={section.subtitle} />
      {asset ? (
        <>
          <div className={`flex items-center gap-3 rounded-2xl bg-slate-50 ${dense ? "p-3" : "p-4"}`}>
            <span className="grid size-11 place-items-center rounded-full bg-brand-500 font-bold text-white">
              <Coins className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-display font-bold text-navy-900">{asset.code}</span>
              <span className="text-sm text-slate-500">{asset.name}</span>
            </span>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <li className="flex items-center gap-2">
              <BarChart3 className="size-4 text-brand-500" aria-hidden="true" /> Traders’ best prices, cheapest first
            </li>
            <li className="flex items-center gap-2">
              <Zap className="size-4 text-brand-500" aria-hidden="true" /> Paid instantly from your wallet
            </li>
          </ul>
          <div className="mt-auto flex flex-wrap gap-2 pt-5">
            <Link href={`/account/crypto?asset=${asset.code}&side=buy`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
              Buy {asset.code}
            </Link>
            <Link href={`/account/crypto?asset=${asset.code}&side=sell`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold text-navy-900 hover:border-slate-300">
              Sell {asset.code}
            </Link>
          </div>
        </>
      ) : (
        <p className="text-slate-500">This coin is not traded here yet.</p>
      )}
    </section>
  );
}

/** One product in full with its buy form, introduced in the variant's way. */
export async function ProductSpotlight({ section, style }: { section: Of<"product_spotlight">; style: Style }) {
  const product = section.data.product;
  const id = `spot-${section.id}`;
  if (!product) return <p className="rounded-2xl border border-slate-200 p-8 text-center text-slate-500">This product is not on sale right now.</p>;
  const title = section.title || product.name;
  const intro = (
    <div className={style.hero === "split" ? "" : "mb-2"}>
      <h2 id={id} className="font-display text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
        {title}
      </h2>
      {section.subtitle ? <p className="mt-2 max-w-2xl text-lg text-slate-600">{section.subtitle}</p> : null}
      {section.bullets.length ? (
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {section.bullets.map(bullet => (
            <li key={bullet} className="flex items-center gap-2 text-sm font-medium text-navy-900">
              <Check className="size-4 text-brand-500" aria-hidden="true" /> {bullet}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
  return (
    <section aria-labelledby={id} className={style.hero === "spotlight" ? "rounded-3xl p-5 sm:p-8" : ""} style={style.hero === "spotlight" ? { background: "linear-gradient(180deg, var(--st-hero-from), transparent)" } : undefined}>
      {section.imageUrl && style.hero === "split" ? (
        <div className="mb-6 grid gap-6 lg:grid-cols-2 lg:items-center">
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl">
            <Image src={section.imageUrl} alt="" fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" unoptimized />
          </div>
          {intro}
        </div>
      ) : (
        intro
      )}
      <ProductDetail product={product} />
    </section>
  );
}

export function Features({ section }: { section: Of<"features"> }) {
  const id = `features-${section.id}`;
  return (
    <section aria-labelledby={id}>
      <SectionTitle id={id} title={section.title} subtitle={section.subtitle} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {section.items.map(item => {
          const Icon = trustIcon[item.icon];
          return (
            <li key={item.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <span className="grid size-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-3 font-display font-bold text-navy-900">{item.title}</p>
              {item.body ? <p className="mt-1 text-sm text-slate-500">{item.body}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Faq({ section }: { section: Of<"faq"> }) {
  const id = `faq-${section.id}`;
  return (
    <section aria-labelledby={id}>
      <SectionTitle id={id} title={section.title} />
      <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
        {section.items.map(item => (
          <details key={item.question} className="group px-5 py-4">
            <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-4 font-semibold text-navy-900 [&::-webkit-details-marker]:hidden">
              {item.question}
              <ArrowRight className="size-4 shrink-0 text-slate-400 transition group-open:rotate-90" aria-hidden="true" />
            </summary>
            <p className="mt-2 text-slate-600">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
