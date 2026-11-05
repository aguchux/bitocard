"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, errorMessage, formatNumber, Notice, PageHeader, Skeleton, Tabs } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { useInteractionRatingsQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { InteractionRatingItem } from "@/components/interaction-ratings";

const pageSize = 50;

/**
 * Marketplace > Private ratings: how buyers rated sellers' dealings before a sale, with who rated whom and their notes.
 * Flagged first: a buyer said the seller asked them to pay outside Udozo or before seeing the item. A seller's page
 * links here with ?seller= (ratings about them), a buyer's with ?rater=.
 */
export default function RatingsPage() {
  return (
    <Suspense>
      <Ratings />
    </Suspense>
  );
}

function Ratings() {
  const search = useSearchParams();
  const router = useRouter();
  const admin = useAdmin();
  const seller = search.get("seller") ?? undefined;
  const rater = search.get("rater") ?? undefined;
  const [tab, setTab] = useState<"flagged" | "all">(seller || rater ? "all" : "flagged");
  const [country, setCountry] = useState("");
  const [offset, setOffset] = useState(0);
  const ratings = useInteractionRatingsQuery({ flagged: tab === "flagged", country: country || undefined, seller, rater, limit: pageSize, offset });
  const total = ratings.data?.total ?? 0;
  const someone = seller ? "ratings about this seller" : rater ? "ratings this customer gave" : null;
  const rows = ratings.data?.data ?? [];

  return (
    <UdozoShell section="marketplace" current="/classifieds/ratings" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Private ratings" }]}>
      <PageHeader
        title="Private ratings"
        description="After a chat, call, call back or contact request, buyers rate how the seller dealt with them. Never public: sellers see only an anonymous summary of five or more. Leave out a rating that is not genuine."
      />
      {someone ? (
        <div className="mt-4">
          <Notice tone="blue">
            Showing only {someone}.{" "}
            <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => router.push("/classifieds/ratings")}>
              Show every rating
            </button>
          </Notice>
        </div>
      ) : null}
      <div className="mt-6 grid gap-3">
        <Tabs
          label="Private ratings"
          value={tab}
          onChange={value => {
            setTab(value as "flagged" | "all");
            setOffset(0);
          }}
          items={[
            { value: "flagged", label: "Safety concerns", count: ratings.data?.counts.flagged },
            { value: "all", label: "All" },
          ]}
        />
        <div className="flex flex-wrap items-end gap-3">
          <MarketFilter
            id="ratings-market"
            value={country}
            onChange={value => {
              setCountry(value);
              setOffset(0);
            }}
          />
        </div>
      </div>
      <Card className="mt-4 p-4">
        {ratings.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : ratings.error && !ratings.data ? (
          <Notice tone="red">{errorMessage(ratings.error)}</Notice>
        ) : rows.length ? (
          <ol className="grid gap-3">
            {rows.map(rating => (
              <InteractionRatingItem key={rating.id} rating={rating} operations={can(admin, "operations")} />
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">{tab === "flagged" ? "No safety concerns." : "No ratings here."}</p>
        )}
      </Card>
      {total > pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
          <span>
            {offset + 1} to {Math.min(offset + pageSize, total)} of {formatNumber(total)}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
              Previous
            </Button>
            <Button size="sm" variant="ghost" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </UdozoShell>
  );
}
