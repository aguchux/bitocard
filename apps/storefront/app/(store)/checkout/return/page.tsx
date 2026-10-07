import { redirect } from "next/navigation";

/** Payment pages return here with the checkout's ID; the order page shows how it went. */
export default async function CheckoutReturnPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  redirect(checkout && /^[0-9a-f-]{36}$/i.test(checkout) ? `/account/orders/${checkout}` : "/account");
}
