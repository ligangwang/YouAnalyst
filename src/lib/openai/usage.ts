import { getAdminFirestore } from "@/lib/firebase/admin";
import type { Firestore, Query } from "firebase-admin/firestore";

export type OpenAiUsagePurpose = "ai_analyst_generation" | "company_graph_extraction" | "industry_research" | "earnings_calendar_extraction";

type OpenAiPriceRate = {
  input: number;
  cachedInput: number;
  output: number;
};

export type OpenAiUsageEvent = {
  id: string;
  provider: "openai";
  purpose: OpenAiUsagePurpose;
  model: string;
  responseId: string | null;
  createdAt: string;
  usage: Record<string, unknown> | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  pricing: {
    currency: "USD";
    unit: "per_1m_tokens";
    source: "env" | "built_in" | "unknown";
    input: number | null;
    cachedInput: number | null;
    output: number | null;
  };
  metadata: Record<string, string | number | boolean | null>;
};

export type OpenAiUsageSummary = {
  eventCount: number;
  unknownCostCount?: number;
  estimatedCostUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const DEFAULT_OPENAI_PRICE_RATES: Record<string, OpenAiPriceRate> = {
  "gpt-6-luna": { input: 0.10, cachedInput: 0.01, output: 0.50 },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14 },
};

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function readUsageNumber(usage: Record<string, unknown> | null, key: string): number {
  return readNumber(usage?.[key]);
}

function readNestedUsageNumber(
  usage: Record<string, unknown> | null,
  parentKey: string,
  childKey: string,
): number {
  const parent = usage?.[parentKey];
  return parent && typeof parent === "object" ? readNumber((parent as Record<string, unknown>)[childKey]) : 0;
}

function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

function readEnvPriceRates(): Record<string, OpenAiPriceRate> {
  const raw = process.env.OPENAI_COST_RATES_JSON?.trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([model, value]) => {
        const source = value && typeof value === "object" ? value as Record<string, unknown> : null;
        if (!source) {
          return [];
        }

        const input = readNumber(source.input);
        const cachedInput = readNumber(source.cachedInput);
        const output = readNumber(source.output);
        if (!input || !output) {
          return [];
        }

        return [[normalizeModel(model), { input, cachedInput, output }]];
      }),
    );
  } catch {
    return {};
  }
}

