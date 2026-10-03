'use client';

import { useId, useState } from 'react';
import { cn } from '../format';

export type ChartSeries = { name: string; color: string; values: number[]; format: (value: number) => string; axis?: 'left' | 'right' };

const width = 720;
const height = 240;
const pad = { top: 16, right: 48, bottom: 28, left: 64 };

const niceMax = (value: number) => {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(candidate => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
};

/**
 * A responsive line chart with up to two y-axes (for example sales on the left, order count on the right). Pure SVG:
 * it scales to its container, and hovering or focusing a point shows the values for that day.
 */
export function LineChart({ labels, series, className, label }: { labels: string[]; series: ChartSeries[]; className?: string; label: string }) {
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxFor = (axis: 'left' | 'right') => niceMax(Math.max(0, ...series.filter(item => (item.axis ?? 'left') === axis).flatMap(item => item.values)));
  const max = { left: maxFor('left'), right: maxFor('right') };
  const x = (index: number) => pad.left + (labels.length <= 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
  const y = (value: number, axis: 'left' | 'right') => pad.top + plotHeight - (value / max[axis]) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(labels.length / 8));
  const leftFormat = series.find(item => (item.axis ?? 'left') === 'left')?.format ?? String;
  const right = series.find(item => item.axis === 'right');

  return (
    <div className={cn('relative w-full', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-auto w-full overflow-visible" onMouseLeave={() => setActive(null)}>
        <defs>
          {series.map((item, index) => (
            <linearGradient key={item.name} id={`${gradientId}-${index}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={item.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map(tick => {
          const ty = pad.top + plotHeight - tick * plotHeight;
          return (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={ty} y2={ty} stroke="#e6e9f2" strokeDasharray={tick === 0 ? undefined : '3 4'} />
              <text x={pad.left - 8} y={ty + 4} textAnchor="end" fontSize="11" fill="#8a92ad">
                {leftFormat(max.left * tick)}
              </text>
              {right ? (
                <text x={width - pad.right + 8} y={ty + 4} fontSize="11" fill="#8a92ad">
                  {right.format(max.right * tick)}
                </text>
              ) : null}
            </g>
          );
        })}
        {labels.map((text, index) =>
          index % labelEvery === 0 || index === labels.length - 1 ? (
            <text key={text + index} x={x(index)} y={height - 6} textAnchor="middle" fontSize="11" fill="#8a92ad">
              {text}
            </text>
          ) : null,
        )}
        {series.map((item, index) => {
          const axis = item.axis ?? 'left';
          const points = item.values.map((value, i) => `${x(i)},${y(value, axis)}`);
          const area = `M${x(0)},${pad.top + plotHeight} L${points.join(' L')} L${x(item.values.length - 1)},${pad.top + plotHeight} Z`;
          return (
            <g key={item.name}>
              <path d={area} fill={`url(#${gradientId}-${index})`} />
              <polyline points={points.join(' ')} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" data-series={item.name} />
              {item.values.map((value, i) => (
                <circle key={i} cx={x(i)} cy={y(value, axis)} r={active === i ? 5 : 3} fill={item.color} stroke="white" strokeWidth="1.5" />
              ))}
            </g>
          );
        })}
        {labels.map((text, index) => (
          <rect
            key={`hit-${index}`}
            x={x(index) - plotWidth / Math.max(1, labels.length - 1) / 2}
            y={pad.top}
            width={plotWidth / Math.max(1, labels.length - 1)}
            height={plotHeight}
            fill="transparent"
            tabIndex={0}
            aria-label={`${text}: ${series.map(item => `${item.name} ${item.format(item.values[index] ?? 0)}`).join(', ')}`}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
          />
        ))}
        {active !== null ? <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + plotHeight} stroke="#c5cbe0" /> : null}
      </svg>
      {active !== null ? (
        <div role="status" className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-xl border border-line bg-white px-3 py-2 text-xs shadow-lg">
          <p className="font-semibold text-ink">{labels[active]}</p>
          {series.map(item => (
            <p key={item.name} className="mt-0.5 flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-full" style={{ background: item.color }} />
              {item.name}: <span className="font-semibold text-ink">{item.format(item.values[active] ?? 0)}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
