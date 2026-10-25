"use client";

import { useParams } from "next/navigation";
import { Badge, Card, CardHeader, cn, formatDateTime, formatMoney, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AdminShell, AppLink } from "@bitocard/admin-ui/shell";
import { type ClassifiedConversationReview, useClassifiedConversationQuery } from "@bitocard/api-client/admin";
import { ListingCell, PersonCell, PrivatePhoto, reportReasonLabels } from "@/components/classifieds";

const sideLabels = { buyer: "Buyer", seller: "Seller", bitocard: "BitoCard" } as const;

/**
 * A reported BitoCard Shop chat, read in full. Chats are private: the API opens one only once it has been reported,
 * and records every read (and every photo opened) in the activity log.
 */
export default function ClassifiedConversationPage() {
  const { id } = useParams<{ id: string }>();
  const chat = useClassifiedConversationQuery(id, { refetchOnFocus: false, refetchOnReconnect: false });
  return (
    <AdminShell section="classifieds" current="/classifieds/reports" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Reports", href: "/classifieds/reports" }, { label: "Reported chat" }]}>
      <PageHeader title="Reported chat" description="Read to decide the report. Your read is recorded in the activity log." />
      <QueryView query={chat} loading={<Skeleton className="h-96 w-full" />}>
        {data => <Review chat={data} />}
      </QueryView>
    </AdminShell>
  );
}

function Review({ chat }: { chat: ClassifiedConversationReview }) {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Messages" description={`Started ${formatDateTime(chat.created_at)}, oldest first.`} />
        <ol className="space-y-3 px-5 pb-5 sm:px-6">
          {chat.messages.map(message => (
            <li key={message.id} className={cn("flex", message.from === "seller" ? "justify-end" : message.from === "bitocard" ? "justify-center" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm", message.from === "seller" ? "bg-brand-50 text-ink" : message.from === "bitocard" ? "bg-canvas text-muted" : "border border-line bg-white text-ink")}>
                <p className="text-xs font-semibold text-muted">
                  {sideLabels[message.from]} · {formatDateTime(message.created_at)}
                </p>
                {message.photo ? (
                  <div className="mt-2">
                    <PrivatePhoto path={message.photo.url} alt={`Photo from the ${message.from}`} />
                  </div>
                ) : null}
                {message.offer ? (
                  <p className="mt-1 font-semibold">
                    Offer: {formatMoney(message.offer.price.amount, message.offer.price.currency)} <Badge tone="grey">{message.offer.status}</Badge>
                  </p>
                ) : null}
                {message.body ? <p className="mt-1 whitespace-pre-line">{message.body}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="The ad" />
          <div className="px-5 pb-5 sm:px-6">
            <ListingCell listing={chat.listing} />
          </div>
        </Card>
        <Card>
          <CardHeader title="People" />
          <div className="space-y-3 px-5 pb-5 text-sm sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Buyer</p>
              <PersonCell person={chat.buyer} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Seller</p>
              <PersonCell person={chat.seller} />
            </div>
            {chat.blocked.by_buyer || chat.blocked.by_seller ? <Notice tone="amber">Blocked by the {chat.blocked.by_buyer ? "buyer" : "seller"}.</Notice> : null}
          </div>
        </Card>
        <Card>
          <CardHeader title="Reports" />
          <ul className="space-y-2 px-5 pb-5 text-sm sm:px-6">
            {chat.reports.map(report => (
              <li key={report.id}>
                <span className="font-semibold">{reportReasonLabels[report.reason] ?? report.reason}</span> by the {report.by}
                {report.details ? `: ${report.details}` : ""}
                <span className="block text-xs text-muted">
                  {report.status} · {formatDateTime(report.created_at)}
                </span>
              </li>
            ))}
          </ul>
          <div className="px-5 pb-5 sm:px-6">
            <AppLink href="/classifieds/reports" className="text-sm font-semibold text-brand-600 hover:underline">
              Decide on Reports
            </AppLink>
          </div>
        </Card>
      </div>
    </div>
  );
}
