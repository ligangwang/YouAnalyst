import { COMPARE_COLORS, COMPARE_LIGHT_COLORS, compareSymbol, type CompareStyle } from "./compare";

export const COMPARE_TEMPLATES = ["classic", "pastel", "contrast"] as const;
export type CompareTemplate = typeof COMPARE_TEMPLATES[number];
export type CompareAppearance = { template: CompareTemplate; style: CompareStyle; companyColors: Record<string, string> };
export const DEFAULT_COMPARE_APPEARANCE: CompareAppearance = { template: "classic", style: "line", companyColors: {} };

export function parseCompanyColors(value: unknown, limit = 250): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > limit || entries.some(([symbol, color]) => !compareSymbol(symbol) || typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color))) return null;
  return Object.fromEntries(entries.map(([symbol, color]) => [symbol, (color as string).toLowerCase()]));
}

export function parseCompareAppearance(value: unknown): CompareAppearance | null {
  if (!value || typeof value !== "object") return null;
  const { template, style, companyColors } = value as CompareAppearance;
  const colors = parseCompanyColors(companyColors);
  return COMPARE_TEMPLATES.includes(template) && (style === "line" || style === "bar") && colors
    ? { template, style, companyColors: colors } : null;
}

// A ticker's color is independent of its position and the other selected stocks.
export function companyCompareColor(symbol: string, appearance = DEFAULT_COMPARE_APPEARANCE, light = false): string {
  if (appearance.companyColors[symbol]) return appearance.companyColors[symbol];
  const palette = appearance.template === "pastel"
    ? (light ? ["#92577e", "#356d89", "#537044", "#95622f", "#6c61a1", "#a34f58", "#426b91", "#866d22", "#34736d", "#795c48"] : ["#f4add0", "#9ed8f0", "#b7db9c", "#f4c799", "#c5b5f0", "#f4a6ae", "#a9c8ed", "#e8d48b", "#99d6c9", "#cdb59c"])
    : appearance.template === "contrast"
      ? (light ? ["#0051a8", "#a52c00", "#6c299b", "#006b49", "#9a0060", "#665500", "#1541b5", "#b01f39", "#426600", "#475569"] : ["#00cfff", "#ff8844", "#c4a1ff", "#45f4ae", "#ff70c4", "#ffde33", "#6999ff", "#ff667d", "#c3ed42", "#e2e8f0"])
      : light ? COMPARE_LIGHT_COLORS : COMPARE_COLORS;
  const commonIndex = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AMD", "AVGO", "INTC"].indexOf(symbol);
  if (commonIndex >= 0) return palette[commonIndex];
  // Use the full color wheel for other tickers instead of repeating ten colors.
  const hash = Array.from(symbol).reduce((value, char) => Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const hue = hash % 360;
  const saturation = appearance.template === "pastel" ? .55 : appearance.template === "contrast" ? .9 : .7;
  const luminance = light ? .35 : appearance.template === "pastel" ? .76 : .63;
  const amplitude = saturation * Math.min(luminance, 1 - luminance);
  const channel = (offset: number) => {
    const position = (offset + hue / 30) % 12;
    return Math.round(255 * (luminance - amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1)))).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
