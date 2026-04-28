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
        return "#5b8cff";
      case "left-center":
      case "center-left":
        return "#88b4ff";
      case "center":
        return "#c9c2af";
      case "center-right":
      case "right-center":
        return "#d98f63";
      case "right":
        return "#cf6d5c";
      default:
        return "#8d8778";
    }
  }
  return "#c9a66b";
}

export function edgeColor(type: string): string {
  return type === "ownership" ? "rgba(201,166,107,0.48)" : "rgba(136,180,255,0.24)";
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
  const organizations = nodes.filter((node) => !isSource(node));
  const sources = nodes.filter((node) => isSource(node));

  organizations
    .sort((a, b) => b.degree - a.degree)
    .forEach((node, index) => {
      const angle = index * 2.399963229728653;
      const distance = 18 + Math.sqrt(index + 1) * Math.min(width, height) * 0.03;
      node.x = centerX + Math.cos(angle) * distance;
      node.y = centerY + Math.sin(angle) * distance;
    });

  sources
    .sort((a, b) => b.degree - a.degree)
    .forEach((node, index) => {
      const progress = index / Math.max(sources.length - 1, 1);
      const angle = index * 2.399963229728653;
      const ring = Math.min(width, height) * (0.31 + progress * 0.17);
      const wobble = 20 + (index % 5) * 7;
      node.x = centerX + Math.cos(angle) * ring + Math.sin(angle * 3.2) * wobble;
      node.y = centerY + Math.sin(angle) * ring + Math.cos(angle * 2.4) * wobble * 0.65;
    });

  if (edges.length === 0) {
    return nodes.map((node) => ({
      ...node,
      x: Math.max(28, Math.min(width - 28, node.x)),
      y: Math.max(28, Math.min(height - 28, node.y)),
    }));
  }

  for (let iteration = 0; iteration < 260; iteration += 1) {
    const alpha = 1 - iteration / 260;
    const repulsion = 3400 * alpha;

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = Math.max(dx * dx + dy * dy, 1);
        const dist = Math.sqrt(distSq);
        const collisionPadding = (a.radius + b.radius + 8) ** 2;
        const force = (repulsion + collisionPadding * 14) / distSq;
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
      const baseDistance = edge.type === "ownership" ? 128 : 96;
      const targetDistance = baseDistance + source.radius + target.radius;
      const force = (dist - targetDistance) * 0.055 * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      source.x += fx;
      source.y += fy;
      target.x -= fx;
      target.y -= fy;
    }

    for (const node of nodes) {
      const gravity = isSource(node) ? 0.0035 : 0.008;
      node.x += (centerX - node.x) * gravity;
      node.y += (centerY - node.y) * gravity;
      node.x = Math.max(34, Math.min(width - 34, node.x));
      node.y = Math.max(34, Math.min(height - 34, node.y));
    }
  }

  return nodes;
}
