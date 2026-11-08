import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ExternalLink, Eye, Heart, Lightbulb, Minus, Newspaper, Pin, ShoppingBag, Sparkles, UsersRound, MessagesSquare } from "lucide-react";
import { dashboardPeriods, listingStatusLabels, shopMoney, type AccountDashboard, type BoardPost, type BoardTone, type DashboardMetric } from "@bitocard/api-client/classifieds";
import { ActivityChart } from "@/components/account/activity-chart";
import { PageTitle } from "@/components/account/nav";
import { customerApi } from "@/lib/customer";
import { requireSeller } from "@/lib/account";
import { boardLink, boardTones, changeText, dayLabel, metricLabels, metricOrder, periodOf } from "@/lib/dashboard";
import { sellHref } from "@/lib/sell-sources";

export const metadata: Metadata = { title: "Dashboard" };

type Props = { searchParams: Promise<{ days?: string }> };

const metricIcons: Record<DashboardMetric, typeof Eye> = { views: Eye, leads: UsersRound, chats: MessagesSquare, saves: Heart, sales: ShoppingBag };
const toneIcons: Record<BoardTone, typeof Eye> = { news: Newspaper, tip: Lightbulb, alert: AlertTriangle };
const trendIcons = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus, new: Sparkles };

function Tile({ metric, data }: { metric: DashboardMetric; data: AccountDashboard }) {
  const Icon = metricIcons[metric];
  const total = data.totals[metric];
  const change = changeText(total);
  const Trend = trendIcons[change.trend];
  return (
    <div className="grid gap-1 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600">
        <Icon className="size-4 text-brand-700" aria-hidden="true" /> {metricLabels[metric].name}
      </span>
      <strong className="text-2xl font-extrabold tabular-nums">{total.value.toLocaleString("en-GB")}</strong>
      <span className={`flex items-center gap-1 text-xs font-semibold ${change.trend === "up" ? "text-emerald-800" : change.trend === "down" ? "text-red-800" : "text-slate-600"}`}>
        <Trend className="size-3.5" aria-hidden="true" /> {change.text}
        {total.change_pct !== null ? <span className="font-normal text-slate-500">vs {total.previous.toLocaleString("en-GB")} before</span> : null}
      </span>
    </div>
  );
}