function priceRateForModel(model: string): { rate: OpenAiPriceRate | null; source: "env" | "built_in" | "unknown" } {
  const normalizedModel = normalizeModel(model);
  const envRates = readEnvPriceRates();
  const envRate = envRates[normalizedModel];
  if (envRate) {
    return { rate: envRate, source: "env" };
  }

  const builtInRate = DEFAULT_OPENAI_PRICE_RATES[normalizedModel] ??
    DEFAULT_OPENAI_PRICE_RATES[normalizedModel.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  if (builtInRate) {
    return { rate: builtInRate, source: "built_in" };
  }

  return { rate: null, source: "unknown" };
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function estimateCostUsd(input: {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}): Pick<OpenAiUsageEvent, "estimatedCostUsd" | "pricing"> {
  const { rate, source } = priceRateForModel(input.model);
  if (!rate) {
    return {
      estimatedCostUsd: null,
      pricing: {
        currency: "USD",
        unit: "per_1m_tokens",
        source,
        input: null,
        cachedInput: null,
        output: null,
      },
    };
  }

  const cachedInputTokens = Math.min(input.cachedInputTokens, input.inputTokens);
  const billableInputTokens = Math.max(0, input.inputTokens - cachedInputTokens);
  const cost = (billableInputTokens * rate.input) / 1_000_000 +
    (cachedInputTokens * rate.cachedInput) / 1_000_000 +
    (input.outputTokens * rate.output) / 1_000_000;

  return {
    estimatedCostUsd: roundCost(cost),
    pricing: {
      currency: "USD",
      unit: "per_1m_tokens",
      source,
      input: rate.input,
      cachedInput: rate.cachedInput,
      output: rate.output,
    },
  };
}

function eventDocId(input: { responseId: string | null; purpose: OpenAiUsagePurpose; createdAt: string }): string {
  if (input.responseId) {
    return input.responseId.replace(/[^A-Za-z0-9_-]/g, "_");
  }

  return `${input.purpose}_${Date.parse(input.createdAt)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildOpenAiUsageEvent(input: {
  purpose: OpenAiUsagePurpose;
  model: string;
  responseId: string | null;
  usage: Record<string, unknown> | null;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  createdAt?: string;
}): OpenAiUsageEvent {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const inputTokens = readUsageNumber(input.usage, "input_tokens");
  const cachedInputTokens = readNestedUsageNumber(input.usage, "input_tokens_details", "cached_tokens");
  const outputTokens = readUsageNumber(input.usage, "output_tokens");
  const totalTokens = readUsageNumber(input.usage, "total_tokens") || inputTokens + outputTokens;
  const estimate = estimateCostUsd({
    model: input.model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
  });

  return {
    id: eventDocId({ responseId: input.responseId, purpose: input.purpose, createdAt }),
    provider: "openai",
    purpose: input.purpose,
    model: input.model,
    responseId: input.responseId,
    createdAt,
    usage: input.usage,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    ...estimate,
    estimatedCostUsd: input.usage ? estimate.estimatedCostUsd : null,
    metadata: Object.fromEntries(
      Object.entries(input.metadata ?? {}).filter((entry): entry is [string, string | number | boolean | null] =>
        entry[1] !== undefined),
    ),
  };
}

export async function recordOpenAiUsageEvent(input: Parameters<typeof buildOpenAiUsageEvent>[0]): Promise<OpenAiUsageEvent> {
  const event = buildOpenAiUsageEvent(input);
  await getAdminFirestore().collection("openai_usage_events").doc(event.id).set(event, { merge: true });
  return event;
}

export async function safeRecordOpenAiUsageEvent(
  input: Parameters<typeof buildOpenAiUsageEvent>[0],
): Promise<OpenAiUsageEvent | null> {
  try {
    return await recordOpenAiUsageEvent(input);
  } catch (error) {
    console.warn("Failed to record OpenAI usage event", error);
    return null;
  }
}

export function summarizeOpenAiUsageEvents(events: OpenAiUsageEvent[]): OpenAiUsageSummary {
  return events.reduce<OpenAiUsageSummary>((summary, event) => ({
    eventCount: summary.eventCount + 1,
    unknownCostCount: (summary.unknownCostCount ?? 0) + (event.estimatedCostUsd === null ? 1 : 0),
    estimatedCostUsd: roundCost(summary.estimatedCostUsd + (event.estimatedCostUsd ?? 0)),
    inputTokens: summary.inputTokens + event.inputTokens,
    cachedInputTokens: summary.cachedInputTokens + event.cachedInputTokens,
    outputTokens: summary.outputTokens + event.outputTokens,
    totalTokens: summary.totalTokens + event.totalTokens,
  }), {
    eventCount: 0,
    unknownCostCount: 0,
    estimatedCostUsd: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });
}

async function readUsagePeriod(query: Query): Promise<OpenAiUsageEvent[]> {
  const events:OpenAiUsageEvent[]=[];
  let page = await query.limit(500).get();
  while(true) {
    events.push(...page.docs.map(doc=>({...doc.data(),id:doc.id}) as OpenAiUsageEvent));
    if(page.size<500)break;
    page=await query.startAfter(page.docs.at(-1)!).limit(500).get();
  }
  return events;
}

export async function listOpenAiUsageEvents(limit = 100, db:Firestore = getAdminFirestore(), now = new Date()): Promise<{
  events: OpenAiUsageEvent[];
  summary: OpenAiUsageSummary;
  last30Days: OpenAiUsageSummary;
  calendarLast30Days: OpenAiUsageSummary;
  calendarThisQuarter: OpenAiUsageSummary;
}> {
  const snapshot = await db
    .collection("openai_usage_events")
    .orderBy("createdAt", "desc")
    .limit(Math.max(1, Math.min(500, Math.trunc(limit))))
    .get();
  const events = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as OpenAiUsageEvent);
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1_000;
  const base = db.collection('openai_usage_events');
  const quarter = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth()/3)*3, 1)).toISOString();
  const [periodEvents, quarterEvents] = await Promise.all([
    readUsagePeriod(base.where('createdAt','>=',new Date(thirtyDaysAgo).toISOString()).orderBy('createdAt')),
    readUsagePeriod(base.where('purpose','==','earnings_calendar_extraction').where('createdAt','>=',quarter).orderBy('createdAt')),
  ]);

  return {
    events,
    summary: summarizeOpenAiUsageEvents(events),
    last30Days:summarizeOpenAiUsageEvents(periodEvents),
    calendarLast30Days:summarizeOpenAiUsageEvents(periodEvents.filter(event=>event.purpose==='earnings_calendar_extraction')),
    calendarThisQuarter:summarizeOpenAiUsageEvents(quarterEvents),
  };
}
