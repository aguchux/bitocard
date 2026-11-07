import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Plus } from "lucide-react";
import { listingPath, shopPriceText } from "@bitocard/api-client/classifieds";
import { AnswerWanted, CloseWanted } from "@/components/account/wanted-controls";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { sellHref } from "@/lib/sell-sources";
import { uuidPattern } from "@/lib/shop";
import { type WantedForSeller, type WantedMine, wantedScreen, wantedWhen } from "@/lib/wanted";

export const metadata: Metadata = { title: "Wanted request" };

const card = "grid gap-3 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5";

/**
 * One wanted request. Its buyer sees the sellers' answers (each opening its chat), listings that may fit, and closes it;
 * a seller it was sent to sees what is wanted and answers with one of their listings in its category.
 */
export default async function WantedRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  await requireCustomer(`${wantedScreen}/${id}`);
  const result = await customerApi<WantedMine | WantedForSeller>("GET", `/v1/classifieds/wanted/${id}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">This request could not be loaded just now. Try again shortly.</p>;
  }
  const request = result.data;
  const mine = request.mine;
  return (
    <div className="grid max-w-3xl gap-5">
      <Link href={`${wantedScreen}${mine ? "" : "?tab=for-you"}`} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-navy-700 hover:underline">
        <ChevronLeft className="size-4" aria-hidden="true" /> Wanted requests
      </Link>
      <section className={card} aria-labelledby="wanted-title">
        <span className="text-xs font-semibold text-navy-500">
          {request.number} · {wantedWhen(request)}
        </span>
        <h1 id="wanted-title" className="text-2xl font-extrabold tracking-tight">
          {request.words}
        </h1>
        <dl className="grid gap-1 text-sm text-navy-700 sm:grid-cols-2">
          <div>
            <dt className="inline font-semibold">Category: </dt>
            <dd className="inline">{request.category.name}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Where: </dt>
            <dd className="inline">{request.place ?? "Anywhere"}</dd>
          </div>
          {request.budget.text ? (
            <div>
              <dt className="inline font-semibold">Budget: </dt>
              <dd className="inline">{request.budget.text}</dd>
            </div>
          ) : null}
          {request.condition_text ? (
            <div>
              <dt className="inline font-semibold">Condition: </dt>
              <dd className="inline">{request.condition_text}</dd>
            </div>
          ) : null}
        </dl>
        {request.details ? <p className="rounded-xl bg-navy-50 p-3 text-[15px]">{request.details}</p> : null}
        {!mine ? <p className="text-sm text-navy-600">Asked by {request.buyer}.</p> : null}
        {mine && request.status === "open" ? <CloseWanted id={request.id} /> : null}
      </section>
      {"your_listings" in request ? (
        <section className={card} aria-labelledby="answer">
          <h2 id="answer" className="font-bold">
            {request.answered ? "You answered this request" : "Answer with one of your listings"}
          </h2>
          {request.answered ? (
            <p className="text-sm text-navy-600">The buyer has your listing; carry on in your messages.</p>
          ) : request.status !== "open" ? (
            <p className="text-sm text-navy-600">This request is closed.</p>
          ) : request.your_listings.length ? (
            <AnswerWanted id={request.id} listings={request.your_listings} />
          ) : (
            <>
              <p className="text-sm text-navy-600">You have no live listing in {request.category.name} to answer with.</p>
              <Link href={sellHref("my_listings")} className="inline-flex h-10 w-fit items-center gap-1.5 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-600">
                <Plus className="size-4" strokeWidth={2.6} aria-hidden="true" /> Post an ad
              </Link>
            </>
          )}
        </section>
      ) : (
        <>
          <section className={card} aria-labelledby="answers">
            <h2 id="answers" className="font-bold">
              Answers ({request.responses.length})
            </h2>
            {request.responses.length ? (
              <ul className="grid gap-2">
                {request.responses.map(answer => (
                  <li key={answer.id} className="grid gap-1 rounded-xl border border-navy-200 p-3">
                    <span className="flex justify-between gap-3">
                      <strong className="min-w-0 truncate">{answer.listing?.title ?? "A listing no longer on Udozo"}</strong>
                      {answer.listing ? <span className="shrink-0 text-sm text-navy-700">{shopPriceText(answer.listing.price)}</span> : null}
                    </span>
                    <span className="text-sm text-navy-600">
                      {answer.seller}
                      {answer.note ? `: ${answer.note}` : ""}
                    </span>
                    <span className="flex flex-wrap gap-3 text-sm font-semibold">
                      {answer.conversation_id ? (
                        <Link href={`/account/messages/${answer.conversation_id}`} className="text-brand-700 hover:underline">
                          Open the chat
                        </Link>
                      ) : null}
                      {answer.listing ? (
                        <Link href={listingPath(answer.listing.country, answer.listing.ref, answer.listing.slug)} className="text-navy-700 hover:underline">
                          See the listing
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-navy-600">{request.sellers_told ? `We told ${request.sellers_told} seller${request.sellers_told === 1 ? "" : "s"}. Answers come here and to your messages.` : "No answers yet. We tell sellers as they post."}</p>
            )}
          </section>
          {request.matches.length ? (
            <section className={card} aria-labelledby="fit">
              <h2 id="fit" className="font-bold">
                Already on Udozo, and may fit
              </h2>
              <ul className="grid gap-2">
                {request.matches.map(match => (
                  <li key={match.id}>
                    <Link href={listingPath(match.country, match.ref, match.slug)} className="flex justify-between gap-3 rounded-xl border border-navy-200 p-3 hover:border-navy-400">
                      <span className="min-w-0 truncate font-semibold">{match.title}</span>
                      <span className="shrink-0 text-sm text-navy-700">{shopPriceText(match.price)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
