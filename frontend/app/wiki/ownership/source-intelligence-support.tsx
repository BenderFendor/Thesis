import type { ReactNode } from "react";
import { isSource, runSimulation, type LayoutEdge, type ProcessedGraph } from "./graph-utils";
import type { WikiOwnershipGraph } from "@/lib/api";

export type WorkspaceTab = "ingestion" | "storage" | "parser" | "llm" | "errors" | "performance" | "media";

export const WORKSPACE_TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "ingestion", label: "Ingestion" },
  { id: "storage", label: "Storage" },
  { id: "parser", label: "Parser" },
  { id: "llm", label: "Model Calls" },
  { id: "errors", label: "Errors" },
  { id: "performance", label: "Performance" },
  { id: "media", label: "Media Record" },
];

export function buildProcessedGraph(graphData: WikiOwnershipGraph | undefined, width: number, height: number): ProcessedGraph | null {
  if (!graphData) return null;

  const neighborMap = new Map<string, Set<string>>();
  const degreeMap = new Map<string, number>();
  const ownershipDegreeMap = new Map<string, number>();
  const publishesDegreeMap = new Map<string, number>();

  for (const edge of graphData.edges) {
    const sourceNeighbors = neighborMap.get(edge.source) ?? new Set<string>();
    const targetNeighbors = neighborMap.get(edge.target) ?? new Set<string>();
    sourceNeighbors.add(edge.target);
    targetNeighbors.add(edge.source);
    neighborMap.set(edge.source, sourceNeighbors);
    neighborMap.set(edge.target, targetNeighbors);
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
    const bucket = edge.type === "ownership" ? ownershipDegreeMap : publishesDegreeMap;
    bucket.set(edge.source, (bucket.get(edge.source) ?? 0) + 1);
    bucket.set(edge.target, (bucket.get(edge.target) ?? 0) + 1);
  }

  const nodes = graphData.nodes.map((node) => {
    const degree = degreeMap.get(node.id) ?? 0;
    return {
      id: node.id,
      label: node.label,
      type: node.type || "source",
      bias: node.bias as string | undefined,
      funding: node.funding as string | undefined,
      country: node.country as string | undefined,
      x: 0,
      y: 0,
      radius: isSource({ type: node.type || "source" }) ? 4 + Math.min(degree, 3) * 0.75 : 6.5 + Math.min(degree, 10) * 0.55,
      degree,
      ownershipDegree: ownershipDegreeMap.get(node.id) ?? 0,
      publishesDegree: publishesDegreeMap.get(node.id) ?? 0,
      neighbors: [...(neighborMap.get(node.id) ?? new Set<string>())],
    };
  });

  const edges: LayoutEdge[] = graphData.edges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    type: edge.type || "ownership",
    percentage: edge.percentage as number | undefined,
  }));

  return {
    nodes: runSimulation(nodes, edges, width, height),
    edges,
    stats: {
      sources: nodes.filter((node) => isSource(node)).length,
      organizations: nodes.filter((node) => !isSource(node)).length,
      countries: new Set(nodes.map((node) => node.country).filter(Boolean)).size,
      ownershipEdges: edges.filter((edge) => edge.type === "ownership").length,
      publishesEdges: edges.filter((edge) => edge.type === "publishes").length,
    },
  };
}

export function MetricCard({
  label,
  value,
  tone,
  compact,
}: {
  label: string;
  value: string | number;
  tone?: string;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-white/10 bg-black/[0.15] ${compact ? "p-2.5" : "p-3"}`}>
      <div className={`text-[10px] font-mono uppercase tracking-[0.18em] ${tone ?? "text-muted-foreground"}`}>{label}</div>
      <div className={`mt-1 ${compact ? "text-base" : "text-lg"} ${tone ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}

export function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-3 py-2 ${
        active ? "border-primary/45 bg-primary/10 text-foreground" : "border-white/10 text-muted-foreground hover:border-white/20"
      }`}
    >
      {children}
    </button>
  );
}

export function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-foreground/90 ${multiline ? "leading-6" : ""}`}>{value}</div>
    </div>
  );
}
