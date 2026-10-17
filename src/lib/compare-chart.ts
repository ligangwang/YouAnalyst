import type { CompareData, CompareStyle } from "./compare";

export function comparisonPosition(progress: number, count: number) {
  const raw = Math.max(0, Math.min(1, progress)) * Math.max(0, count - 1);
  // Snapped fractions may multiply back to just below an integer.
  const position = Math.abs(raw - Math.round(raw)) < 1e-9 ? Math.round(raw) : raw;
  const index = Math.floor(position), next = Math.min(index + 1, Math.max(0, count - 1));
  return { position, index, next, fraction: position - index };
}

export function snapComparisonProgress(progress: number, count: number) {
  return count < 2 ? 0 : comparisonPosition(progress, count).index / (count - 1);
}

export function comparisonFrame(data: CompareData, progress: number, style: CompareStyle, width: number, height: number) {
  const { position, index, next, fraction } = comparisonPosition(progress, data.dates.length);
  const values = data.series.map(s => s.values[index] + (s.values[next] - s.values[index]) * fraction);
  let low = 0, high = 0;
  for (const series of data.series) for (const value of series.values) { low = Math.min(low, value); high = Math.max(high, value); }
  const padding = Math.max(2, (high - low) * .12);
  low -= padding; high += padding;
  const left = style === "bar" ? 94 : 48, right = width - (style === "bar" ? 80 : 108), top = 30, bottom = height - 38;
  const scale = (value: number) => style === "bar" ? left + (value - low) / (high - low) * (right - left) : bottom - (value - low) / (high - low) * (bottom - top);
  const ranks = (point: number) => [...values.keys()].sort((a,b) => data.series[b].values[point] - data.series[a].values[point] || a - b);
  const before = ranks(index), after = ranks(next), ease = fraction * fraction * (3 - 2 * fraction);
  const labels = data.series.map((series, i) => ({ symbol: series.symbol, value: values[i], x: style === "bar" ? right + 10 : left + progress * (right - left) + 9, y: style === "bar" ? top + (before.indexOf(i) + (after.indexOf(i) - before.indexOf(i)) * ease + .5) * (bottom - top) / data.series.length : scale(values[i]), i }));
  if (style === "line") {
    const sorted = [...labels].sort((a,b) => a.y - b.y);
    sorted.forEach((label, i) => { label.y = Math.max(label.y, i ? sorted[i - 1].y + 26 : top); });
    if (sorted.at(-1)!.y > bottom) {
      sorted.at(-1)!.y = bottom;
      for (let i = sorted.length - 2; i >= 0; i--) sorted[i].y = Math.min(sorted[i].y, sorted[i + 1].y - 26);
    }
  }
  return { position, index, next, fraction, values, labels, low, high, left, right, top, bottom, scale };
}
