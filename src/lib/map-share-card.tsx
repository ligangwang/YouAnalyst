import { ImageResponse } from "next/og";

export function createMapShareImage(nvidia: boolean) {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "48px 60px", background: "#081322", color: "#f1f5f9", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#67e8f9" }}>YouAnalyst</div>
        <div style={{ display: "flex", fontSize: 19, color: "#a8b8ce", letterSpacing: 2 }}>COMPANY CONNECTIONS</div>
      </div>
      <div style={{ display: "flex", fontSize: 49, fontWeight: 700, marginTop: 44, letterSpacing: -1 }}>
        {nvidia ? "AI competition goes beyond GPUs." : "See the businesses behind a stock."}
      </div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 36 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 330, padding: "26px 30px", borderRadius: 18, background: "#13273a", border: "2px solid #38bdf8" }}>
          <div style={{ display: "flex", fontSize: 20, color: "#67e8f9" }}>{nvidia ? "$NVDA" : "START WITH A COMPANY"}</div>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 700, marginTop: 10 }}>{nvidia ? "NVIDIA" : "Your research"}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 290 }}>
          <div style={{ display: "flex", fontSize: 20, color: "#cbd5e1", marginBottom: 15 }}>{nvidia ? "Networking competitors" : "Follow the connections"}</div>
          <div style={{ display: "flex", width: "100%", height: 3, background: "#38bdf8" }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 330, padding: "26px 30px", borderRadius: 18, background: "#13273a", border: "2px solid #38bdf8" }}>
          <div style={{ display: "flex", fontSize: 20, color: "#67e8f9" }}>{nvidia ? "$ANET" : "INSPECT THE SOURCE"}</div>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 700, marginTop: 10 }}>{nvidia ? "Arista Networks" : "Filing evidence"}</div>
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 22, color: "#a8b8ce", marginTop: 29 }}>
        {nvidia ? "Example from NVIDIA’s 10-K · February 25, 2026" : "Suppliers, customers and competitors · Sources linked"}
      </div>
      <div style={{ display: "flex", marginTop: "auto", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #294056", paddingTop: 24 }}>
        <div style={{ display: "flex", fontSize: 26, fontWeight: 700 }}>Explore the filing evidence →</div>
        <div style={{ display: "flex", fontSize: 22, color: "#67e8f9" }}>youanalyst.com</div>
      </div>
    </div>,
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
