import { ArrowRight, ShieldCheck, ShoppingBag } from "lucide-react";
import type { ShopCategoryCover } from "@bitocard/api-client/classifieds";
import { Slider } from "@/components/app/stats-slider";

const count = (listings: number) => (listings === 0 ? "Be the first to sell" : `${listings.toLocaleString("en-GB")} ${listings === 1 ? "ad" : "ads"}`);

/**
 * BitoCard Shop on bitocard.com's home page: the shopper's market's categories in a row that slides sideways, each with
 * the photo of one of its live listings (chosen at random by the API) and Shop now, opening the category on
 * shop.bitocard.com. `href` turns a Shop path into a link (through the sign-in handoff when signed in).
 */
export function ShopBand({ country, categories, href }: { country: { code: string; name: string }; categories: ShopCategoryCover[]; href: (path: string) => string }) {
  const cc = country.code.toLowerCase();
  return (
    <section aria-labelledby="shop-band" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="grid gap-1">
          <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold tracking-wide text-brand-700 uppercase">
            <ShoppingBag className="size-3.5" aria-hidden="true" />
            BitoCard Shop
          </p>
          <h2 id="shop-band" className="font-display text-2xl font-extrabold tracking-tight text-navy-900 sm:text-3xl">
            Buy and sell near you in {country.name}
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-slate-600">
            <ShieldCheck className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
            Pay with Safe pay: BitoCard holds the money until you have the item.
          </p>
        </div>
        <a href={href(`/${cc}`)} className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-600 hover:underline">
          Visit BitoCard Shop
          <ArrowRight className="size-4" aria-hidden="true" />
        </a>
      </div>
      <Slider label={`BitoCard Shop categories in ${country.name}`}>
        {categories.map(category => (
          <li key={category.slug} className="w-[72%] shrink-0 snap-start sm:w-64 lg:w-[calc((100%-3*1rem)/4)] xl:w-[calc((100%-4*1rem)/5)]">
            <a href={href(`/${cc}/c/${category.slug}`)} className="group grid h-full overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 transition hover:ring-slate-300 hover:shadow-md">
              <span className="relative block aspect-[4/3] overflow-hidden bg-navy-900">
                {category.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a seller's photo on BitoCard Shop's media host
                  <img src={category.photo.url} alt={category.photo.alt} loading="lazy" decoding="async" className="size-full object-cover transition duration-300 group-hover:scale-105" />
                ) : (
                  <span className="grid size-full place-items-center bg-gradient-to-br from-navy-800 to-navy-900 text-white/70">
                    <ShoppingBag className="size-10" aria-hidden="true" />
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-900/85 to-transparent px-3.5 pt-10 pb-3">
                  <span className="block text-lg leading-tight font-extrabold text-white">{category.name}</span>
                  <span className="text-xs font-semibold text-white/80">{count(category.listings)}</span>
                </span>
              </span>
              <span className="flex items-center justify-between px-3.5 py-3 text-sm font-bold text-navy-900">
                Shop now
                <span className="grid size-8 place-items-center rounded-full bg-brand-500 text-white transition group-hover:bg-brand-600">
                  <ArrowRight className="size-4" aria-hidden="true" />
                </span>
              </span>
            </a>
          </li>
        ))}
      </Slider>
    </section>
  );
}
