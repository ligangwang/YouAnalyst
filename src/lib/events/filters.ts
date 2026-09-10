export const eventFilters = [
  { value: "all", label: "All" },
  { value: "SEC_FORM4", label: "Insider activity" },
  { value: "SEC_13F", label: "Institutional holdings" },
] as const;

export type EventFilter = typeof eventFilters[number]["value"];

export function parseEventFilter(value: unknown): EventFilter {
  if (value == null || value === "all") return "all";
  if (value === "SEC_FORM4" || value === "SEC_13F") return value;
  throw new Error("Invalid event type");
}
