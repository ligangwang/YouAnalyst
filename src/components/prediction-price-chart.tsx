"use client";

import { UiText, useUiText } from "@/components/ui-text";

import { formatReturnPercent, markToneClass } from "@/components/prediction-ui";

export type PredictionPricePoint = {
  date: string;
  close: number;
  returnValue: number | null;
  score: number | null;
  status: string;
};

export type PredictionPriceHistory = {
  entryDate: string | null;
  entryPrice: number | null;
  points: PredictionPricePoint[];
  truncated: boolean;
};

const CHART_WIDTH = 720;
const CHART_HEIGHT = 260;
const CHART_PADDING = {
  top: 22,
  right: 26,
  bottom: 34,
  left: 54,
};

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatCurrency(value: number): string {
  return CURRENCY_FORMATTER.format(value);
}

function formatDateLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
    ? new Date(year, month - 1, day)
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function pointReturnText(point: PredictionPricePoint): string {
  return typeof point.returnValue === "number" ? formatReturnPercent(point.returnValue) : "Pending";
}

function pointTitle(point: PredictionPricePoint): string {
  const pieces = [
    point.date,
    `Close ${formatCurrency(point.close)}`,
    `Return ${pointReturnText(point)}`,
  ];

  if (typeof point.score === "number") {
    pieces.push(`Score ${Math.round(point.score)}`);
  }

  return pieces.join(" / ");
}

