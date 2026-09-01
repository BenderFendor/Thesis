"use client";

import { useEffect, useRef, useState } from "react";

import { AtlasForceLayoutRunner } from "../lib/atlas-force-layout";
import type { AtlasLayoutMode } from "../lib/atlas-query-state";

type AtlasLayoutRequest = ConstructorParameters<typeof AtlasForceLayoutRunner> extends readonly [infer Request] ? Request : never;
type AtlasPosition = ReturnType<AtlasForceLayoutRunner["getPositions"]>[string];
type UseAtlasLayoutEdge = Readonly<AtlasLayoutRequest["edges"][number] & { readonly id: string }>;
type UseAtlasLayoutNode = AtlasLayoutRequest["nodes"][number];

interface UseAtlasLayoutOptions {
  readonly nodes: readonly UseAtlasLayoutNode[];
  readonly edges: readonly UseAtlasLayoutEdge[];
  readonly width: number;
  readonly height: number;
  readonly layout: AtlasLayoutMode;
  readonly selectedId: string | null;
  readonly graphVersion: string;
}

interface LayoutState {
  key: string;
  positions: Record<string, AtlasPosition>;
  stable: boolean;
}

type LayoutStateSetter = (state: Readonly<{
  key: string;
  positions: Readonly<Record<string, AtlasPosition>>;
  stable: boolean;
}>) => void;

const CENTER_DIVISOR = 2,
  FALLBACK_RADIUS_RATIO = 0.32,
  FULL_TURN_DIVISOR = 2,
  HORIZONTAL_COORDINATE_KEY = "x",
  INDEX_STEP = 1,
  ITERATIONS_PER_FRAME = 4,
  MIN_NODE_COUNT = 1,
  POST_INTERVAL_MS = 48,
  VERTICAL_COORDINATE_KEY = "y",
  ZERO_COORDINATE = 0,

 advanceAnimation = (
  runner: Readonly<AtlasForceLayoutRunner>,
  options: UseAtlasLayoutOptions,
  key: string,
  setResult: LayoutStateSetter,
): boolean => {
  try {
    advanceRunner(runner);
    return true;
  } catch {
    publishFinalLayout(key, createFallbackPositions(options), setResult);
    return false;
  }
},

 advanceRunner = (runner: Readonly<AtlasForceLayoutRunner>): void => {
  for (let step = ZERO_COORDINATE; step < ITERATIONS_PER_FRAME && runner.hasNext(); step += INDEX_STEP) {
    runner.step();
  }
},

 createFallbackPositions = (options: UseAtlasLayoutOptions): Record<string, AtlasPosition> => {
  const nodeCount = Math.max(options.nodes.length, MIN_NODE_COUNT),
    radius = Math.min(options.width, options.height) * FALLBACK_RADIUS_RATIO;
  return Object.fromEntries(
    options.nodes.map((node, index) => {
      const angle = (index / nodeCount) * Math.PI * FULL_TURN_DIVISOR,
        horizontal = options.width / CENTER_DIVISOR + Math.cos(angle) * radius,
        vertical = options.height / CENTER_DIVISOR + Math.sin(angle) * radius;
      return [node.id, {
        [HORIZONTAL_COORDINATE_KEY]: horizontal,
        [VERTICAL_COORDINATE_KEY]: vertical,
      }];
    }),
  );
},

 layoutCache = new Map<string, Record<string, AtlasPosition>>(),

 postLayoutProgress = (
  key: string,
  lastPosted: number,
  runner: Readonly<AtlasForceLayoutRunner>,
  setResult: LayoutStateSetter,
): number => {
  const now = performance.now();
  if (now - lastPosted <= POST_INTERVAL_MS) {
    return lastPosted;
  }
  setResult({ key, positions: runner.getPositions(), stable: false });
  return now;
},

 publishFinalLayout = (
  key: string,
  positions: Readonly<Record<string, AtlasPosition>>,
  setResult: LayoutStateSetter,
): void => {
  const nextPositions = { ...positions };
  setResult({ key, positions: nextPositions, stable: true });
  layoutCache.set(key, nextPositions);
},

 startLayoutAnimation = (
  options: UseAtlasLayoutOptions,
  key: string,
  isCurrent: () => boolean,
  setResult: LayoutStateSetter,
): number => {
  let lastPosted = ZERO_COORDINATE;
  const animationFrame = (): void => {
    if (!isCurrent()) {
      return;
    }
    if (!advanceAnimation(runner, options, key, setResult)) {
      return;
    }
    if (!runner.hasNext()) {
      publishFinalLayout(key, runner.getPositions(), setResult);
      return;
    }
    lastPosted = postLayoutProgress(key, lastPosted, runner, setResult);
    requestAnimationFrame(animationFrame);
  },
   runner = new AtlasForceLayoutRunner({
    edges: options.edges.map((edge) => ({
      relation_type: edge.relation_type,
      source_id: edge.source_id,
      target_id: edge.target_id,
      weight: edge.weight,
    })),
    height: options.height,
    layout: options.layout,
    nodes: options.nodes.map((node) => ({
      connection_count: node.connection_count,
      country_code: node.country_code,
      entity_type: node.entity_type,
      id: node.id,
    })),
    selectedId: options.selectedId,
    width: options.width,
  });

  return requestAnimationFrame(animationFrame);
},

 topologyKey = (options: UseAtlasLayoutOptions): string => {
  const edgeIds = options.edges.map((edge) => edge.id).toSorted().join("|"),
    nodeIds = options.nodes.map((node) => node.id).toSorted().join("|");
  return `${options.graphVersion}:${options.layout}:${Math.round(options.width)}:${Math.round(options.height)}:${nodeIds}:${edgeIds}`;
},
useAtlasLayout = (options: UseAtlasLayoutOptions): LayoutState => {
  const cacheKey = topologyKey(options),
    cachedLayout = layoutCache.get(cacheKey),
    empty = options.nodes.length === ZERO_COORDINATE || options.width <= ZERO_COORDINATE || options.height <= ZERO_COORDINATE,
    [result, setResult] = useState<LayoutState>({ key: "", positions: {}, stable: false }),
    requestIdRef = useRef(ZERO_COORDINATE);

  useEffect(() => {
    requestIdRef.current += INDEX_STEP;
    const currentRequestId = requestIdRef.current;
    let rafId: number | false = false;
    if (!empty && cachedLayout === undefined) {
      rafId = startLayoutAnimation(options, cacheKey, () => requestIdRef.current === currentRequestId, setResult);
    }
    return () => {
      if (rafId !== false) {
        requestIdRef.current += INDEX_STEP;
        cancelAnimationFrame(rafId);
      }
    };
  }, [cacheKey, cachedLayout, empty, options]);

  if (empty) {
    return { key: cacheKey, positions: {}, stable: true };
  }
  if (cachedLayout) {
    return { key: cacheKey, positions: cachedLayout, stable: true };
  }
  if (result.key === cacheKey) {
    return { key: cacheKey, positions: result.positions, stable: result.stable };
  }
  return { key: cacheKey, positions: {}, stable: false };
};

export { useAtlasLayout };
