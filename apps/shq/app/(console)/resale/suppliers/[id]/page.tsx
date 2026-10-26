"use client";

import { useParams } from "next/navigation";
import { Phone } from "lucide-react";
import { Badge, Button, Card, CardHeader, ChatPanel, Notice, PageHeader, QueryView, Skeleton, errorMessage, formatBps, formatDate } from "@bitocard/admin-ui";
import {
  type ResaleDeal,
  useAnswerResaleDealMutation,
  useResaleMessagesQuery,
  useResaleSupplierQuery,
  useSendResaleMessageMutation,
  useSetResaleChatClosedMutation,
} from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const dealText = (deal: ResaleDeal) =>
  [`${formatBps(deal.discount_bps)} off ${deal.listing ? `“${deal.listing.title}”` : "every listing"}`, deal.floor_bps ? `sell from ${formatBps(deal.floor_bps)} below the price` : null, deal.ends_at ? `until ${formatDate(deal.ends_at)}` : null]
    .filter(Boolean)
    .join(", ");

/** One supplier: their phone, the chat (polled while open), and deals to accept, decline or end. */
export default function ResaleSupplierPage() {
  const { id } = useParams<{ id: string }>();
  const { membership } = useReseller();
  const canChat = can(membership, "admin", "support");
  const canDeal = can(membership, "admin");
  const query = useResaleSupplierQuery(id);
  const messages = useResaleMessagesQuery(id, { pollingInterval: 4000, skipPollingIfUnfocused: true });
  const [send, sending] = useSendResaleMessageMutation();
  const [answer, answering] = useAnswerResaleDealMutation();
  const [setClosed, closing] = useSetResaleChatClosedMutation();

  return (
    <ShqShell section="resale" current="/resale/suppliers" crumbs={[{ label: "Resale", href: "/resale" }, { label: "Suppliers", href: "/resale/suppliers" }, { label: query.data?.supplier.name ?? "Supplier" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96" />}>
        {row => (
          <>
            <PageHeader
              title={row.supplier.name}
              description={`${row.listings_in_stores} of their listings on your stores.`}
              actions={
                <div className="flex flex-wrap gap-2">
                  {row.supplier.phone ? (
                    <a href={`tel:${row.supplier.phone}`} className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-canvas">
                      <Phone className="size-4" aria-hidden />
                      {row.supplier.phone}
                    </a>
                  ) : null}
                  {canDeal && !row.stopped_by_supplier ? (
                    <Button variant="secondary" loading={closing.isLoading} onClick={() => void setClosed({ id: row.id, closed: !row.closed_by_you })}>
                      {row.closed_by_you ? "Reopen chat" : "Close chat"}
                    </Button>
                  ) : null}
                </div>
              }
            />
            {row.stopped_by_supplier ? <Notice tone="red" title="This supplier stopped you reselling their listings">Their listings are off your stores and the chat is closed.</Notice> : null}
            <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
              <Card>
                <CardHeader title="Chat" description="Messages stay on BitoCard. Agree prices and stock here; never take payment outside BitoCard." />
                <div className="p-5">
                  <ChatPanel
                    side="reseller"
                    messages={(messages.data?.data ?? []).map(message => ({ id: message.id, author: message.author, author_name: message.author_name, body: message.body, created_at: message.created_at }))}
                    disabled={!canChat || Boolean(messages.data?.closed)}
                    error={sending.error ? errorMessage(sending.error) : null}
                    placeholder={messages.data?.closed ? "This chat is closed." : "Write to the supplier"}
                    onSend={async body => "data" in (await send({ id: row.id, body }))}
                  />
                </div>
              </Card>
              <Card>
                <CardHeader title="Deals" description="Better terms the supplier offers you. They apply to new orders only." />
                <div className="space-y-3 p-5">
                  {answering.error ? <Notice tone="red">{errorMessage(answering.error)}</Notice> : null}
                  {row.deals.length ? (
                    row.deals.map(deal => (
                      <div key={deal.id} className="space-y-2 rounded-xl border border-line p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={deal.status === "active" ? "green" : "pink"}>{deal.status === "active" ? "Running" : "Offered"}</Badge>
                        </div>
                        <p className="text-sm text-ink">{dealText(deal)}</p>
                        {canDeal ? (
                          <div className="flex flex-wrap gap-2">
                            {deal.status === "offered" ? (
                              <>
                                <Button size="sm" onClick={() => void answer({ id: deal.id, supplierId: row.id, answer: "accept" })}>Accept</Button>
                                <Button size="sm" variant="secondary" onClick={() => void answer({ id: deal.id, supplierId: row.id, answer: "decline" })}>Decline</Button>
                              </>
                            ) : (
                              <Button size="sm" variant="secondary" onClick={() => void answer({ id: deal.id, supplierId: row.id, answer: "end" })}>End deal</Button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted">No deals yet. Ask the supplier in the chat.</p>
                  )}
                </div>
              </Card>
            </div>
          </>
        )}
      </QueryView>
    </ShqShell>
  );
}
