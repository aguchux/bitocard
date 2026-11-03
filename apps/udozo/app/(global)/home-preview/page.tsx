import type { Metadata } from "next";
import type { ClassifiedHome } from "@bitocard/api-client/home";
import { HomeSections } from "@/components/home/home-sections";
import { PreviewBridge } from "@/components/home/preview-bridge";
import { shopApi } from "@/lib/api";

export const metadata: Metadata = { title: "Home page preview", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ page?: string; token?: string }> };

/**
 * A home page's draft through the admins' preview link (Site › Home pages › Preview): `?page=global|ng&token=`, valid
 * for 30 minutes and for that page only (the API checks it). Never cached or indexed, so the real home pages stay cached.
 * Inside the admin's editor it is the live preview (`PreviewBridge`): blocks chosen by a click, read again on each save.
 */
export default async function HomePreview({ searchParams }: Props) {
  const { page = "", token = "" } = await searchParams;
  const valid = /^(global|[a-z]{2})$/i.test(page) && /^\d+\.[\w-]+$/.test(token);
  const home = valid ? await shopApi<ClassifiedHome>(`/v1/classifieds/home?page=${page}&preview=${encodeURIComponent(token)}`, { revalidate: 0 }) : null;
  if (!home?.ok) {
    return (
      <div className="mx-auto grid max-w-md gap-3 px-4 py-16 text-center">
        <h1 className="text-2xl font-extrabold">This preview has expired</h1>
        <p className="text-navy-600">Open a new preview from Udozo’s admin.</p>
      </div>
    );
  }
  return (
    <>
      <p role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900">
        {`Preview of ${home.data.name}’s draft home page. Visitors do not see it until it is published.`}
      </p>
      <HomeSections home={home.data} preview />
      <PreviewBridge />
    </>
  );
}
