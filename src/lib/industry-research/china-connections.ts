import { canonicalRelationship, normalizeResearch, record, text, type ResearchResult } from "./model";
import { validChinaId } from "./china";
export function normalizeChinaConnections(value: unknown, urls: string[], candidates: { id: string; name: string }[]): ResearchResult {
  // Reuse provenance validation through reversible, valid ticker aliases; never publish those aliases.
  const ids = candidates.filter(c => validChinaId(c.id));
  const aliases = new Map(ids.map((c, i) => [c.id, `C${i}`]));
  const reverse = new Map([...aliases].map(([id, alias]) => [alias, id]));
  const raw = record(value);
  const rows = Array.isArray(raw.relationships) ? raw.relationships : [];
  const result: ResearchResult = { companies: [], relationships: [], withheld: Math.max(0, rows.length - 40) };
  for (const value of rows.slice(0, 40)) {
    const raw = record(value), endpoints = [text(raw.source), text(raw.target)];
    const parsed = normalizeResearch({ companies: ids.filter(c => endpoints.includes(c.id)).map(c => ({ ticker: aliases.get(c.id), name: c.name, segment: "other" })), relationships: [{ ...raw, source: aliases.get(endpoints[0]), target: aliases.get(endpoints[1]) }] }, urls);
    result.withheld += parsed.withheld;
    for (const r of parsed.relationships) {
      const relation = { ...canonicalRelationship(reverse.get(r.source)!, reverse.get(r.target)!, r.type)!, evidence: r.evidence };
      const prior = result.relationships.find(x => x.id === relation.id);
      if (prior) prior.evidence = [...prior.evidence, ...relation.evidence].filter((e, i, all) => all.findIndex(x => x.url === e.url) === i);
      else result.relationships.push(relation);
    }
  }
  return result;
}
