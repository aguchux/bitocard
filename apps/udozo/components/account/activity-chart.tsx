"use client";

import { useId, useRef, useState } from "react";
import type { AccountDashboard, DashboardMetric } from "@bitocard/api-client/classifieds";
import { chartPoints, countOf, dayLabel, metricLabels, metricOrder } from "@/lib/dashboard";

const width = 640;
const height = 200;

/**
 * The dashboard's chart: one figure at a time (chosen above it), day by day over the period, as a line with a soft
 * area under it in Udozo's colour. Pointing at it, or moving along it with the arrow keys once it has focus, shows the
 * day and its count; every day is also in the table beneath it.
 */
export function ActivityChart({ series }: { series: AccountDashboard["series"] }) {
  const id = useId();
  const [metric, setMetric] = useState<DashboardMetric>("views");
  const [at, setAt] = useState<number | null>(null);
  const frame = useRef<SVGSVGElement>(null);
  const values = series.map(row => row[metric]);
  const { max, points } = chartPoints(values, width, height);
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = points.length ? `${line} L${points.at(-1)!.x.toFixed(1)},${height} L${points[0]!.x.toFixed(1)},${height} Z` : "";
  const ticks = [0, max / 2, max];
  const hovered = at === null ? null : points[at];
  const pick = (clientX: number) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || !points.length) return;
    const x = ((clientX - box.left) / box.width) * width;
    const step = points.length > 1 ? width / (points.length - 1) : width;
    setAt(Math.max(0, Math.min(points.length - 1, Math.round(x / step))));
  };
  const total = values.reduce((sum, value) => sum + value, 0);
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="text-base font-extrabold">
            {metricLabels[metric].name} each day
          </h2>
          <p className="text-sm text-slate-600">
            {metricLabels[metric].detail}: {countOf(metric, total)} in all.
          </p>
        </div>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1 rounded-full bg-slate-100 p-1">
          {metricOrder.map(item => (
            <button
              key={item}
              type="button"
              aria-pressed={item === metric}
              onClick={() => setMetric(item)}
              className={`h-8 rounded-full px-3 text-[13px] font-semibold ${item === metric ? "bg-white text-navy-900 shadow-sm" : "text-slate-600 hover:text-navy-900"}`}
            >
              {metricLabels[item].name}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg
          ref={frame}
          viewBox={`-36 -12 ${width + 48} ${height + 40}`}
          className="h-auto w-full touch-pan-y overflow-visible outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          role="img"
          aria-label={`${metricLabels[metric].name} each day, ${dayLabel(series[0]?.day ?? "")} to ${dayLabel(series.at(-1)?.day ?? "")}. The table below has every day.`}
          tabIndex={0}
          onPointerMove={event => pick(event.clientX)}
          onPointerLeave={() => setAt(null)}
          onBlur={() => setAt(null)}
          onKeyDown={event => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            setAt(current => Math.max(0, Math.min(points.length - 1, (current ?? points.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
          }}
        >
          {ticks.map(tick => {
            const y = height - (tick / max) * height;
            return (
              <g key={tick}>
                <line x1={0} x2={width} y1={y} y2={y} className="stroke-slate-200" strokeWidth={1} />
                <text x={-8} y={y} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[11px]">
                  {tick.toLocaleString("en-GB", { maximumFractionDigits: 1 })}
                </text>
              </g>
            );
          })}
          {series.map((row, index) =>
            index % labelEvery === 0 || index === series.length - 1 ? (
              <text key={row.day} x={points[index]?.x ?? 0} y={height + 20} textAnchor={index === 0 ? "start" : index === series.length - 1 ? "end" : "middle"} className="fill-slate-500 text-[11px]">
                {dayLabel(row.day)}
              </text>
            ) : null,
          )}
          <path d={area} className="fill-brand-600/10" />
          <path d={line} fill="none" className="stroke-brand-600" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hovered ? (
            <g>
              <line x1={hovered.x} x2={hovered.x} y1={0} y2={height} className="stroke-slate-400" strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={hovered.x} cy={hovered.y} r={5} className="fill-brand-600 stroke-white" strokeWidth={2} />
            </g>
          ) : null}
        </svg>
        {hovered && at !== null ? (
          <p
            role="status"
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-navy-900 px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-white shadow"
            style={{ left: `${Math.min(88, Math.max(12, ((hovered.x + 36) / (width + 48)) * 100))}%` }}
          >
            {dayLabel(series[at]!.day)}: {countOf(metric, hovered.value)}
          </p>
        ) : null}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-brand-700">See every day as a table</summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1 font-semibold">Day</th>
                {metricOrder.map(item => (
                  <th key={item} className="py-1 text-right font-semibold">
                    {metricLabels[item].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map(row => (
                <tr key={row.day} className="border-t border-slate-100">
                  <td className="py-1">{dayLabel(row.day)}</td>
                  {metricOrder.map(item => (
                    <td key={item} className="py-1 text-right tabular-nums">
                      {row[item].toLocaleString("en-GB")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
