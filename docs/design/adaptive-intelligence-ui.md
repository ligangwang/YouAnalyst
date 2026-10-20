# Adaptive Intelligence UI — implementation record

## Audit and baseline
- Next 16.2.1 / React 19.2.4 App Router; Tailwind 4 utilities and component CSS modules. No new UI framework.
- Existing SiteNav, BrandLogo SVG lettering, CompanySearch, comparison disclosure/color controls, calendar groups/event cards, and left/center/right intelligence workspace are reused.
- Chart: Three.js screen-space lines/bar meshes. Universe: React Three Fiber + Drei CameraControls, d3-force-3d layout. Physics and data topology remain unchanged.
- Existing theme: MarketProvider, pre-paint bootstrap, CSS data-theme selectors; only dark/light, default dark. Account API accepts dark/light. System mode is added as a device preference, retaining that API schema.
- Existing tokens duplicated across globals (--background/--color-shell), calendar/graph (--ui-*), and Explore-local palettes. Central semantic tokens provide compatibility aliases; page modules consume those instead of separate palettes.
- Typography used Sora and IBM Plex Sans with local next/font. Replaced with self-hosted Geist Sans/Mono variable fonts from geist 1.8.1 (SIL OFL), preserving logo artwork and CJK system fallbacks.
- Baseline: 36 screenshots (six pages × three viewports × two themes), captured before edits in output/design-refresh/before. Sizes: 1440×900, 1024×768, 390×844. Public read-only payloads populate the local app; no credentials, writes or generated market data.
- Functional baseline: Compare stock/date editor, line/bar, playback, sharing and auth gates; Companies search/rank links; Calendar month/week, filters, ET conversions and agenda; Explore graph/rails/selection/source links; About contacts; signed-out Watchlist auth gate.

## Review steps
1. Foundations: central tokens, locally hosted typography, pre-paint System/Dark/Light; no backend contract changes.
2. Shell and pages: navigation alignment, search-first Companies, editorial About, compact calendar.
3. Compare: chart-first presentation, compact disclosure controls and secondary community attribution.
4. Explore: theme-aware rails and explicit light/dark graph materials; preserve camera/context and geometry.
5. QA: theme persistence/state continuity, contrast, keyboard, reduced motion, mobile overflow, regression suites and build.

No production deployment is part of this preview. The earlier calendar/About fixes remain in the parent branch/PR #1028.
