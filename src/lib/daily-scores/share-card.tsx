import { ImageResponse } from "next/og";
import { isDailyInstitutionalMoveShareKind, type DailyInstitutionalMoveShareKind } from "@/lib/daily-scores/public-share";
import { getDailyScores, type DailyCallHighlight, type DailyInstitutionalMove } from "@/lib/daily-scores/service";
import { normalizeTicker } from "@/lib/predictions/types";

export const dailyShareCardSize = {
  width: 1200,
  height: 630,
};

export const dailyShareCardContentType = "image/png";

function Brand() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 34, fontWeight: 800, color: "#f8fafc" }}>
        You<span style={{ color: "#22c55e" }}>Analyst</span>
      </div>
      <div style={{ color: "#94a3b8", display: "flex", fontSize: 18, marginTop: 8 }}>
        Your watchlist. Your track record.
      </div>
    </div>
  );
}

function dateLabel(value: string | null): string {
  if (!value) {
    return "Latest daily update";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function directionArrow(direction: "UP" | "DOWN" | null): string {
  if (direction === "UP") {
    return "UP";
  }
  if (direction === "DOWN") {
    return "DOWN";
  }
  return "";
}

function tickerText(call: DailyCallHighlight): string {
  const ticker = call.ticker ? normalizeTicker(call.ticker) : "";
  return ticker || "Unknown ticker";
}

function userName(call: DailyCallHighlight): string {
  return call.nickname ? `@${call.nickname}` : call.displayName ?? "Anonymous";
}

function scoreText(score: number): string {
  const sign = score > 0 ? "+" : "";
  return `${sign}${Math.round(score)}`;
}

function dailyReturnText(value: number | null): string {
  if (value === null) {
    return "Missing daily data";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function currencyText(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function signedCurrencyText(value: number): string {
  const formatted = currencyText(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function returnToneColor(value: number | null): string {
  if (value === null) {
    return "#cbd5e1";
  }
  if (value > 0) {
    return "#6ee7b7";
  }
  if (value < 0) {
    return "#fda4af";
  }
  return "#cbd5e1";
}

function findInstitutionalMove(
  moves: Awaited<ReturnType<typeof getDailyScores>>["institutionalMoves"],
  kind: DailyInstitutionalMoveShareKind,
  ticker: string,
): DailyInstitutionalMove | null {
  const normalizedTicker = normalizeTicker(ticker);
  const items = kind === "increase" ? moves.increases : moves.decreases;
  return items.find((move) => normalizeTicker(move.ticker) === normalizedTicker) ?? null;
}

function fallbackImage() {
  return (
    <div
      style={{
        alignItems: "center",
        background: "#020617",
        color: "#e0f2fe",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <Brand />
      <div style={{ color: "#94a3b8", display: "flex", fontSize: 30, marginTop: 28 }}>
        Daily highlights unavailable
      </div>
    </div>
  );
}

function institutionalMoveFallbackImage(date: string | null, kind: string, ticker: string) {
  const normalizedTicker = normalizeTicker(ticker) || "Ticker";
  const label = kind === "decrease" ? "Institutional 13F decrease" : "Institutional 13F increase";

  return (
    <div
      style={{
        alignItems: "flex-start",
        background: "#020617",
        color: "#e0f2fe",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "flex-start",
        padding: "52px 64px",
        width: "100%",
      }}
    >
      <Brand />
      <div style={{ color: "#38bdf8", display: "flex", fontSize: 26, fontWeight: 700, marginTop: 60 }}>
        {label}
      </div>
      <div style={{ color: "#f8fafc", display: "flex", fontSize: 68, fontWeight: 800, marginTop: 16 }}>
        {normalizedTicker}
      </div>
      <div style={{ color: "#94a3b8", display: "flex", fontSize: 30, marginTop: 28 }}>
        Latest reported institutional 13F context
      </div>
      <div style={{ color: "#64748b", display: "flex", fontSize: 24, marginTop: 14 }}>
        {dateLabel(date)}
      </div>
    </div>
  );
}

function shareCardImage(date: string | null, topCalls: DailyCallHighlight[]) {
  const callOfTheDay = topCalls[0] ?? null;

  return (
    <div
      style={{
        alignItems: "flex-start",
        background: "#020617",
        color: "#e0f2fe",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "flex-start",
        padding: "52px 64px",
        width: "100%",
      }}
    >
      <Brand />
      <div style={{ color: "#38bdf8", display: "flex", fontSize: 26, fontWeight: 700, marginTop: 60 }}>
        {dateLabel(date)}
      </div>
      <div style={{ color: "#f8fafc", display: "flex", fontSize: 52, fontWeight: 800, marginTop: 14 }}>
        Top Call Today
      </div>
      {callOfTheDay ? (
        <div
          style={{
            borderColor: "rgba(148, 163, 184, 0.22)",
            borderRadius: 24,
            borderStyle: "solid",
            borderWidth: 1,
            display: "flex",
            flexDirection: "column",
            marginTop: 38,
            padding: "34px 38px",
            width: "100%",
          }}
        >
          <div style={{ alignItems: "flex-start", display: "flex", justifyContent: "space-between", width: "100%" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ color: "#bae6fd", display: "flex", fontSize: 42, fontWeight: 800 }}>
                {directionArrow(callOfTheDay.direction)} {tickerText(callOfTheDay)}
              </div>
              <div style={{ color: "#cbd5e1", display: "flex", fontSize: 26, marginTop: 14 }}>
                by {userName(callOfTheDay)}
              </div>
            </div>
            <div style={{ alignItems: "flex-end", display: "flex", flexDirection: "column" }}>
              <div style={{ color: returnToneColor(callOfTheDay.dailyReturnChange), display: "flex", fontSize: 62, fontWeight: 800 }}>
                {dailyReturnText(callOfTheDay.dailyReturnChange)}
              </div>
              <div style={{ color: "#94a3b8", display: "flex", fontSize: 24, marginTop: 8 }}>
                {scoreText(callOfTheDay.dailyScoreChange)} score today
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ color: "#cbd5e1", display: "flex", fontSize: 30, marginTop: 40 }}>
          No daily highlights yet.
        </div>
      )}
    </div>
  );
}

function institutionalMoveImage(
  date: string | null,
  move: DailyInstitutionalMove,
  kind: DailyInstitutionalMoveShareKind,
) {
  const isIncrease = kind === "increase";
  const verb = isIncrease ? "Increased" : "Reduced";
  const amount = isIncrease ? signedCurrencyText(move.valueChangeUsd) : currencyText(Math.abs(move.valueChangeUsd));
  const accent = isIncrease ? "#6ee7b7" : "#fda4af";
  const statusLine = isIncrease
    ? `${move.newManagers} new / ${move.increasedManagers} increased`
    : `${move.reducedManagers} reduced / ${move.soldOutManagers} sold out`;

  return (
    <div
      style={{
        alignItems: "flex-start",
        background: "#020617",
        color: "#e0f2fe",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "flex-start",
        padding: "52px 64px",
        width: "100%",
      }}
    >
      <Brand />
      <div style={{ color: "#38bdf8", display: "flex", fontSize: 26, fontWeight: 700, marginTop: 52 }}>
        Institutional 13F move / {dateLabel(date)}
      </div>
      <div style={{ color: "#f8fafc", display: "flex", fontSize: 64, fontWeight: 800, marginTop: 16 }}>
        {normalizeTicker(move.ticker)}
      </div>
      <div
        style={{
          borderColor: "rgba(148, 163, 184, 0.22)",
          borderRadius: 24,
          borderStyle: "solid",
          borderWidth: 1,
          display: "flex",
          flexDirection: "column",
          marginTop: 34,
          padding: "34px 38px",
          width: "100%",
        }}
      >
        <div style={{ color: "#cbd5e1", display: "flex", fontSize: 30 }}>
          {move.nameOfIssuer}
        </div>
        <div style={{ alignItems: "flex-end", display: "flex", justifyContent: "space-between", marginTop: 30, width: "100%" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: accent, display: "flex", fontSize: 34, fontWeight: 800 }}>
              {verb} by
            </div>
            <div style={{ color: accent, display: "flex", fontSize: 58, fontWeight: 800, marginTop: 8 }}>
              {amount}
            </div>
          </div>
          <div style={{ alignItems: "flex-end", display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#f8fafc", display: "flex", fontSize: 34, fontWeight: 800 }}>
              {move.managerCount} manager{move.managerCount === 1 ? "" : "s"}
            </div>
            <div style={{ color: "#94a3b8", display: "flex", fontSize: 24, marginTop: 10 }}>
              {statusLine}
            </div>
            <div style={{ color: "#94a3b8", display: "flex", fontSize: 24, marginTop: 8 }}>
              Report {move.reportDate}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export async function createDailyShareImage(date: string | null): Promise<ImageResponse> {
  try {
    const result = await getDailyScores(date);
    return new ImageResponse(
      result.topCalls.length > 0 ? shareCardImage(result.date, result.topCalls) : fallbackImage(),
      dailyShareCardSize,
    );
  } catch {
    return new ImageResponse(fallbackImage(), dailyShareCardSize);
  }
}

export async function createDailyInstitutionalMoveShareImage(
  date: string,
  kind: string,
  ticker: string,
): Promise<ImageResponse> {
  try {
    if (!isDailyInstitutionalMoveShareKind(kind)) {
      return new ImageResponse(institutionalMoveFallbackImage(date, kind, ticker), dailyShareCardSize);
    }

    const result = await getDailyScores(date);
    const move = findInstitutionalMove(result.institutionalMoves, kind, ticker);
    return new ImageResponse(
      move ? institutionalMoveImage(result.date, move, kind) : institutionalMoveFallbackImage(result.date ?? date, kind, ticker),
      dailyShareCardSize,
    );
  } catch {
    return new ImageResponse(institutionalMoveFallbackImage(date, kind, ticker), dailyShareCardSize);
  }
}
