import { NothingYet, StoreSections } from "@/components/store/store-sections";
import { requireStore, storeHome } from "@/lib/store";

type Props = { params: Promise<{ store: string }> };

/** The store's home page, as its owner published it in Seller HQ (or its design's starting page). */
export default async function StoreHomePage({ params }: Props) {
  const { store: key } = await params;
  const store = await requireStore(key);
  const home = await storeHome(key);
  return home.ok ? <StoreSections sections={home.data.sections} design={store.design} /> : <NothingYet />;
}
