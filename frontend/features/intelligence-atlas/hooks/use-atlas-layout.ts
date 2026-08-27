"use client";

import { useEffect, useRef, useState } from "react";

import type { AtlasEdge, AtlasNode } from "../lib/atlas-schema";
import type { AtlasLayoutMode } from "../lib/atlas-query-state";
import { AtlasForceLayoutRunner, type AtlasPosition } from "../lib/atlas-force-layout";

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

// Iterations run on the main thread in small batches per animation frame so
// the simulation stays interactive instead of blocking a single long task.
const ITERATIONS_PER_FRAME = 4;
const POST_INTERVAL_MS = 48;

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
    const runner = new AtlasForceLayoutRunner({
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

    let rafId = 0;
    let lastPosted = 0;

    function frame() {
      if (requestIdRef.current !== requestId) return;
      try {
        for (let step = 0; step < ITERATIONS_PER_FRAME && runner.hasNext(); step += 1) {
          runner.step();
        }
      } catch {
        // Never leave the graph stuck un-stable: mirror the old worker's
        // onerror fallback with a deterministic ring layout.
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
        layoutCache.set(key, fallback);
        return;
      }
      if (runner.hasNext()) {
        const now = performance.now();
        if (now - lastPosted > POST_INTERVAL_MS) {
          lastPosted = now;
          setResult({ key, positions: runner.getPositions(), stable: false });
        }
        rafId = requestAnimationFrame(frame);
        return;
      }
      const positions = runner.getPositions();
      setResult({ key, positions, stable: true });
      layoutCache.set(key, positions);
    }

    rafId = requestAnimationFrame(frame);

    return () => {
      requestIdRef.current += 1;
      cancelAnimationFrame(rafId);
    };
  }, [cached, empty, key, options]);

  if (empty) return { key, positions: {}, stable: true };
  if (cached) return { key, positions: cached, stable: true };
  if (result.key === key) return { key, positions: result.positions, stable: result.stable };
  return { key, positions: {}, stable: false };
}
