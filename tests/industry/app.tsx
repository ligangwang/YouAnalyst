import { createRoot } from "react-dom/client";
import { IndustryGraphHome } from "../../src/components/industry-graph-home";

createRoot(document.getElementById("root")!).render(<IndustryGraphHome initialTicker={new URLSearchParams(window.location.search).get("company") ?? ""} />);
