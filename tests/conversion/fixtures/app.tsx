import { createRoot } from "react-dom/client";
import AuthRoutePage from "../../../src/app/auth/page";
import NewPredictionRoutePage from "../../../src/app/predictions/new/page";

const root = createRoot(document.getElementById("root")!);
async function renderRoute() {
  const query = new URLSearchParams(window.location.search);
  // Render the real route wrappers as well as the real client components.
  const element = window.location.pathname === "/auth"
    ? await AuthRoutePage({ searchParams: Promise.resolve({ next: query.get("next") ?? undefined }) })
    : window.location.pathname === "/predictions/new"
      ? await NewPredictionRoutePage({ searchParams: Promise.resolve({
        ticker: query.get("ticker") ?? undefined,
        watchlistId: query.get("watchlistId") ?? undefined,
      }) })
      : <p>Destination reached</p>;
  root.render(element);
}
window.addEventListener("route-change", () => void renderRoute());
void renderRoute();
