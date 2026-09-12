declare module "d3-force-3d" {
  type Node = { id?: string; x?: number; y?: number; z?: number; ax?: number; ay?: number; az?: number };
  interface Force { strength(value: number): Force; }
  interface LinkForce extends Force { id(accessor: (node: Node) => string): LinkForce; distance(value: number): LinkForce; }
  export function forceSimulation<T extends Node>(nodes: T[], dimensions: number): { stop(): ReturnType<typeof forceSimulation<T>>; force(name: string, force: Force): ReturnType<typeof forceSimulation<T>>; tick(iterations: number): void };
  export function forceManyBody(): Force;
  export function forceLink(links: { source: string; target: string }[]): LinkForce;
  export function forceX(accessor: (node: Node) => number): Force;
  export function forceY(accessor: (node: Node) => number): Force;
  export function forceZ(accessor: (node: Node) => number): Force;
}
