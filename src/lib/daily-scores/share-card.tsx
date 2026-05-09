import { ImageResponse } from "next/og";
import { getDailyScores, type DailyCallHighlight } from "@/lib/daily-scores/service";
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
