"use client";

import { useId } from "react";

/** Inline lettering inherits theme colors, unlike a white external SVG image. */
export function BrandLogo({ mobile = false, className, width, height }: { mobile?: boolean; className?: string; width?: number; height?: number }) {
  const id = useId();
  const green = `${id}-green`, glow = `${id}-glow`;
  return <svg width={width ?? (mobile ? 200 : 176)} height={height ?? (mobile ? 44 : 40)} viewBox={mobile ? "12 8 200 44" : "0 8 176 40"} fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="YouAnalyst" className={className}>
    {mobile && <defs>
      <linearGradient id={green} x1="118" y1="12" x2="240" y2="52" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="var(--brand-green-start,#34D399)" /><stop offset="1" stopColor="var(--brand-green-end,#10B981)" /></linearGradient>
      <filter id={glow} x="0" y="0" width="280" height="64" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="1.2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
    </defs>}
    <g filter={mobile ? `url(#${glow})` : undefined}>
      <text x={mobile ? 20 : 8} y={mobile ? 43 : 38} fontFamily={mobile ? "Inter, Arial, Helvetica, sans-serif" : "Inter, SF Pro Text, -apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif"} fontSize={mobile ? 31 : 26} fontWeight={mobile ? 800 : 600} letterSpacing={mobile ? -.9 : 0} textRendering="geometricPrecision">
        <tspan data-brand-you fill="var(--brand-you,#FFFFFF)">You</tspan><tspan fill={mobile ? `url(#${green})` : "var(--brand-analyst,#22C55E)"}>Analyst</tspan>
      </text>
    </g>
  </svg>;
}
