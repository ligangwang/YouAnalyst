type Edge = { id: string; source: string; target: string };

export function edgeOpacity(edge: Edge, selected: string, activeEdge: string, showAll: boolean, hovered = "") {
  if (edge.id === activeEdge) return .65;
  if (selected && (edge.source === selected || edge.target === selected)) return .28;
  if (hovered && (edge.source === hovered || edge.target === hovered)) return .28;
  return showAll ? .07 : 0;
}

// Settle in about 300ms; reversing selection continues from the rendered value.
export function fadeEdge(current: number, target: number, delta: number, reducedMotion: boolean) {
  if (reducedMotion) return target;
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, Math.min(delta, .05)) / .055));
  return Math.abs(next - target) < .002 ? target : next;
}
