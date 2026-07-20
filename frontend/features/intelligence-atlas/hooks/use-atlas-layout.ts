"use client";

import { useEffect, useRef, useState } from "react";

import type { AtlasEdge, AtlasNode } from "../lib/atlas-schema";
import type { AtlasLayoutMode } from "../lib/atlas-query-state";
import type { AtlasLayoutResponse, AtlasPosition } from "../lib/atlas-layout-protocol";

interface UseAtlasLayoutOptions {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  width: number;
  height: number;
  layout: AtlasLayoutMode;
  selectedId: string | null;
  graphVersion: string;
}

const layoutCache = new Map<string, Record<string, AtlasPosition>>();

function topologyKey(options: UseAtlasLayoutOptions): string {
  const ids = options.nodes.map((node) => node.id).sort().join("|");
  const edges = options.edges.map((edge) => edge.id).sort().join("|");
  return `${options.graphVersion}:${options.layout}:${Math.round(options.width)}:${Math.round(options.height)}:${ids}:${edges}`;
}

export function useAtlasLayout(options: UseAtlasLayoutOptions) {
  const key = topologyKey(options);
  const cached = layoutCache.get(key);
  const empty = options.nodes.length === 0 || options.width <= 0 || options.height <= 0;
  const [result, setResult] = useState<{
    key: string;
    positions: Record<string, AtlasPosition>;
    stable: boolean;
  }>({ key: "", positions: {}, stable: false });
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (empty || cached) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const worker = new Worker(new URL("../../../workers/atlas-layout.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<AtlasLayoutResponse>) => {
      if (event.data.requestId !== requestIdRef.current) return;
      const complete = event.data.type === "complete";
      setResult({ key, positions: event.data.positions, stable: complete });
      if (complete) {
        layoutCache.set(key, event.data.positions);
        worker.terminate();
      }
    };
    worker.onerror = () => {
      const fallback = Object.fromEntries(
        options.nodes.map((node, index) => {
          const angle = (index / Math.max(options.nodes.length, 1)) * Math.PI * 2;
          const radius = Math.min(options.width, options.height) * 0.32;
          return [
            node.id,
            {
              x: options.width / 2 + Math.cos(angle) * radius,
              y: options.height / 2 + Math.sin(angle) * radius,
            },
          ];
        }),
      );
      setResult({ key, positions: fallback, stable: true });
      worker.terminate();
    };
    worker.postMessage({
      type: "layout",
      requestId,
      width: options.width,
      height: options.height,
      layout: options.layout,
      selectedId: options.selectedId,
      nodes: options.nodes.map((node) => ({
        id: node.id,
        entity_type: node.entity_type,
        country_code: node.country_code,
        connection_count: node.connection_count,
      })),
      edges: options.edges.map((edge) => ({
        source_id: edge.source_id,
        target_id: edge.target_id,
        relation_type: edge.relation_type,
        weight: edge.weight,
      })),
    });

    return () => {
      worker.postMessage({ type: "cancel", requestId });
      worker.terminate();
    };
  }, [cached, empty, key, options]);

  if (empty) return { key, positions: {}, stable: true };
  if (cached) return { key, positions: cached, stable: true };
  if (result.key === key) return { key, positions: result.positions, stable: result.stable };
  return { key, positions: {}, stable: false };
}
