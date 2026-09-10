import { createRoot } from "react-dom/client";
import Home from "../../src/app/map/page";

void Home({ searchParams: Promise.resolve({ company: new URLSearchParams(window.location.search).get("company") ?? undefined }) })
  .then((element) => createRoot(document.getElementById("root")!).render(element));
