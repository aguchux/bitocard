import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { buyerOrderLabels, sellerOrderLabels, shopMoney, type ShopConversations, type ShopDispute, type ShopOrder, type ShopReadiness, type ShopWallet } from "@bitocard/api-client/classifieds";
import { DisputeThread, OrderPanel } from "@/components/app/shop/order-panel";
import { Thumb } from "@/components/app/shop/thumb";
import { customerApi } from "@/lib/customer";
import { orderActions, orderSteps, orderTone, uuidPattern } from "@/lib/shop";
import { requireShop } from "@/lib/shop-server";

export const metadata: Metadata = { title: "Safe pay order" };

type Props = { params: Promise<{ id: string }> };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/**
 * A Safe pay order, from the reader's side: its status and progress, their own money (the buyer their fee and total,
 * the seller their fee and payout), what to do now, and the dispute when there is one.
 */
export default async function ShopOrderPage({ params }: Props) {
  const { id } = await params;
  await requireShop(`/shop/orders/${id}`);
  if (!uuidPattern.test(id)) notFound();
  const result = await customerApi<ShopOrder>("GET", `/v1/classifieds/orders/${id}`);
  if (!result.ok) notFound();
  const order = result.data;
  const buyer = order.role === "buyer";
  const actions = orderActions(order);
  const [readiness, wallet, dispute, chats] = await Promise.all([
    actions.includes("accept") ? customerApi<ShopReadiness>("GET", "/v1/classifieds/me/safe-pay") : null,
    actions.includes("pay") ? customerApi<ShopWallet>("GET", `/v1/store/wallet?currency=${encodeURIComponent(order.currency)}`) : null,
    order.dispute ? customerApi<ShopDispute>("GET", `/v1/classifieds/orders/${id}/dispute`) : null,
    customerApi<ShopConversations>("GET", `/v1/classifieds/conversations?role=${buyer ? "buying" : "selling"}&limit=50`),
  ]);
  // The chat between the two about this listing, when they have one (a buyer has one per listing; a seller's is the one
  // with this buyer's name, linked only when no other buyer of the listing shares it).
  const matches = chats.ok ? chats.data.data.filter(item => item.listing.id === order.listing.id && item.with.name === order.with.name) : [];
  const chatHref = matches.length === 1 ? `/shop/messages/${matches[0]!.id}` : null;
  const steps = orderSteps(order);
  const money = buyer
    ? [
        { label: "Item", value: order.price },
        { label: "Safe pay fee", value: order.buyer_fee ?? 0 },
        { label: order.status === "requested" || order.status === "awaiting_payment" ? "Total to pay" : "Paid from wallet", value: order.total ?? order.price, strong: true },
      ]
    : [
        { label: "Price agreed", value: order.price },
        { label: "Your Safe pay fee", value: -(order.seller_fee ?? 0) },
        { label: order.status === "released" || order.status === "partly_refunded" ? "Paid to you" : "You will be paid", value: order.payout ?? order.price, strong: true },
      ];
  return (
    <div className="grid max-w-2xl gap-5">
      <header className="flex items-start gap-2">
        <Link href={`/shop/orders${buyer ? "" : "?role=selling"}`} aria-label="Back to orders" className="-ml-2 grid size-10 shrink-0 place-items-center rounded-full hover:bg-slate-100">
          <ChevronLeft className="size-6" aria-hidden="true" />
        </Link>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <h1 className="truncate text-xl font-extrabold">{order.listing.title ?? "Safe pay order"}</h1>
          <span className="text-sm text-slate-600">
            {order.number} · {buyer ? "from" : "to"} {order.with.name} · {order.fulfilment === "meet_up" ? "meet in person" : "delivery"}
          </span>
        </span>
        <Thumb url={order.listing.cover_url} size="size-12" />
      </header>
      <p className={`justify-self-start rounded-full px-3 py-1 text-sm font-bold ${orderTone(order.status)}`}>{(buyer ? buyerOrderLabels : sellerOrderLabels)[order.status]}</p>
      {order.payout_review === "pending" ? <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">BitoCard is checking this payment before it can be cashed out. Nothing is needed from you.</p> : null}

      <OrderPanel
        order={order}
        actions={actions}
        readiness={readiness?.ok ? readiness.data : null}
        balance={wallet?.ok ? wallet.data.balance : null}
        addFundsHref={`/account/wallet${order.currency === "USD" ? "?wallet=USD" : ""}`}
        chatHref={chatHref}
      />

      {dispute?.ok ? <DisputeThread dispute={dispute.data} /> : null}

      <section aria-labelledby="progress" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 id="progress" className="font-bold">
          Progress
        </h2>
        <ol className="grid">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex flex-col items-center">
                <span className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${step.state === "done" ? "bg-emerald-700 text-white" : step.state === "now" ? "border-[3px] border-emerald-700 bg-white" : "border-2 border-slate-300 bg-white"}`}>
                  {step.state === "done" ? "✓" : ""}
                </span>
                {index < steps.length - 1 ? <span className={`w-0.5 flex-1 ${step.state === "done" ? "bg-emerald-700" : "bg-slate-200"}`} /> : null}
              </span>
              <span className="grid pb-4">
                <strong className={`text-sm ${step.state === "later" ? "font-medium text-slate-500" : ""}`}>{step.title}</strong>
                <span className="text-xs text-slate-500">{when(step.at)}</span>
              </span>
            </li>
          ))}
        </ol>
        {order.end_reason ? <p className="text-sm text-slate-600">{order.end_reason}</p> : null}
      </section>

      <section aria-label="The money" className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        {money.map(line => (
          <div key={line.label} className={`flex justify-between ${line.strong ? "border-t border-slate-100 pt-2 text-base font-bold" : ""}`}>
            <span>{line.label}</span>
            <span className={line.strong ? "" : "font-semibold"}>{line.value < 0 ? `− ${shopMoney(-line.value, order.currency)}` : shopMoney(line.value, order.currency)}</span>
          </div>
        ))}
        {order.refund ? <p className="text-emerald-800">Refunded to your wallet: {shopMoney(order.refund, order.currency)}</p> : null}
        {order.deadlines.handover_by && ["paid"].includes(order.status) ? (
          <p className="text-xs text-slate-600">{buyer ? `Hand-over by ${when(order.deadlines.handover_by)}, or you are refunded in full automatically.` : `Hand it over by ${when(order.deadlines.handover_by)}, or the buyer is refunded.`}</p>
        ) : null}
        {!buyer ? <p className="text-xs text-slate-600">Paid to your BitoCard money once the item changes hands, then withdrawable after the payout hold. No fee if the sale does not go ahead.</p> : null}
        {order.tracking_note ? (
          <p className="text-xs text-slate-600">
            <strong>Delivery note:</strong> {order.tracking_note}
          </p>
        ) : null}
      </section>

      {chatHref ? (
        <Link href={chatHref} className="flex h-12 items-center justify-center rounded-2xl border border-slate-300 bg-white font-bold hover:border-slate-400">
          Message {order.with.name}
        </Link>
      ) : null}
    </div>
  );
}

