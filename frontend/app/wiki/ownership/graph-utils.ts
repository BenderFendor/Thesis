export type NodeFilter = "all" | "organizations" | "sources";
export type EdgeFilter = "all" | "ownership" | "publishes";

export interface LayoutNode {
  id: string;
  label: string;
  type: string;
  bias?: string;
  funding?: string;
  country?: string;
  x: number;
  y: number;
  radius: number;
  degree: number;
  ownershipDegree: number;
  publishesDegree: number;
  neighbors: string[];
}

export interface LayoutEdge {
  source: string;
  target: string;
  type: string;
  percentage?: number;
}

export interface GraphStats {
  sources: number;
  organizations: number;
  countries: number;
  ownershipEdges: number;
  publishesEdges: number;
}

export interface ProcessedGraph {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  stats: GraphStats;
}

export function isSource(node: { type: string }): boolean {
  return node.type === "source";
}

export function normalizeType(node: { type: string }): "source" | "organization" {
  return isSource(node) ? "source" : "organization";
}

export function nodeColor(node: LayoutNode): string {
  if (isSource(node)) {
    switch (node.bias?.toLowerCase()) {
      case "left":
        return "#4f8cff";
      case "left-center":
      case "center-left":
        return "#78b7ff";
      case "center":
        return "#b5bbc9";
      case "center-right":
      case "right-center":
        return "#ff9f7f";
      case "right":
        return "#ff6b6b";
      default:
        return "#8b95a7";
    }
  }
  return "#d6a7ff";
}

export function edgeColor(type: string): string {
  return type === "ownership" ? "rgba(214,167,255,0.52)" : "rgba(133,148,176,0.24)";
}

export function edgeDash(type: string): string | undefined {
  return type === "publishes" ? "5 5" : undefined;
}

export function matchesSearch(node: LayoutNode, query: string): boolean {
  if (!query) return true;
  const normalizedQuery = query.toLowerCase();
  return (
    node.label.toLowerCase().includes(normalizedQuery) ||
    node.country?.toLowerCase().includes(normalizedQuery) ||
    node.funding?.toLowerCase().includes(normalizedQuery) ||
    node.bias?.toLowerCase().includes(normalizedQuery) ||
    false
  );
}

export function runSimulation(
  rawNodes: LayoutNode[],
  edges: LayoutEdge[],
  width: number,
  height: number
): LayoutNode[] {
  const nodes = rawNodes.map((node) => ({ ...node }));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const centerX = width / 2;
  const centerY = height / 2;
  const orgCount = nodes.filter((node) => !isSource(node)).length || 1;
  let orgIndex = 0;
  let sourceIndex = 0;

  for (const node of nodes) {
    if (isSource(node)) {
      const angle = (2 * Math.PI * sourceIndex) / Math.max(nodes.length - orgCount, 1);
      const ring = Math.min(width, height) * 0.38;
      node.x = centerX + Math.cos(angle) * ring;
      node.y = centerY + Math.sin(angle) * ring;
      sourceIndex += 1;
      continue;
    }

    const angle = (2 * Math.PI * orgIndex) / orgCount;
    const ring = Math.min(width, height) * 0.18;
    node.x = centerX + Math.cos(angle) * ring;
    node.y = centerY + Math.sin(angle) * ring;
    orgIndex += 1;
  }

  for (let iteration = 0; iteration < 220; iteration += 1) {
    const alpha = 1 - iteration / 220;
    const repulsion = 2100 * alpha;

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const dist = Math.sqrt(distSq);
        const force = repulsion / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.x -= fx;
        a.y -= fy;
        b.x += fx;
        b.y += fy;
      }
    }

    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const targetDistance = edge.type === "ownership" ? 110 : 82;
      const force = (dist - targetDistance) * 0.04 * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.x += fx;
      source.y += fy;
      target.x -= fx;
      target.y -= fy;
    }

    for (const node of nodes) {
      const gravity = isSource(node) ? 0.004 : 0.0075;
      node.x += (centerX - node.x) * gravity;
      node.y += (centerY - node.y) * gravity;
      node.x = Math.max(28, Math.min(width - 28, node.x));
      node.y = Math.max(28, Math.min(height - 28, node.y));
    }
  }

  return nodes;
}
