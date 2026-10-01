import { setTimeout as sleep } from "node:timers/promises";
import { getOpenAiApiKey, getOpenAiModel } from "@/lib/openai-runtime";
import {
  COMPANY_GRAPH_EDGE_DIRECTIONS,
  COMPANY_GRAPH_RELATIONSHIP_TYPES,
  COMPANY_GRAPH_TARGET_TYPES,
  type CompanyGraphEdgeDirection,
  type CompanyGraphRelationshipType,
  type CompanyGraphTargetType,
} from "@/lib/company-graph/types";

export type ExtractedCompanyGraphRelationship = {
  sourceName: string;
  targetName: string;
  targetType: CompanyGraphTargetType;
  relationshipType: CompanyGraphRelationshipType;
  direction: CompanyGraphEdgeDirection;
  evidenceText: string;
  section: "item1" | "item1a" | "unknown";
  confidence: number;
};

export type OpenAiCompanyGraphExtractionResult = {
  model: string;
  responseId: string | null;
  relationships: ExtractedCompanyGraphRelationship[];
  outputText: string;
  usage: Record<string, unknown> | null;
};

const RESPONSE_SCHEMA = {
  name: "company_graph_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["relationships"],
    properties: {
      relationships: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "sourceName",
            "targetName",
            "targetType",
            "relationshipType",
            "direction",
            "evidenceText",
            "section",
            "confidence",
          ],
          properties: {
            sourceName: { type: "string" },
            targetName: { type: "string" },
            targetType: {
              type: "string",
              enum: COMPANY_GRAPH_TARGET_TYPES,
            },
            relationshipType: {
              type: "string",
              enum: COMPANY_GRAPH_RELATIONSHIP_TYPES,
            },
            direction: {
              type: "string",
              enum: COMPANY_GRAPH_EDGE_DIRECTIONS,
            },
            evidenceText: { type: "string" },
            section: {
              type: "string",
              enum: ["item1", "item1a", "unknown"],
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
        },
      },
    },
  },
} as const;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function asTargetType(value: unknown): CompanyGraphTargetType | null {
  return typeof value === "string" && (COMPANY_GRAPH_TARGET_TYPES as readonly string[]).includes(value)
    ? value as CompanyGraphTargetType
    : null;
}

function asRelationshipType(value: unknown): CompanyGraphRelationshipType | null {
  return typeof value === "string" && (COMPANY_GRAPH_RELATIONSHIP_TYPES as readonly string[]).includes(value)
    ? value as CompanyGraphRelationshipType
    : null;
}

function asDirection(value: unknown): CompanyGraphEdgeDirection | null {
  return typeof value === "string" && (COMPANY_GRAPH_EDGE_DIRECTIONS as readonly string[]).includes(value)
    ? value as CompanyGraphEdgeDirection
    : null;
}

function asSection(value: unknown): "item1" | "item1a" | "unknown" {
  return value === "item1" || value === "item1a" ? value : "unknown";
}

function extractOutputText(responseBody: Record<string, unknown>): string {
  const direct = responseBody.output_text;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  const output = Array.isArray(responseBody.output) ? responseBody.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>>
      : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }

  throw new Error("OpenAI response did not include output text.");
}

function normalizeRelationships(raw: unknown): ExtractedCompanyGraphRelationship[] {
  const relationships = Array.isArray(raw) ? raw : [];

  return relationships.flatMap((item) => {
    const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const sourceName = asString(source.sourceName);
    const targetName = asString(source.targetName);
    const targetType = asTargetType(source.targetType);
    const relationshipType = asRelationshipType(source.relationshipType);
    const direction = asDirection(source.direction);
    const evidenceText = asString(source.evidenceText);

    if (!sourceName || !targetName || !targetType || !relationshipType || !direction || !evidenceText) {
      return [];
    }

    return [{
      sourceName,
      targetName,
      targetType,
      relationshipType,
      direction,
      evidenceText,
      section: asSection(source.section),
      confidence: asConfidence(source.confidence),
    }];
  });
}

