import { INDUSTRY_SEGMENTS } from "./catalog";
import type { IndustryNode } from "./model";

// Wrap readable company columns to the available panel width instead of
// shrinking a multi-thousand-pixel canvas into illegible text.
export function layoutIndustryGraph(nodes: IndustryNode[], availableWidth: number) {
  const width = Math.max(188, availableWidth);
  const perRow = Math.max(1, Math.min(5, Math.floor(width / 188)));
  const cellWidth = width / perRow;
  const groups = INDUSTRY_SEGMENTS.flatMap((segment) => {
    const members = nodes.filter((node) => node.segment === segment.id);
    return Array.from({ length: Math.ceil(members.length / 6) }, (_, index) => ({
      ...segment, id: `${segment.id}-${index}`, label: index ? `${segment.label} (${index + 1})` : segment.label,
      nodes: members.slice(index * 6, index * 6 + 6),
    }));
  });
  let top = 0;
  const columns = groups.map((column, index) => {
    const rowStart = Math.floor(index / perRow) * perRow;
    const height = Math.max(...groups.slice(rowStart, rowStart + perRow).map((group) => group.nodes.length)) * 86 + 85;
    const positioned = { ...column, x: (index % perRow) * cellWidth + cellWidth / 2, top, height };
    if (index % perRow === perRow - 1 || index === groups.length - 1) top += height;
    return positioned;
  });
  const positions = new Map(columns.flatMap((column) => column.nodes.map((node, row) =>
    [node.id, { x: column.x, y: column.top + 100 + row * 86, color: column.color }] as const)));
  return { columns, positions, width, height: Math.max(300, top) };
}