function buildPath(points: PredictionPricePoint[], minPrice: number, maxPrice: number): string {
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const priceRange = Math.max(0.01, maxPrice - minPrice);
  const denominator = Math.max(1, points.length - 1);

  return points
    .map((point, index) => {
      const x = CHART_PADDING.left + (index / denominator) * plotWidth;
      const y = CHART_PADDING.top + ((maxPrice - point.close) / priceRange) * plotHeight;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function priceY(value: number, minPrice: number, maxPrice: number): number {
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const priceRange = Math.max(0.01, maxPrice - minPrice);
  return CHART_PADDING.top + ((maxPrice - value) / priceRange) * plotHeight;
}

function pointX(index: number, total: number): number {
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  return CHART_PADDING.left + (index / Math.max(1, total - 1)) * plotWidth;
}

function downsample(points: PredictionPricePoint[], maxPoints: number): PredictionPricePoint[] {
  if (points.length <= maxPoints) {
    return points;
  }

  const selectedIndexes = new Set<number>([0, points.length - 1]);
  let minIndex = 0;
  let maxIndex = 0;
  points.forEach((point, index) => {
    if (point.close < points[minIndex].close) {
      minIndex = index;
    }
    if (point.close > points[maxIndex].close) {
      maxIndex = index;
    }
  });
  selectedIndexes.add(minIndex);
  selectedIndexes.add(maxIndex);

  const lastIndex = points.length - 1;
  for (let index = 0; selectedIndexes.size < maxPoints && index < maxPoints; index += 1) {
    selectedIndexes.add(Math.round((index / (maxPoints - 1)) * lastIndex));
  }

  return Array.from(selectedIndexes)
    .sort((left, right) => left - right)
    .map((index) => points[index]);
}

export function PredictionPriceChart({
  history,
  loading,
  error,
}: {
  history: PredictionPriceHistory | null;
  loading: boolean;
  error: string | null;
}) {
  const ui = useUiText();
  if (loading) {
    return (
      <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"Price Since Entry"} /></h2>
        <p className="mt-3 text-sm text-slate-400"><UiText text={"Loading price history..."} /></p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"Price Since Entry"} /></h2>
        <p className="mt-3 text-sm text-rose-200">{<UiText text={error} />}</p>
      </section>
    );
  }

  if (!history || history.points.length === 0 || typeof history.entryPrice !== "number") {
    return (
      <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"Price Since Entry"} /></h2>
        <p className="mt-3 text-sm text-slate-400"><UiText text={"Chart starts after the first end-of-day mark."} /></p>
      </section>
    );
  }

  const visiblePoints = downsample(history.points, 240);
  const closes = visiblePoints.map((point) => point.close);
  const minPrice = Math.min(...closes, history.entryPrice);
  const maxPrice = Math.max(...closes, history.entryPrice);
  const padding = Math.max(0.01, (maxPrice - minPrice) * 0.08);
  const yMin = Math.max(0, minPrice - padding);
  const yMax = maxPrice + padding;
  const path = buildPath(visiblePoints, yMin, yMax);
  const entryY = priceY(history.entryPrice, yMin, yMax);
  const firstPoint = history.points[0];
  const latestPoint = history.points[history.points.length - 1];
  const latestReturnClass = typeof latestPoint.returnValue === "number" ? markToneClass(latestPoint.returnValue) : "text-slate-200";
  const latestX = pointX(visiblePoints.length - 1, visiblePoints.length);
  const latestY = priceY(visiblePoints[visiblePoints.length - 1].close, yMin, yMax);

  return (
    <section className="rounded-2xl border border-white/15 bg-slate-950/55 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-[var(--font-sora)] text-lg font-semibold text-cyan-100"><UiText text={"Price Since Entry"} /></h2>
          <p className="mt-1 text-sm text-slate-400"><UiText text={"Daily end-of-day closes from "} />{formatDateLabel(firstPoint.date)}<UiText text={" to "} />{formatDateLabel(latestPoint.date)}.
          </p>
        </div>
        <div className="text-sm sm:text-right">
          <p className="text-slate-400"><UiText text={"Latest close"} /></p>
          <p className="font-semibold text-slate-100">{formatCurrency(latestPoint.close)}</p>
          <p className={`font-semibold ${latestReturnClass}`}>{pointReturnText(latestPoint)}</p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label={ui("Daily close price chart since prediction entry")}
          className="h-auto w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <rect width={CHART_WIDTH} height={CHART_HEIGHT} fill="#020617" />
          <line
            x1={CHART_PADDING.left}
            x2={CHART_WIDTH - CHART_PADDING.right}
            y1={entryY}
            y2={entryY}
            stroke="#64748b"
            strokeDasharray="6 6"
            strokeWidth="1"
          />
          <text x={CHART_PADDING.left} y={entryY - 8} fill="#94a3b8" fontSize="12"><UiText text={"Entry "} />{formatCurrency(history.entryPrice)}
          </text>
          <line
            x1={CHART_PADDING.left}
            x2={CHART_PADDING.left}
            y1={CHART_PADDING.top}
            y2={CHART_HEIGHT - CHART_PADDING.bottom}
            stroke="#1e293b"
            strokeWidth="1"
          />
          <line
            x1={CHART_PADDING.left}
            x2={CHART_WIDTH - CHART_PADDING.right}
            y1={CHART_HEIGHT - CHART_PADDING.bottom}
            y2={CHART_HEIGHT - CHART_PADDING.bottom}
            stroke="#1e293b"
            strokeWidth="1"
          />
          <text x={CHART_PADDING.left} y={CHART_HEIGHT - 10} fill="#94a3b8" fontSize="12">
            {formatDateLabel(firstPoint.date)}
          </text>
          <text x={CHART_WIDTH - CHART_PADDING.right - 54} y={CHART_HEIGHT - 10} fill="#94a3b8" fontSize="12">
            {formatDateLabel(latestPoint.date)}
          </text>
          <text x="8" y={priceY(yMax, yMin, yMax) + 4} fill="#94a3b8" fontSize="12">
            {formatCurrency(yMax)}
          </text>
          <text x="8" y={priceY(yMin, yMin, yMax)} fill="#94a3b8" fontSize="12">
            {formatCurrency(yMin)}
          </text>
          <path d={path} fill="none" stroke="#67e8f9" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
          {visiblePoints.map((point, index) => {
            if (index !== 0 && index !== visiblePoints.length - 1 && visiblePoints.length > 48) {
              return null;
            }

            const x = pointX(index, visiblePoints.length);
            const y = priceY(point.close, yMin, yMax);
            return (
              <circle key={`${point.date}-${index}`} cx={x} cy={y} r={index === visiblePoints.length - 1 ? 5 : 3} fill="#67e8f9">
                <title>{pointTitle(point)}</title>
              </circle>
            );
          })}
          <circle cx={latestX} cy={latestY} r="8" fill="none" stroke="#67e8f9" strokeWidth="2" />
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span><UiText text={"Entry "} />{formatCurrency(history.entryPrice)}<UiText text={" on "} />{history.entryDate}</span>
        <span>{history.points.length}<UiText text={" marked trading days"} /></span>
        {history.truncated ? <span><UiText text={"Showing latest "} />{history.points.length}<UiText text={" marks"} /></span> : null}
      </div>
    </section>
  );
}
