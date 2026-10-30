import { redirect } from "next/navigation";

/** The identity check provider returns people to `<DASHBOARD_URL>/verification`; the page lives under Settings. */
export default async function VerificationReturn({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) for (const item of [value].flat()) if (item !== undefined) query.append(key, item);
  redirect(`/settings/verification${query.size ? `?${query}` : ""}`);
}
