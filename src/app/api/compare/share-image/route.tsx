import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { parseCompareConfig } from "@/lib/compare";
import { companyCompareColor } from "@/lib/compare-appearance";

export async function GET(request: NextRequest) {
  const config = parseCompareConfig(request.nextUrl.searchParams);
  return new ImageResponse(<div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#07111d", color: "#f8fafc", padding: "56px 64px", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", color: "#67e8f9", fontSize: 22, letterSpacing: 5 }}>YOUANALYST · COMPARE</div>
    <div style={{ display: "flex", fontSize: 54, fontWeight: 700, marginTop: 28 }}>Every stock. Same starting line.</div>
    <div style={{ display: "flex", fontSize: 23, color: "#94a3b8", marginTop: 18 }}>{config.start} → {config.end} · {config.style === "bar" ? "Bar race" : "Line race"}</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 48 }}>{config.symbols.map(symbol => <div key={symbol} style={{ display: "flex", border: `2px solid ${config.colors?.[symbol] ?? companyCompareColor(symbol)}`, color: config.colors?.[symbol] ?? companyCompareColor(symbol), borderRadius: 12, padding: "12px 20px", fontSize: 27 }}>{symbol}</div>)}</div>
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", color: "#94a3b8", fontSize: 22 }}><span>Price return comparison</span><span>▶ Open to play · youanalyst.com</span></div>
  </div>, { width: 1200, height: 630 });
}
