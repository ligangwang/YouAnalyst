type AnalyticsEvent = "industry_graph_view" | "industry_graph_load" | "industry_graph_error" |
  "graph_search" | "graph_company_select" | "graph_expand" | "graph_filter" | "graph_evidence_open" |
  "graph_source_open" | "graph_view_change" | "graph_company_open" | "graph_predict_click" |
  "graph_feedback_click" | "graph_save_view" | "auth_start" | "auth_cancel" | "auth_error" | "sign_up" | "login" | "prediction_publish";
type AnalyticsParams = {
  ticker?: string; segment?: string; relationship_type?: string; node_kind?: string;
  result_count?: number; node_count?: number; edge_count?: number; coverage_count?: number;
  view_mode?: string; method?: string; action?: string; visibility?: string;
};
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

// Allowlisted properties only. No raw searches, email, account IDs, quotations or URLs.
// Queue before Google's script loads; do not install a second gtag or send page views.
export function trackEvent(event: AnalyticsEvent, params: AnalyticsParams = {}) {
  if (typeof window === "undefined") return;
  try {
    const meta = document.querySelector('meta[name="youanalyst-analytics"]');
    if (meta?.getAttribute("content") !== "enabled") return;
    if (event === "industry_graph_view") {
      try { window.sessionStorage.setItem("youanalyst:graph-visit", String(Date.now())); } catch { /* Optional attribution. */ }
    }
    let graphOrigin = false;
    try {
      const visit = Number(window.sessionStorage.getItem("youanalyst:graph-visit"));
      graphOrigin = visit > 0 && Date.now() >= visit && Date.now() - visit < 30 * 60_000;
    } catch { /* Storage may be disabled. */ }
    const payload = { ...params, graph_origin: graphOrigin ? "yes" : "no", surface: "youanalyst", graph_version: "v1" };
    if (typeof window.gtag === "function") window.gtag("event", event, payload);
    else {
      window.dataLayer = window.dataLayer || [];
      // gtag's queue uses an Arguments object rather than a GTM-style event object.
      function enqueue(...args: unknown[]) {
        void args;
        // Google's pre-load queue expects the same Arguments shape as its bootstrap.
        // eslint-disable-next-line prefer-rest-params
        window.dataLayer!.push(arguments);
      }
      enqueue("event", event, payload);
    }
  } catch { /* Analytics must never interrupt product actions. */ }
}
