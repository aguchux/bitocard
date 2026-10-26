import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ShopDispute, ShopOrder } from "@bitocard/api-client/classifieds";
import { OrderDetail } from "@/components/app/shop/order-detail";
import { customerApi } from "@/lib/customer";
import { orderActions, uuidPattern } from "@/lib/shop";

export const metadata: Metadata = { title: "Your order" };

type Props = { params: Promise<{ id: string }> };

/**
 * One order on a Resale shop, for its buyer: where it is, the chat with the store, the release code at a hand-over,
 * confirming a delivery or reporting a problem, and what they paid. The store is who they bought from; the supplier is
 * named as the seller.
 */
export default async function PurchasePage({ params }: Props) {
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const result = await customerApi<ShopOrder>("GET", `/v1/store/resale/orders/${id}`);
  if (!result.ok) notFound();
  const order = result.data;
  const dispute = order.dispute ? await customerApi<ShopDispute>("GET", `/v1/store/resale/orders/${id}/dispute`) : null;
  return (
    <OrderDetail
      order={order}
      actions={orderActions(order)}
      readiness={null}
      balance={null}
      addFundsHref="/account/wallet"
      chatHref={null}
      couriers={[]}
      dispute={dispute?.ok ? dispute.data : null}
      back={{ href: "/account/purchases", label: "Back to your orders" }}
    />
  );
}
