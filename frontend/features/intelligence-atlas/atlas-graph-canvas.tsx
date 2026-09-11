"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import type { AtlasGraphProps } from "./atlas-graph-types";
import { getFittedAtlasTransform } from "./atlas-graph-transform";
import { useAtlasGraphCanvasRefs } from "./atlas-graph-canvas-refs";
import {
  useAtlasGraphDimensions,
  useAtlasGraphLayout,
  useAtlasGraphPan,
  useAtlasGraphSelection,
  useAtlasGraphZoom,
} from "./atlas-graph-interaction";
import { AtlasGraphFrame } from "./atlas-graph-frame";

type AtlasGraphCanvasProps = Omit<AtlasGraphProps, "loading">;
type AtlasGraphCanvasRefs = ReturnType<typeof useAtlasGraphCanvasRefs>;

interface AtlasGraphCanvasModel {
  readonly layoutKey: string;
  readonly pan: ReturnType<typeof useAtlasGraphPan>;
  readonly positions: ReturnType<typeof useAtlasGraphLayout>["positions"];
  readonly selection: ReturnType<typeof useAtlasGraphSelection>;
  readonly stable: boolean;
  readonly zoom: ReturnType<typeof useAtlasGraphZoom>;
}

const useAtlasGraphCanvasModel = (
  props: Readonly<AtlasGraphCanvasProps>,
  refs: AtlasGraphCanvasRefs,
): AtlasGraphCanvasModel => {
  const { height, width } = useAtlasGraphDimensions(refs.getContainer);
  const { key: layoutKey, positions, stable } = useAtlasGraphLayout({
    dimensions: { height, width },
    edges: props.edges,
    graphVersion: props.graphVersion,
    layout: props.layout,
    nodes: props.nodes,
    selectedId: props.selectedId,
  });
  const selection = useAtlasGraphSelection(
    props.nodes,
    props.edges,
    props.selectedId,
    props.onSelect,
    refs.focusAtlasNode,
  );
  const fittedTransform = useMemo(
    () => getFittedAtlasTransform(positions, { height, width }),
    [height, positions, width],
  );
  const zoom = useAtlasGraphZoom(refs.getSvgBounds, layoutKey, fittedTransform);
  const pan = useAtlasGraphPan(zoom.transform, zoom.setTransform);
  return { layoutKey, pan, positions, selection, stable, zoom };
};

const AtlasGraphCanvas = (props: Readonly<AtlasGraphCanvasProps>): ReactNode => {
  const refs = useAtlasGraphCanvasRefs();
  const model = useAtlasGraphCanvasModel(props, refs);

  return (
    <AtlasGraphFrame
      containerRef={refs.containerRef}
      edges={props.edges}
      focus={props.focus}
      nodes={props.nodes}
      onSelect={props.onSelect}
      pan={model.pan}
      positions={model.positions}
      selectedId={props.selectedId}
      selection={model.selection}
      stable={model.stable}
      svgRef={refs.svgRef}
      zoom={model.zoom}
    />
  );
};

export { AtlasGraphCanvas };
