import { ShopForm } from "@/components/shop-form";
import { Tills } from "@/components/tills";
import { currentOwner } from "@/lib/pos-data";

/** First-run setup and later changes: each shop's details for receipts, its VAT, and its tills. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const welcome = (await searchParams).welcome === "1";
  const owner = await currentOwner();
  if (!owner.ok || !owner.data.account) return null;
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
      {account.shops.map(shop => (
        <div key={shop.id} className="grid gap-6">
          <section aria-labelledby={`shop-${shop.id}`} className="rounded-[20px] bg-white p-6">
            <h2 id={`shop-${shop.id}`} className="font-display text-xl font-bold text-pos-ink">
              Shop details
            </h2>
            <p className="mt-1 mb-4 text-pos-ink-2">Printed on your receipts. Shop code {shop.shop_code}.</p>
            <ShopForm shop={shop} />
          </section>
          <section id="tills" aria-labelledby={`tills-${shop.id}`} className="rounded-[20px] bg-white p-6">
            <h2 id={`tills-${shop.id}`} className="font-display text-xl font-bold text-pos-ink">
              Tills
            </h2>
            <p className="mt-1 mb-4 text-pos-ink-2">One for each counter or device you sell from.</p>
            <Tills shopId={shop.id} tills={shop.tills} limit={account.limits.tills} used={used} />
          </section>
        </div>
      ))}
    </div>
  );
}
