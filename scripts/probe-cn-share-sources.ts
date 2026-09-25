// Read-only check of the official A-share sources through the job's real
// fetchers and parsers. No credentials, no Firestore; prints what it parsed.
import { createCnRequester, createCnSources } from "../src/lib/fundamentals/cn-sources";
import { combineShareCount, shanghaiDate, sourceFailed } from "../src/lib/fundamentals/cn-market-cap";
import { CN_COMPANY_ID } from "../src/lib/knowledge-graph/cn-companies";

const ids = (process.argv[2] || "XSHG:600584,XSHG:688981,XSHE:000063,XSHE:300308,XSHG:601138").split(",")
  .map(value => value.trim().toUpperCase()).map(value => /^\d{6}$/.test(value) ? `${value.startsWith("6") ? "XSHG" : "XSHE"}:${value}` : value);

async function main() {
  const invalid = ids.filter(id => !CN_COMPANY_ID.test(id));
  if (invalid.length) throw new Error(`Unsupported ids: ${invalid.join(", ")}`);
  const sources = createCnSources(createCnRequester({ spacingMs: 500, context: { job: "probe-cn-share-sources" } }));
  const today = shanghaiDate();
  for (const id of ids) {
    const settle = async <T>(work: () => Promise<T>) => work().catch(error => ({ reason: `error: ${(error as Error).message}` }));
    const structure = await settle(() => sources.structure(id, today));
    const listing = await settle(() => sources.listing(id, new Date().toISOString()));
    const exchange = await settle(() => sources.exchange(id, today));
    const orgId = await settle(() => sources.orgId(id));
    const actions = typeof orgId === "string" ? await settle(() => sources.actions(id, orgId, today)) : { reason: "missing_org_id" };
    const count = sourceFailed(structure) ? structure : combineShareCount({ structure, listing: sourceFailed(listing) ? null : listing,
      exchange: sourceFailed(exchange) ? null : exchange, exchangeStatus: sourceFailed(exchange) ? exchange.reason : "matched", fetchedAt: new Date().toISOString(), today });
    console.log(JSON.stringify({ id, structure, listing, exchange, orgId, actions, count }, null, 1));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
