export const day = 24 * 3600 * 1000;

export const dateKey = (date: Date) => date.toISOString().slice(0, 10);

/** Every day in `[from, to)`, as `YYYY-MM-DD` keys. */
export function dayKeys(from: Date, to: Date): string[] {
  const dates: string[] = [];
  for (let at = from.getTime(); at < to.getTime(); at += day) dates.push(dateKey(new Date(at)));
  return dates;
}

/** Ordinary least squares on (0, values[0]), (1, values[1])...: the line's slope and intercept. */
export function linearFit(values: number[]) {
  const n = values.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((sum, value) => sum + value, 0);
  const sumXY = values.reduce((sum, value, index) => sum + value * index, 0);
  const sumXX = values.reduce((sum, _value, index) => sum + index * index, 0);
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export type TrendPoint = { date: string; value: number; projected: boolean };

/**
 * Daily buckets of `byDay` over `[from, to)`, continued by a simple linear trend fitted to the whole range (flagged
 * `projected: true`), plus the range's total against the immediately preceding range of the same length.
 */
export function buildTrend(byDay: Map<string, number>, from: Date, to: Date, projectDays = 7) {
  const span = to.getTime() - from.getTime();
  const previousFrom = new Date(from.getTime() - span);
  const dates = dayKeys(from, to);
  const previousDates = dayKeys(previousFrom, from);
  const current = dates.reduce((sum, date) => sum + (byDay.get(date) ?? 0), 0);
  const previous = previousDates.reduce((sum, date) => sum + (byDay.get(date) ?? 0), 0);
  const changePercent = previous === 0 ? null : Math.round(((current - previous) / previous) * 1000) / 10;

  const points: TrendPoint[] = dates.map(date => ({ date, value: byDay.get(date) ?? 0, projected: false }));
  const steps = Math.min(projectDays, dates.length);
  if (steps > 0 && dates.length >= 3) {
    const { slope, intercept } = linearFit(points.map(point => point.value));
    for (let step = 0; step < steps; step++) {
      const index = dates.length + step;
      points.push({ date: dateKey(new Date(to.getTime() + step * day)), value: Math.max(0, Math.round(slope * index + intercept)), projected: true });
    }
  }
  return { current, previous, changePercent, points };
}
