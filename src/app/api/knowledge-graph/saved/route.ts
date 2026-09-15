import { readCompanyFollows, updateCompanyFollow } from "@/lib/company-follows-store";
import { getDecodedUserFromRequest } from "@/lib/firebase/auth";

import { createSavedCompanyHandlers } from "@/lib/industry-graph/saved-companies";
import { loadKnowledgeGraph } from "@/lib/knowledge-graph/service";

export const runtime = "nodejs";
const handlers = createSavedCompanyHandlers({
  authenticate: getDecodedUserFromRequest,
  async exists(ticker) {
    return (await loadKnowledgeGraph()).nodes.some((node) => node.kind === "COMPANY" && node.market === "US" && node.symbol === ticker);
  },
  async read(uid) {
    return (await readCompanyFollows(uid)).filter(id => id.startsWith("US:")).map(id => id.slice(3));
  },
  async update(uid, ticker, saved) {
    return (await updateCompanyFollow(uid, `US:${ticker}`, saved)).filter(id => id.startsWith("US:")).map(id => id.slice(3));
  },
});
export const GET = handlers.GET;
export const POST = handlers.POST;
