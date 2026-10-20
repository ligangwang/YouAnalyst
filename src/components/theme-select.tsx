"use client";

import { useMarket } from "./providers/preferences-context";
import { useLocale } from "./providers/locale-provider";

/** Appearance changes in place; it never navigates or remounts the workspace. */
export function ThemeSelect() {
  const { themeMode, changeTheme } = useMarket();
  const { text } = useLocale();
  return <label className="theme-select" title={text("Appearance", "外观主题")}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/></svg>
    <span className="sr-only">{text("Appearance", "外观主题")}</span>
    <select value={themeMode} onChange={event => changeTheme(event.target.value === "system" ? "system" : event.target.value === "light" ? "light" : "dark")}>
      <option value="system">{text("System", "跟随系统")}</option>
      <option value="dark">{text("Dark", "深色")}</option>
      <option value="light">{text("Light", "浅色")}</option>
    </select>
  </label>;
}
