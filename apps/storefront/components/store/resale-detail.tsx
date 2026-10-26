/* eslint-disable @next/next/no-img-element -- suppliers' photos from BitoCard Shop's storage */
import Link from "next/link";
import { BadgeCheck, ShieldCheck } from "lucide-react";
import { descriptionBlocks, type DescriptionSpan, shopMoney } from "@bitocard/api-client/classifieds";
import type { ResaleFeature, ResalePhoto, ResaleStoreListingDetail, ResaleStoreSupplier } from "@bitocard/api-client/storefront";
import { resaleCondition, resaleSupplierPath } from "@/lib/resale-links";
import { DeliveryNote, SupplierLine } from "./resale";

function Spans({ spans }: { spans: DescriptionSpan[] }) {
  return (
    <>
      {spans.map((span, index) => (span.bold ? <strong key={index}>{span.text}</strong> : span.italic ? <em key={index}>{span.text}</em> : <span key={index}>{span.text}</span>))}
    </>
  );
}

/** The supplier's description in its limited Markdown, drawn as text (never HTML). */
export function Description({ text }: { text: string | null }) {
  const blocks = descriptionBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className="grid gap-3 text-[15px] leading-relaxed text-slate-700">
      {blocks.map((block, index) =>
        block.kind === "p" ? (
          <p key={index}>
            <Spans spans={block.spans} />
          </p>
        ) : block.kind === "ul" ? (
          <ul key={index} className="list-disc space-y-1 pl-5">
            {block.items.map((item, i) => (
              <li key={i}>
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={index} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, i) => (
              <li key={i}>
                <Spans spans={item} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

export function Features({ features }: { features: ResaleFeature[] }) {
  if (!features.length) return null;
  const value = (feature: ResaleFeature) => (typeof feature.value === "boolean" ? (feature.value ? "Yes" : "No") : `${feature.value ?? ""}${feature.unit ? ` ${feature.unit}` : ""}`);
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {features.map(feature => (
        <div key={feature.key} className="min-w-0">
          <dt className="text-xs text-slate-500">{feature.name}</dt>
          <dd className="truncate font-semibold text-navy-900">{value(feature)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The photos: the first large, the rest as a row that scrolls sideways on phones. */
export function Gallery({ photos, title }: { photos: ResalePhoto[]; title: string }) {
  const [first, ...rest] = photos;
  if (!first) return <div className="aspect-[4/3] rounded-2xl bg-slate-100" />;
  return (
    <div className="grid gap-2">
      <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100">
        <img src={first.url} alt={title} className="size-full object-cover" />
      </div>
      {rest.length ? (
        <ul className="flex snap-x gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {rest.map(photo => (
            <li key={photo.url} className="aspect-square w-24 shrink-0 snap-start overflow-hidden rounded-xl bg-slate-100 sm:w-28">
              <a href={photo.url} target="_blank" rel="noreferrer">
                <img src={photo.url} alt="" loading="lazy" className="size-full object-cover" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * One listing on a Resale shop: the supplier's photos, words and features, the store's price and approved note, the
 * supplier (named, linking to their page here with this listing as they wrote it), how the item reaches the buyer, and
 * how their payment is protected. Buying opens with the next stage of reselling.
 */
export function ResaleListingDetail({ item, storeName }: { item: ResaleStoreListingDetail; storeName: string }) {
  const condition = resaleCondition(item.condition);
  return (
    // Phones: the photos, then the title, price and how to buy, then the details. Desktops: the side panel beside both.
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-x-8">
      <div className="lg:col-start-1">
        <Gallery photos={item.photos} title={item.title} />
      </div>
      <div className="lg:col-start-1">
        <section aria-labelledby="about" className="grid gap-4">
          <h2 id="about" className="font-display text-xl font-extrabold text-navy-900">
            About this item
          </h2>
          <Features features={item.features} />
          <Description text={item.description} />
        </section>
      </div>
      <aside className="row-start-2 grid content-start gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="grid gap-2">
          {item.category ? (
            <Link href={`/listings?category=${item.category.slug}`} className="text-sm font-semibold text-brand-600 hover:underline">
              {item.category.name}
            </Link>
          ) : null}
          <h1 className="font-display text-3xl leading-tight font-extrabold tracking-tight text-navy-900">{item.title}</h1>
          <p className="font-display text-3xl font-extrabold text-navy-900">{shopMoney(item.price, item.currency)}</p>
          <p className="flex flex-wrap gap-x-3 text-sm text-slate-600">
            {condition ? <span>{condition}</span> : null}
            <span>{item.available === 1 ? "1 left" : `${item.available} available`}</span>
          </p>
          <DeliveryNote item={item} />
        </div>
        {item.note ? <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">{item.note}</p> : null}
        <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4">
          <SupplierLine supplier={item.supplier} listingRef={item.ref} className="text-sm" />
          <p className="text-xs text-slate-500">
            {storeName} sells it; the supplier hands it to you. Check the item and their details on{" "}
            <Link href={resaleSupplierPath(item.supplier.id, item.ref)} className="font-semibold text-navy-900 underline">
              the supplier’s page
            </Link>
            .
          </p>
        </div>
        <div className="grid gap-2 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-950">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-5" aria-hidden="true" /> Your payment is protected
          </p>
          <p>You pay from your wallet; the money is held, never sent to anyone, until you confirm you have the item. If it does not arrive or is not as described, you get it back.</p>
          {item.buyer_fee ? <p className="text-xs opacity-80">A Safe pay fee of {shopMoney(item.buyer_fee, item.currency)} is added at checkout.</p> : null}
        </div>
        <p className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm text-slate-700">Buying online here opens soon.</p>
        {item.safety_checklist.length ? (
          <section aria-labelledby="checks" className="grid gap-2">
            <h2 id="checks" className="text-sm font-bold text-navy-900">
              Check before you confirm
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              {item.safety_checklist.map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

/** The supplier's page on a Resale shop: who they are and, when asked, their listing exactly as they wrote it (no price). */
export function ResaleSupplierPage({ supplier }: { supplier: ResaleStoreSupplier }) {
  const since = new Date(supplier.member_since).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <p className="text-sm font-semibold text-brand-600">Supplier</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-navy-900">{supplier.name}</h1>
        <ul className="flex flex-wrap gap-2 text-sm">
          {supplier.badges.includes("id_checked") ? (
            <li className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">
              <BadgeCheck className="size-4" aria-hidden="true" /> Identity checked by BitoCard
            </li>
          ) : null}
          {supplier.badges.includes("phone_confirmed") ? <li className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">Phone confirmed</li> : null}
        </ul>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">Member since</dt>
            <dd className="font-semibold text-navy-900">{since}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Completed sales</dt>
            <dd className="font-semibold text-navy-900">{supplier.completed_sales}</dd>
          </div>
          {supplier.area ? (
            <div>
              <dt className="text-xs text-slate-500">Area</dt>
              <dd className="font-semibold text-navy-900">{[supplier.area.name, supplier.area.state].filter(Boolean).join(", ")}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-slate-500">Items in this store</dt>
            <dd className="font-semibold text-navy-900">
              <Link href={`/listings`} className="underline-offset-2 hover:underline">
                {supplier.listings_here}
              </Link>
            </dd>
          </div>
        </dl>
      </header>
      {supplier.listing ? (
        <section aria-labelledby="as-written" className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
          <div>
            <h2 id="as-written" className="font-display text-xl font-extrabold text-navy-900">
              {supplier.listing.title}
            </h2>
            <p className="text-sm text-slate-500">The listing exactly as {supplier.name} wrote it.</p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Gallery photos={supplier.listing.photos} title={supplier.listing.title} />
            <div className="grid content-start gap-4">
              <p className="flex flex-wrap gap-x-3 text-sm text-slate-600">
                {resaleCondition(supplier.listing.condition) ? <span>{resaleCondition(supplier.listing.condition)}</span> : null}
                {supplier.listing.category ? <span>{supplier.listing.category.name}</span> : null}
                {supplier.listing.area ? <span>{supplier.listing.area.name}</span> : null}
              </p>
              <Features features={supplier.listing.features} />
              <Description text={supplier.listing.description} />
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
