import { redirect } from "next/navigation";

/**
 * A resale order's notices link to `/account/purchases/<id>` (a store's own account page); on udozo.com, where the same
 * account reads its inbox, the order is the account's UdozoPay order.
 */
export default async function Purchase({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(/^[0-9a-f-]{36}$/i.test(id) ? `/account/orders/${id}` : "/account/orders");
}
