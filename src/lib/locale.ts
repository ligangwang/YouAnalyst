export type Locale = "en" | "zh-CN";
export function parseLocale(value: unknown): Locale | null {
  return value === "en" || value === "zh-CN" ? value : null;
}