function Board({ posts }: { posts: BoardPost[] }) {
  return (
    <section aria-labelledby="board" className="grid content-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 id="board" className="text-base font-extrabold">
        Message board
      </h2>
      {posts.length ? (
        <ul className="grid gap-3">
          {posts.map(post => {
            const Icon = toneIcons[post.tone];
            const link = boardLink(post.href);
            return (
              <li key={post.id} className="grid gap-1.5 rounded-xl border border-slate-100 p-3">
                <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${boardTones[post.tone].className}`}>
                    <Icon className="size-3" aria-hidden="true" /> {boardTones[post.tone].label}
                  </span>
                  {post.pinned ? (
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <Pin className="size-3" aria-hidden="true" /> Pinned
                    </span>
                  ) : null}
                  <time dateTime={post.posted_at} className="font-medium text-slate-500">
                    {dayLabel(post.posted_at.slice(0, 10))}
                  </time>
                </span>
                <h3 className="font-bold leading-snug">{post.title}</h3>
                <p className="text-sm whitespace-pre-line text-slate-700">{post.body}</p>
                {link ? (
                  link.external ? (
                    <a href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                      {post.link_label || "Read more"} <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                  ) : (
                    <Link href={link.href} className="text-sm font-semibold text-brand-700 hover:underline">
                      {post.link_label || "Read more"}
                    </Link>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">No messages from Udozo right now. News, tips and anything you need to know show here.</p>
      )}
    </section>
  );
}

/**
 * The account's own page (8 November 2026, the owner's request; My listings moved to `/account/listings`): the
 * customer's figures for 7, 30 or 90 days against the period before, a chart of each figure day by day, their listings
 * at a glance, their best listings, sales, how often they answer chats, their reviews, and Udozo's message board.
 */
export default async function Dashboard({ searchParams }: Props) {
  const days = periodOf((await searchParams).days);
  await requireSeller("/account");
  const result = await customerApi<AccountDashboard>("GET", `/v1/classifieds/me/dashboard?days=${days}`);

  const periods = (
    <nav aria-label="Period" className="flex gap-1 rounded-full bg-slate-100 p-1">
      {dashboardPeriods.map(period => (
        <Link
          key={period}
          href={period === 30 ? "/account" : `/account?days=${period}`}
          aria-current={period === days ? "page" : undefined}
          className={`flex h-8 items-center rounded-full px-3 text-[13px] font-semibold ${period === days ? "bg-white text-navy-900 shadow-sm" : "text-slate-600 hover:text-navy-900"}`}
        >
          {period} days
        </Link>
      ))}
    </nav>
  );

  if (!result.ok) {
    return (
      <div className="grid gap-5">
        <PageTitle title="Dashboard" />
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Your dashboard could not be loaded just now. Try again shortly.</p>
      </div>
    );
  }
  const data = result.data;
  const glance = [
    { label: "Active", value: data.listings.active, href: "/account/listings?status=active" },
    { label: "In review", value: data.listings.in_review, href: "/account/listings?status=pending_review" },
    { label: "Drafts", value: data.listings.drafts, href: "/account/listings?status=draft" },
    { label: "Sold", value: data.listings.sold, href: "/account/listings?status=sold" },
    { label: "Expired", value: data.listings.expired, href: "/account/listings?status=expired" },
  ];
  const anyListings = glance.some(item => item.value > 0) || data.listings.needs_changes > 0;

  return (
    <div className="grid gap-5">
      <PageTitle title="Dashboard" note={`${dayLabel(data.since)} to ${dayLabel(data.until)}`} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {periods}
        <Link href="/account/listings" className="text-sm font-semibold text-brand-700 hover:underline">
          Go to my listings
        </Link>
      </div>

      <section aria-label="Your figures" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {metricOrder.map(metric => (
          <Tile key={metric} metric={metric} data={data} />
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-5">
          <ActivityChart series={data.series} />

          <section aria-labelledby="top-listings" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 id="top-listings" className="text-base font-extrabold">
              Your most viewed listings
            </h2>
            {data.top_listings.length ? (
              <ol className="grid gap-2">
                {data.top_listings.map(listing => {
                  const share = data.top_listings[0]!.views ? (listing.views / data.top_listings[0]!.views) * 100 : 0;
                  return (
                    <li key={listing.id}>
                      <Link href={`/account/listings/${listing.id}`} className="grid gap-1 rounded-xl p-2 hover:bg-slate-50">
                        <span className="flex items-baseline justify-between gap-3 text-sm">
                          <strong className="truncate">{listing.title || "Untitled"}</strong>
                          <span className="shrink-0 text-xs text-slate-600 tabular-nums">
                            {listing.views.toLocaleString("en-GB")} views · {listing.leads.toLocaleString("en-GB")} leads
                          </span>
                        </span>
                        <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.max(2, share)}%` }} />
                        </span>
                        <span className="text-[11px] text-slate-500">{listingStatusLabels[listing.status] ?? listing.status}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-slate-600">No views in this period yet. Listings with clear photos and a fair price get seen most.</p>
            )}
          </section>
        </div>

        <div className="grid min-w-0 content-start gap-5">
          <Board posts={data.board} />

          <section aria-labelledby="glance" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 id="glance" className="text-base font-extrabold">
              Your listings
            </h2>
            {anyListings ? (
              <ul className="grid grid-cols-3 gap-2 text-center">
                {glance.map(item => (
                  <li key={item.label}>
                    <Link href={item.href} className="grid gap-0.5 rounded-xl bg-slate-50 p-2 hover:bg-slate-100">
                      <strong className="text-lg font-extrabold tabular-nums">{item.value.toLocaleString("en-GB")}</strong>
                      <span className="text-[11px] font-medium text-slate-600">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {data.listings.needs_changes ? (
              <Link href="/account/listings" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                {data.listings.needs_changes === 1 ? "1 listing needs" : `${data.listings.needs_changes} listings need`} changes before it goes live.
              </Link>
            ) : null}
            {!anyListings ? <p className="text-sm text-slate-600">Sell what you don’t use: four photos, a title and a price, in about a minute.</p> : null}
            <Link href={sellHref("my_listings")} className="flex h-10 items-center justify-center rounded-full bg-brand-700 px-5 text-sm font-bold text-white hover:bg-brand-600">
              Post an ad
            </Link>
          </section>

          <section aria-labelledby="report" className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h2 id="report" className="text-base font-extrabold">
              This period
            </h2>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Sold for</dt>
                <dd className="text-right font-semibold">{data.sales_value.length ? data.sales_value.map(item => shopMoney(item.amount, item.currency)).join(", ") : "Nothing yet"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Chats you answered</dt>
                <dd className="font-semibold">{data.response_rate === null ? "No new chats" : `${data.response_rate}%`}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Positive reviews</dt>
                <dd className="font-semibold">{data.reviews?.positive_pct != null ? `${data.reviews.positive_pct}% of ${data.reviews.counted}` : "Not enough yet"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Things you bought</dt>
                <dd className="font-semibold">{data.purchases.toLocaleString("en-GB")}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
