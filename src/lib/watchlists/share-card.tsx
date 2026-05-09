import { ImageResponse } from "next/og";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { normalizeTicker } from "@/lib/predictions/types";
import { getWatchlistDetail } from "@/lib/watchlists/service";

export const watchlistShareCardSize = {
  width: 1200,
  height: 630,
};

export const watchlistShareCardContentType = "image/png";

type ShareCardWatchlist = {
  name: string;
  description: string;
  liveReturn: number | null;
  settledReturn: number | null;
  livePredictionCount: number;
  settledPredictionCount: number;
  tickers: string[];
};

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
        Public watchlist unavailable
      </div>
    </div>
  );
}

function formatReturnPercent(returnValue: number): string {
  const percent = returnValue * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

function returnToneColor(returnValue: number): string {
  if (returnValue > 0) {
    return "#6ee7b7";
  }
  if (returnValue < 0) {
    return "#fda4af";
  }
  return "#cbd5e1";
}

function metricLabel(watchlist: ShareCardWatchlist): string {
  if (typeof watchlist.liveReturn === "number") {
    return "Live return";
  }
  if (typeof watchlist.settledReturn === "number") {
    return "Settled return";
  }
  return "Live return";
}

function metricValue(watchlist: ShareCardWatchlist): string {
  if (typeof watchlist.liveReturn === "number") {
    return formatReturnPercent(watchlist.liveReturn);
  }
  if (typeof watchlist.settledReturn === "number") {
    return formatReturnPercent(watchlist.settledReturn);
  }
  return "Not marked";
}

function metricTone(watchlist: ShareCardWatchlist): string {
  if (typeof watchlist.liveReturn === "number") {
    return returnToneColor(watchlist.liveReturn);
  }
  if (typeof watchlist.settledReturn === "number") {
    return returnToneColor(watchlist.settledReturn);
  }
  return "#cbd5e1";
}

async function getShareCardWatchlist(watchlistId: string): Promise<ShareCardWatchlist | null> {
  const watchlist = await getWatchlistDetail(watchlistId);
  if (!watchlist) {
    return null;
  }

  const db = getAdminFirestore();
  const userSnapshot = await db.collection("users").doc(watchlist.userId).get();

  if (!userSnapshot.exists) {
    return null;
  }

  const user = userSnapshot.data() as Record<string, unknown>;
  const settings =
    user.settings && typeof user.settings === "object"
      ? (user.settings as Record<string, unknown>)
      : null;

  if (watchlist.isPublic === false || settings?.isPublic === false || watchlist.archivedAt) {
    return null;
  }

  const tickers = Array.from(
    new Set(
      [...watchlist.livePredictions, ...watchlist.settledPredictions]
        .map((prediction) => normalizeTicker(prediction.ticker))
        .filter(Boolean),
    ),
  ).slice(0, 4);

  return {
    name: watchlist.name,
    description: watchlist.description?.trim() ?? "",
    liveReturn: watchlist.metrics.liveReturn,
    settledReturn: watchlist.metrics.settledReturn,
    livePredictionCount: watchlist.metrics.livePredictionCount,
    settledPredictionCount: watchlist.metrics.settledPredictionCount,
    tickers,
  };
}

function shareCardImage(watchlist: ShareCardWatchlist) {
  const summary = `${watchlist.livePredictionCount} live call${watchlist.livePredictionCount === 1 ? "" : "s"} - ${watchlist.settledPredictionCount} settled`;

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
        padding: "56px 64px",
        width: "100%",
      }}
    >
      <Brand />
      <div style={{ display: "flex", flexDirection: "column", marginTop: 88, maxWidth: "1020px" }}>
        <div style={{ color: "#f8fafc", display: "flex", fontSize: 60, fontWeight: 700, lineHeight: 1.1 }}>
          {watchlist.name}
        </div>
        {watchlist.description ? (
          <div style={{ color: "#cbd5e1", display: "flex", fontSize: 26, lineHeight: 1.45, marginTop: 22 }}>
            {watchlist.description}
          </div>
        ) : null}
        <div style={{ alignItems: "baseline", display: "flex", fontSize: 30, gap: 12, marginTop: 28 }}>
          <div style={{ color: "#cbd5e1", display: "flex" }}>{metricLabel(watchlist)}:</div>
          <div style={{ color: metricTone(watchlist), display: "flex" }}>{metricValue(watchlist)}</div>
        </div>
        <div style={{ color: "#cbd5e1", display: "flex", fontSize: 28, marginTop: 18 }}>
          {summary}
        </div>
        {watchlist.tickers.length > 0 ? (
          <div style={{ color: "#38bdf8", display: "flex", fontSize: 28, fontWeight: 600, marginTop: 18 }}>
            {watchlist.tickers.join(" - ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export async function createWatchlistShareImage(watchlistId: string): Promise<ImageResponse> {
  let watchlist: ShareCardWatchlist | null = null;
  try {
    watchlist = await getShareCardWatchlist(watchlistId);
  } catch {
    watchlist = null;
  }

  return new ImageResponse(watchlist ? shareCardImage(watchlist) : fallbackImage(), watchlistShareCardSize);
}