export async function extractCompanyGraphRelationships(input: {
  companyName: string;
  ticker: string;
  accessionNumber: string;
  filingDate: string;
  extractionText: string;
  signal?: AbortSignal;
  responseId?: string;
  onResponseCreated?: (responseId: string) => Promise<void>;
}): Promise<OpenAiCompanyGraphExtractionResult> {
  const model = getOpenAiModel();
  const signal = input.signal ?? AbortSignal.timeout(7 * 60_000);
  if (input.responseId && !/^resp_[A-Za-z0-9_-]+$/.test(input.responseId)) throw new Error("Invalid stored OpenAI response identity");
  const headers = { "content-type": "application/json", authorization: `Bearer ${getOpenAiApiKey()}` };
  let response = await fetch(`https://api.openai.com/v1/responses${input.responseId ? `/${input.responseId}` : ""}`, {
    signal,
    method: input.responseId ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getOpenAiApiKey()}`,
    },
    body: input.responseId ? undefined : JSON.stringify({
      model,
      ...(input.onResponseCreated ? { background: true, store: true } : {}),
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "Extract only a focused supply-chain and competitor relationship graph from SEC 10-K text. " +
                "Prefer relationships where the target is a specifically named company or named organization. " +
                "Do not derive or invent specific company names from a generic category unless the filing text names them. " +
                "Use targetType=company for named companies or organizations. Use targetType=category only for specific, material supply-chain or customer groups with a meaningful modifier, such as China-based sellers, content licensors, logistics providers, or semiconductor suppliers. " +
                "Do not return broad generic category names such as vendors, suppliers, providers, companies, services, platforms, solutions, open source, or cloud services. " +
                "Do not return long enumerated phrases as category names; compress category targetName to at most four words while preserving the filing meaning. " +
                "Return no more than 50 relationships and no more than 8 category targets, ordered from most material to least material by likely business impact to the filing company. " +
                "Allowed ontology relationships are SUPPLIER_OF, CUSTOMER_OF, COMPETES_WITH, PARTNER_OF, DISTRIBUTES_FOR, and MANUFACTURES_FOR. " +
                "Use source_to_target when sourceName has the relationship to targetName, target_to_source when targetName has the relationship to sourceName, and bidirectional for reciprocal relationships like competitors or partners. " +
                "Example: if the filing company depends on TSMC as a supplier, return relationshipType=SUPPLIER_OF and direction=target_to_source. " +
                "Example: if the filing company sells to Walmart as a customer, return relationshipType=CUSTOMER_OF and direction=target_to_source. " +
                "Do not infer relationships beyond the evidence text, and keep evidenceText short but verbatim enough to audit the edge.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                companyName: input.companyName,
                ticker: input.ticker,
                accessionNumber: input.accessionNumber,
                filingDate: input.filingDate,
                text: input.extractionText,
              }),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          ...RESPONSE_SCHEMA,
        },
      },
    }),
  });

  let responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `OpenAI company graph extraction failed: ${
        typeof responseBody.error === "object" && responseBody.error && "message" in responseBody.error
          ? String((responseBody.error as Record<string, unknown>).message)
          : response.statusText
      }`,
    );
  }

  const responseId = asString(responseBody.id);
  if (input.onResponseCreated && !input.responseId) {
    if (!responseId) throw new Error("OpenAI response is missing its durable identity");
    await input.onResponseCreated(responseId);
  }
  while (responseBody.status === "queued" || responseBody.status === "in_progress") {
    if (!responseId) throw new Error("OpenAI response is missing its identity");
    await sleep(2_000, undefined, { signal });
    response = await fetch(`https://api.openai.com/v1/responses/${responseId}`, { headers, signal });
    responseBody = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`OpenAI response retrieval failed (${response.status}); retry saved response`);
  }
  if (responseBody.status && responseBody.status !== "completed") {
    throw new Error(`OpenAI response ended with ${String(responseBody.status)}; operator review required`);
  }
  const outputText = extractOutputText(responseBody);
  const parsed = JSON.parse(outputText) as Record<string, unknown>;

  return {
    model: asString(responseBody.model) ?? model,
    responseId: asString(responseBody.id),
    relationships: normalizeRelationships(parsed.relationships),
    outputText,
    usage: responseBody.usage && typeof responseBody.usage === "object"
      ? responseBody.usage as Record<string, unknown>
      : null,
  };
}
