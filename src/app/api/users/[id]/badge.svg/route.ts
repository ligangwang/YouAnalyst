import { getAdminFirestore } from "@/lib/firebase/admin";
import { readUserAnalytics } from "@/lib/predictions/user-analytics";
import { NextRequest } from "next/server";
import {changeCached} from '@/lib/change-cache';

type UserStats = {
  totalPredictions: number;
  settledCalls: number;
  totalScore: number;
  followersCount: number;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function coerceStats(raw: unknown): UserStats {
  const source = (raw ?? {}) as Record<string, unknown>;

  return {
    totalPredictions: Number(source.totalPredictions ?? 0),
    settledCalls: Number(source.settledCalls ?? source.closedPredictions ?? 0),
    totalScore: Number(source.totalScore ?? 0),
    followersCount: Number(source.followersCount ?? 0),
  };
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}...`;
}

function formatScore(score: number): string {
  const rounded = Math.round(score);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("en-US")}`;
}

function formatCount(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function scoreColor(score: number): string {
  if (score > 0) {
    return "#67e8a7";
  }
  if (score < 0) {
    return "#fda4af";
  }
  return "#cbd5e1";
}

function buildBadgeSvg(input: {
  displayName: string;
  score: number;
  followersCount: number;
  totalPredictions: number;
}): string {
  const displayName = escapeXml(truncate(input.displayName, 28));
  const score = escapeXml(formatScore(input.score));
  const followers = escapeXml(formatCount(input.followersCount));
  const predictions = escapeXml(formatCount(input.totalPredictions));
  const scoreFill = scoreColor(input.score);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="180" viewBox="0 0 420 180" role="img" aria-label="YouAnalyst analyst badge for ${displayName}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#67e8f9"/>
    </linearGradient>
  </defs>
  <rect width="420" height="180" rx="8" fill="url(#bg)"/>
  <rect x="1" y="1" width="418" height="178" rx="7" fill="none" stroke="#164e63" stroke-width="2"/>
  <rect x="18" y="18" width="32" height="32" rx="7" fill="#083344" stroke="#22d3ee" stroke-width="1.5"/>
  <text x="34" y="40" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#a5f3fc">Y</text>
  <text x="62" y="31" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#ecfeff">YouAnalyst</text>
  <text x="62" y="47" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="600" fill="#67e8f9" letter-spacing="1">ANALYST</text>
  <path d="M18 66 H402" stroke="#164e63" stroke-width="1"/>
  <text x="22" y="92" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#f8fafc">${displayName}</text>
  <text x="22" y="128" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800" fill="${scoreFill}">${score}</text>
  <text x="24" y="147" font-family="Arial, Helvetica, sans-serif" font-size="12" fill="#94a3b8">Total Score</text>
  <rect x="248" y="101" width="148" height="44" rx="8" fill="#0f172a" stroke="#1e293b"/>
  <text x="264" y="120" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#e0f2fe">${followers}</text>
  <text x="264" y="137" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#94a3b8">followers</text>
  <text x="334" y="120" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" fill="#e0f2fe">${predictions}</text>
  <text x="334" y="137" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#94a3b8">settled</text>
  <rect x="18" y="162" width="384" height="2" rx="1" fill="url(#accent)" opacity="0.8"/>
</svg>`;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const db = getAdminFirestore();
    const svg=await changeCached(db,`analyst-badge:${id}`,['users','predictions'],async()=>{
    const snapshot = await db.collection("users").doc(id).get();

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() as Record<string, unknown>;
    const stats = coerceStats(data.stats);
    const statsSource = data.stats && typeof data.stats === "object" ? data.stats as Record<string, unknown> : {};
    const analytics = await readUserAnalytics(db, id, statsSource);
    const nickname = readString(data.nickname);
    const displayName = nickname ? `@${nickname}` : readString(data.displayName) ?? "YouAnalyst Analyst";
    return buildBadgeSvg({
      displayName,
      score: analytics.score,
      followersCount: stats.followersCount,
      totalPredictions: analytics.settledCalls,
    });
    });
    if(svg===null)return new Response('User not found',{status:404});
    return new Response(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to render badge";
    return new Response(message, { status: 500 });
  }
}
