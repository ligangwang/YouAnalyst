import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';

// Read stored counters only. Never call OpenAI, execute jobs, or serialize source data.
if (process.env.GCP_PROJECT_ID !== 'ifindata-80905') throw new Error('Production project required');
initializeApp({ credential: applicationDefault(), projectId: process.env.GCP_PROJECT_ID });
const db = getFirestore();
const groups = new Map();
const purposes = new Set(['ai_analyst_generation','company_graph_extraction','industry_research','earnings_calendar_extraction','news_headline_translation','relationship_summary_translation','news_article_analysis']);
const models = new Set(['gpt-6-luna','gpt-5.6-sol','gpt-5.5','gpt-5.4','gpt-5.4-mini','gpt-5.2']);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const label = (value, allowed) => allowed.has(value) ? value : 'other';
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
function add(key, value) {
  const row = groups.get(key) ?? { group:key, count:0, inputTokens:0, outputTokens:0, cachedTokens:0, reasoningTokens:0, costUsd:0, unknownCostCount:0, firstAt:null, lastAt:null };
  row.count++;
  for (const field of ['inputTokens','outputTokens','cachedTokens','reasoningTokens']) row[field] += number(value[field]);
  if (typeof value.costUsd === 'number' && Number.isFinite(value.costUsd)) row.costUsd += number(value.costUsd); else row.unknownCostCount++;
  const at = date(value.at);
  if (at) { if (!row.firstAt || at < row.firstAt) row.firstAt = at; if (!row.lastAt || at > row.lastAt) row.lastAt = at; }
  groups.set(key,row);
}
async function scan(query, visit) {
  let read = 0, cursor;
  while (read < 50_000) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(500).get();
    for (const doc of page.docs) visit(doc.data());
    read += page.size;
    if (page.size < 500) return { read, truncated:false };
    cursor = page.docs.at(-1);
  }
  return { read, truncated:true };
}
const events = await scan(db.collection('openai_usage_events').orderBy(FieldPath.documentId())
  .select('purpose','model','createdAt','inputTokens','outputTokens','cachedInputTokens','estimatedCostUsd','usage.output_tokens_details'), value => {
  const row = { inputTokens:value.inputTokens, outputTokens:value.outputTokens, cachedTokens:value.cachedInputTokens,
    reasoningTokens:value.usage?.output_tokens_details?.reasoning_tokens, costUsd:value.estimatedCostUsd, at:value.createdAt };
  add(`events/${label(value.purpose,purposes)}/${label(value.model,models)}`,row);
  const at = date(value.createdAt);
  if (at) add(`day/${new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at))}`,row);
});
const ledger = await scan(db.collection('company_research_runs').orderBy(FieldPath.documentId())
  .where(FieldPath.documentId(),'>=','_graph_budget_request_').where(FieldPath.documentId(),'<','_graph_budget_request`')
  .select('model','status','priceVersion','usageInputTokens','usageOutputTokens','cachedTokens','spentMicros','reservedMicros','createdAt'), value => {
  const status = ['reserved','settled'].includes(value.status) ? value.status : 'other';
  const price = ['gpt-5.6-sol-standard-2026-10-01','gpt-5.6-sol-flex-full-context-2026-10-02','gpt-6-luna-flex-full-context-2026-10-13'].includes(value.priceVersion) ? value.priceVersion : 'other';
  add(`graph-ledger/${label(value.model,models)}/${status}/${price}`,{
    inputTokens:value.usageInputTokens, outputTokens:value.usageOutputTokens, cachedTokens:value.cachedTokens,
    costUsd:status === 'settled' && typeof value.spentMicros === 'number' ? value.spentMicros/1_000_000 : null, at:value.createdAt });
  if (status === 'reserved') add('graph-outstanding-holds',{costUsd:number(value.reservedMicros)/1_000_000,at:value.createdAt});
});
console.log(JSON.stringify({ measuredAt:new Date().toISOString(), timezone:'America/New_York', events, ledger,
  note:'Stored events are not invoice totals; graph-ledger costs are authoritative for graph tier pricing. Holds are potential liability, not confirmed spend. Other purposes may include foreground work.',
  groups:[...groups.values()].sort((a,b)=>a.group.localeCompare(b.group)).map(row=>({...row,costUsd:Math.round(row.costUsd*1_000_000)/1_000_000})) }));
