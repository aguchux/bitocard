import { formatFace, formatRate, type StoreRateShown } from "@bitocard/api-client/storefront";

/**
 * A gift card sold by rate: the card keeps its value and is paid for at the store's rate per unit of its currency, with
 * what each value comes to (before any tax added at checkout).
 */
export function RateCard({ rate }: { rate: StoreRateShown }) {
  return (
    <section aria-labelledby="rate-heading" className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 id="rate-heading" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Our rate
      </h2>
      <p className="font-display mt-1 text-2xl font-extrabold text-navy-900">{formatRate(rate)}</p>
      {rate.values.length ? (
        <ul className="mt-3 divide-y divide-slate-100 text-sm" aria-label="What each value costs">
          {rate.values.map(row => (
            <li key={row.face_value} className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-slate-600">{formatFace(row.face_value, rate.face_currency)} card</span>
              <span className="font-semibold text-navy-900">{formatFace(row.price, rate.currency)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-slate-500">Rates follow exchange rates; you see the exact price before you pay.</p>
    </section>
  );
}
