"use client";

import { useMarket } from "./providers/preferences-context";
import { useLocale } from "./providers/locale-provider";

/** One button flips appearance in place; it shows the theme it switches to and never navigates or remounts the workspace. */
export function ThemeToggle() {
  const { theme, changeTheme } = useMarket();
  const { text } = useLocale();
  const next = theme === "light" ? "dark" : "light";
  const label = next === "light" ? text("Switch to light theme", "切换到浅色主题") : text("Switch to dark theme", "切换到深色主题");
  return <button type="button" className="theme-select" aria-label={label} title={label} data-theme-target={next} onClick={() => changeTheme(next)}>
    {next === "light"
      ? <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>
      : <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>}
  </button>;
}
