import { money, type PosOverview } from "@/lib/pos";

/**
 * Sales by the hour (a day) or by the day: the shop's and udozo.com's side by side in each bar, every figure also in a
 * table for screen readers (never the chart alone).
 */
export function SalesChart({ overview }: { overview: PosOverview }) {
  const top = Math.max(1, ...overview.series.map(point => point.pos + point.online));
  // Few enough labels to fit a phone: every six hours, or about seven days across.
  const every = overview.by === "hour" ? 6 : overview.series.length > 10 ? Math.ceil(overview.series.length / 7) : 1;
  const at = (amount: number) => money(amount, overview.currency);
  return (
    <figure className="grid gap-3">
      <div aria-hidden="true" className="flex h-48 items-end gap-[2px] border-b border-pos-line sm:gap-1">
        {overview.series.map(point => (
          <div key={point.key} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${point.label}: ${at(point.pos)} in the shop, ${at(point.online)} online`}>
            <div className="w-full rounded-t-sm bg-pos-online" style={{ height: `${(point.online / top) * 100}%` }} />
            <div className={`w-full bg-pos-600 ${point.online ? "" : "rounded-t-sm"}`} style={{ height: `${(point.pos / top) * 100}%` }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex gap-[2px] text-[10px] text-pos-muted sm:gap-1">
        {overview.series.map((point, index) => (
          <span key={point.key} className="relative h-4 min-w-0 flex-1">
            {index % every === 0 ? <span className="absolute left-0 whitespace-nowrap">{overview.by === "hour" ? point.label : point.label.slice(5)}</span> : null}
          </span>
        ))}
      </div>
      <figcaption className="flex flex-wrap gap-4 text-sm text-pos-ink-2">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="size-3 rounded-sm bg-pos-600" /> In the shop
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="size-3 rounded-sm bg-pos-online" /> Udozo online
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>Sales {overview.by === "hour" ? "by the hour" : "by the day"}</caption>
        <thead>
          <tr>
            <th scope="col">{overview.by === "hour" ? "Hour" : "Day"}</th>
            <th scope="col">In the shop</th>
            <th scope="col">Udozo online</th>
          </tr>
        </thead>
        <tbody>
          {overview.series.map(point => (
            <tr key={point.key}>
              <th scope="row">{point.label}</th>
              <td>{at(point.pos)}</td>
              <td>{at(point.online)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
