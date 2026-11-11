import { ownerOnly } from "@/lib/gates";
import { ShopForm } from "@/components/shop-form";
import { ShopsPanel } from "@/components/shops-panel";
import { Tills } from "@/components/tills";
import Link from "next/link";
import { DeviceList, LinkDevice } from "@/components/devices";
import { currentOwner, ownerCatalogue, ownerDevices, shopKinds } from "@/lib/pos-data";
import { udozoUrl } from "@/lib/site";

/** First-run setup and later changes: each shop's details for receipts, its VAT, and its tills. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  await ownerOnly();
  const welcome = (await searchParams).welcome === "1";
  const [owner, catalogue, kinds, devices] = await Promise.all([currentOwner(), ownerCatalogue("?limit=1"), shopKinds(), ownerDevices()]);
  if (!owner.ok || !owner.data.account) return null;
  const products = catalogue.ok ? catalogue.data.summary.products : 0;
  const { account } = owner.data;
  const used = account.shops.reduce((sum, shop) => sum + shop.tills.length, 0);
  return (
    <div className="grid gap-6">
      {welcome ? (
        <p role="status" className="rounded-[20px] bg-pos-50 p-5 font-semibold text-pos-700">
          Your shop is open on Udozo POS. Check its details and tills below.
        </p>
      ) : null}
      <h1 className="font-display text-3xl font-bold text-pos-ink">Shop and tills</h1>
      <section aria-labelledby="shops-title" className="rounded-[20px] bg-white p-6">
        <h2 id="shops-title" className="mb-4 font-display text-xl font-bold text-pos-ink">
          {account.shops.length > 1 ? "Your shops" : "Your shop"}
        </h2>
        <ShopsPanel shops={account.shops} limit={account.limits.shops} planName={account.plan.name} />
      </section>
      {account.shops.map(shop => (
        <div key={shop.id} className="grid gap-6">
          <section aria-labelledby={`shop-${shop.id}`} className="rounded-[20px] bg-white p-6">
            <h2 id={`shop-${shop.id}`} className="font-display text-xl font-bold text-pos-ink">
              {account.shops.length > 1 ? shop.name : "Shop details"}
            </h2>
            <p className="mt-1 mb-4 text-pos-ink-2">Printed on your receipts. Shop code {shop.shop_code}.</p>
            <ShopForm shop={shop} kinds={kinds} />
          </section>
          <section id="tills" aria-labelledby={`tills-${shop.id}`} className="rounded-[20px] bg-white p-6">
            <h2 id={`tills-${shop.id}`} className="font-display text-xl font-bold text-pos-ink">
              {account.shops.length > 1 ? `${shop.name}: tills` : "Tills"}
            </h2>
            <p className="mt-1 mb-4 text-pos-ink-2">One for each counter or device you sell from.</p>
            <Tills shopId={shop.id} tills={shop.tills} limit={account.limits.tills} used={used} />
          </section>
        </div>
      ))}
      <section id="devices" aria-labelledby="devices-title" className="grid gap-4 rounded-[20px] bg-white p-6">
        <div>
          <h2 id="devices-title" className="font-display text-xl font-bold text-pos-ink">
            Devices at your tills
          </h2>
          <p className="mt-1 text-pos-ink-2">Link the computer, tablet or phone at a counter to its till. Staff then sign in on it by tapping their name and entering their PIN.</p>
        </div>
        <ul className="grid gap-3">
          {account.shops.flatMap(shop =>
            shop.tills.map(till => (
              <li key={till.id} className="grid gap-2 rounded-xl border border-pos-line p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <span className="font-semibold text-pos-ink">
                  {account.shops.length > 1 ? `${shop.name}: ` : ""}
                  {till.name}
                </span>
                <LinkDevice tillId={till.id} tillName={till.name} />
              </li>
            )),
          )}
        </ul>
        {devices.ok ? (
          <DeviceList devices={devices.data.data} />
        ) : (
          <p role="alert" className="text-pos-error">
            {devices.message}
          </p>
        )}
      </section>
      <section aria-labelledby="products" className="rounded-[20px] bg-white p-6">
        <h2 id="products" className="font-display text-xl font-bold text-pos-ink">
          Products at the till
        </h2>
        {products > 0 ? (
          <>
            <p className="mt-1 text-pos-ink-2">
              {products} of your udozo.com {products === 1 ? "listing is" : "listings are"} ticked Sell at POS, with their stock.
            </p>
            <Link href="/app/products" className="mt-4 inline-flex h-11 items-center rounded-xl border border-pos-600 px-4 font-semibold text-pos-700 no-underline hover:bg-pos-50">
              See your products
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-pos-ink-2">None yet. On udozo.com, tick Sell at your shop with Udozo POS on the listings you sell in the shop, and they come here with their stock.</p>
            <a href={udozoUrl("/account/listings")} target="_blank" rel="noopener" className="mt-4 inline-flex h-11 items-center rounded-xl bg-pos-600 px-4 font-semibold text-white no-underline hover:bg-pos-700">
              Open My listings on udozo.com
            </a>
          </>
        )}
      </section>
    </div>
  );
}
