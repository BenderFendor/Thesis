"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { hasText } from "@/lib/utils";
import type { AtlasEdge, AtlasNode } from "./lib/atlas-schema";
import type { AtlasLayoutMode } from "./lib/atlas-query-state";
import { useAtlasLayout } from "./hooks/use-atlas-layout";
import { getZoomedAtlasTransform } from "./atlas-graph-transform";
import type {
  AtlasGraphPanState,
  AtlasGraphSelectionState,
  AtlasGraphZoomState,
  AtlasPointerEvent,
  AtlasKeyboardEvent,
  AtlasWheelEvent,
  SetAtlasTransform,
  Transform,
} from "./atlas-graph-types";

const getAtlasKeyboardDirection = (key: string): number => {
  if (key === "ArrowRight" || key === "ArrowDown") {
    return 1;
  }
  return -1;
};

const getAtlasWheelFactor = (deltaY: number): number => {
  if (deltaY < 0) {
    return 1.12;
  }
  return 1 / 1.12;
};

const handleAtlasNodeActivation = (
  event: AtlasKeyboardEvent,
  nodeId: string,
  onSelect: (nodeId: string) => void,
): null => {
  event.preventDefault();
  onSelect(nodeId);
  return null;
};

const handleAtlasNodeKeyboard = (
  event: AtlasKeyboardEvent,
  nodeId: string,
  orderedNodes: readonly AtlasNode[],
  onSelect: (nodeId: string) => void,
): string | null => {
  if (event.key === "Enter" || event.key === " ") {
    return handleAtlasNodeActivation(event, nodeId, onSelect);
  }
  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
    return null;
  }
  event.preventDefault();
  const currentIndex = orderedNodes.findIndex((node) => node.id === nodeId),
    direction = getAtlasKeyboardDirection(event.key),
    nextIndex = (currentIndex + direction + orderedNodes.length) % orderedNodes.length,
    nextNode = orderedNodes[nextIndex];
  if (!nextNode) {
    return null;
  }
  return nextNode.id;
};

interface AtlasGraphDimensions {
  readonly height: number;
  readonly width: number;
}

interface PanState {
  readonly pointerId: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly originX: number;
  readonly originY: number;
}

const getAtlasGraphDimensions = (rect: DOMRectReadOnly): AtlasGraphDimensions => ({
  height: Math.max(360, Math.round(rect.height)),
  width: Math.max(320, Math.round(rect.width)),
});

const useAtlasGraphDimensions = (
  getContainer: () => HTMLDivElement | null,
): AtlasGraphDimensions => {
  const [dimensions, setDimensions] = useState<AtlasGraphDimensions>({ height: 760, width: 1280 });

  useEffect(() => {
    const container = getContainer();
    if (!container) {
      return () => {};
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setDimensions(getAtlasGraphDimensions(entry.contentRect));
      }
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [getContainer]);

  return dimensions;
};

interface AtlasGraphLayoutInput {
  dimensions: AtlasGraphDimensions;
  edges: readonly AtlasEdge[];
  graphVersion: string;
  layout: AtlasLayoutMode;
  nodes: readonly AtlasNode[];
  selectedId: string | null;
}

const useAtlasGraphLayout = ({
  dimensions,
  edges,
  graphVersion,
  layout,
  nodes,
  selectedId,
}: Readonly<AtlasGraphLayoutInput>) => {
  const layoutOptions = useMemo(
    () => ({
      edges,
      graphVersion,
      height: dimensions.height,
      layout,
      nodes,
      selectedId,
      width: dimensions.width,
    }),
    [dimensions.height, dimensions.width, edges, graphVersion, layout, nodes, selectedId],
  );
  return useAtlasLayout(layoutOptions);
};

const getAtlasNeighbors = (edges: readonly AtlasEdge[], nodeId: string | null): Set<string> => {
  const ids = new Set<string>();
  if (!hasText(nodeId)) {
    return ids;
  }
  ids.add(nodeId);
  edges.forEach((edge) => {
    if (edge.source_id === nodeId) {
      ids.add(edge.target_id);
    }
    if (edge.target_id === nodeId) {
      ids.add(edge.source_id);
    }
  });
  return ids;
};

const getAtlasActiveNodeId = (
  selectedId: string | null,
  keyboardActiveNodeId: string | null,
  nodes: readonly AtlasNode[],
  orderedNodes: readonly AtlasNode[],
): string | null => {
  if (selectedId !== null) {
    return selectedId;
  }
  if (hasText(keyboardActiveNodeId) && nodes.some((node) => node.id === keyboardActiveNodeId)) {
    return keyboardActiveNodeId;
  }
  return orderedNodes[0]?.id ?? null;
};

type AtlasNodeIdStateSetter = (
  value: string | null | ((current: string | null) => string | null),
) => void;

interface AtlasGraphSelectionValues {
  readonly activeNodeId: string | null;
  readonly hoveredNode: AtlasNode | null;
  readonly hoveredNodeId: string | null;
  readonly interactionNeighbors: ReadonlySet<string>;
  readonly interactionNodeId: string | null;
  readonly onHover: (nodeId: string) => void;
  readonly orderedNodes: readonly AtlasNode[];
  readonly priorityLabelIds: ReadonlySet<string>;
  readonly selectedNeighbors: ReadonlySet<string>;
  readonly setHoveredNodeId: AtlasNodeIdStateSetter;
  readonly setKeyboardActiveNodeId: (nodeId: string) => void;
}

interface AtlasGraphSelectionDerivedValues {
  readonly interactionNeighbors: ReadonlySet<string>;
  readonly interactionNodeId: string | null;
  readonly orderedNodes: readonly AtlasNode[];
  readonly priorityLabelIds: ReadonlySet<string>;
  readonly selectedNeighbors: ReadonlySet<string>;
}

const useAtlasGraphSelectionDerivedValues = (
  nodes: readonly AtlasNode[],
  edges: readonly AtlasEdge[],
  selectedId: string | null,
  hoveredNodeId: string | null,
): AtlasGraphSelectionDerivedValues => {
  const selectedNeighbors = useMemo(
    () => getAtlasNeighbors(edges, selectedId),
    [edges, selectedId],
  );
  const interactionNodeId = hoveredNodeId ?? selectedId;
  const interactionNeighbors = useMemo(
    () => getAtlasNeighbors(edges, interactionNodeId),
    [edges, interactionNodeId],
  );
  const orderedNodes = useMemo(
    () =>
      nodes.toSorted(
        (left, right) =>
          right.connection_count - left.connection_count || left.label.localeCompare(right.label),
      ),
    [nodes],
  );
  const priorityLabelIds = useMemo(
    () => new Set(orderedNodes.slice(0, 28).map((node) => node.id)),
    [orderedNodes],
  );
  return { interactionNeighbors, interactionNodeId, orderedNodes, priorityLabelIds, selectedNeighbors };
};

const useAtlasGraphSelectionValues = (
  nodes: readonly AtlasNode[],
  edges: readonly AtlasEdge[],
  selectedId: string | null,
): AtlasGraphSelectionValues => {
  const [keyboardActiveNodeId, setKeyboardActiveNodeId] = useState<string | null>(selectedId);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const derived = useAtlasGraphSelectionDerivedValues(nodes, edges, selectedId, hoveredNodeId);
  return {
    activeNodeId: getAtlasActiveNodeId(selectedId, keyboardActiveNodeId, nodes, derived.orderedNodes),
    hoveredNode: nodes.find((node) => node.id === hoveredNodeId) ?? null,
    hoveredNodeId,
    ...derived,
    onHover: setHoveredNodeId,
    setHoveredNodeId,
    setKeyboardActiveNodeId,
  };
};

interface AtlasGraphSelectionHandlers {
  readonly handleHoverLeave: (nodeId: string) => void;
  readonly handleNodeKeyboard: (event: AtlasKeyboardEvent, nodeId: string) => void;
  readonly handleNodeSelect: (nodeId: string) => void;
}

const useAtlasGraphSelectionHandlers = (
  orderedNodes: readonly AtlasNode[],
  onSelect: (nodeId: string) => void,
  focusAtlasNode: (nodeId: string) => void,
  setKeyboardActiveNodeId: (nodeId: string) => void,
  setHoveredNodeId: AtlasNodeIdStateSetter,
): AtlasGraphSelectionHandlers => {
  const handleHoverLeave = useCallback(
      (nodeId: string) => {
        setHoveredNodeId((current) =>
          (() => {
            if (current === nodeId) {
              return null;
            }
            return current;
          })(),
        );
      },
      [setHoveredNodeId],
    ),
    handleNodeKeyboard = useCallback(
      (event: AtlasKeyboardEvent, nodeId: string) => {
        const nextNodeId = handleAtlasNodeKeyboard(event, nodeId, orderedNodes, onSelect);
        if (nextNodeId === null) {
          return;
        }
        setKeyboardActiveNodeId(nextNodeId);
        requestAnimationFrame(() => {
          focusAtlasNode(nextNodeId);
        });
      },
      [focusAtlasNode, onSelect, orderedNodes, setKeyboardActiveNodeId],
    ),
    handleNodeSelect = useCallback(
      (nodeId: string) => {
        setKeyboardActiveNodeId(nodeId);
        onSelect(nodeId);
      },
      [onSelect, setKeyboardActiveNodeId],
    );

  return { handleHoverLeave, handleNodeKeyboard, handleNodeSelect };
};

const useAtlasGraphSelection = (
  nodes: readonly AtlasNode[],
  edges: readonly AtlasEdge[],
  selectedId: string | null,
  onSelect: (nodeId: string) => void,
  focusAtlasNode: (nodeId: string) => void,
): AtlasGraphSelectionState => {
  const values = useAtlasGraphSelectionValues(nodes, edges, selectedId);
  const handlers = useAtlasGraphSelectionHandlers(
    values.orderedNodes,
    onSelect,
    focusAtlasNode,
    values.setKeyboardActiveNodeId,
    values.setHoveredNodeId,
  );
  return {
    activeNodeId: values.activeNodeId,
    handleHoverLeave: handlers.handleHoverLeave,
    handleNodeKeyboard: handlers.handleNodeKeyboard,
    handleNodeSelect: handlers.handleNodeSelect,
    hoveredNode: values.hoveredNode,
    hoveredNodeId: values.hoveredNodeId,
    interactionNeighbors: values.interactionNeighbors,
    interactionNodeId: values.interactionNodeId,
    onHover: values.onHover,
    priorityLabelIds: values.priorityLabelIds,
    selectedNeighbors: values.selectedNeighbors,
  };
};

interface AtlasGraphZoomModel {
  readonly fitGraph: () => void;
  readonly setTransform: SetAtlasTransform;
  readonly transform: Transform;
}

const useAtlasGraphZoomModel = (
  layoutKey: string,
  fittedTransform: Readonly<Transform>,
): AtlasGraphZoomModel => {
  const [manualTransform, setManualTransform] = useState<{ key: string; value: Transform } | null>(
    null,
  );
  const transform = (() => {
    if (manualTransform?.key === layoutKey) {
      return manualTransform.value;
    }
    return fittedTransform;
  })();
  const setTransform: SetAtlasTransform = useCallback(
    (update) => {
      const current = (() => {
          if (manualTransform?.key === layoutKey) {
            return manualTransform.value;
          }
          return fittedTransform;
        })(),
        value = update(current);
      setManualTransform({ key: layoutKey, value });
    },
    [fittedTransform, layoutKey, manualTransform, setManualTransform],
  );
  const fitGraph = useCallback(() => {
    setManualTransform({ key: layoutKey, value: fittedTransform });
  }, [fittedTransform, layoutKey, setManualTransform]);

  return { fitGraph, setTransform, transform };
};

interface AtlasGraphZoomActions {
  readonly handleWheel: (event: AtlasWheelEvent) => void;
  readonly zoomAt: (clientX: number, clientY: number, factor: number) => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
}

const useAtlasGraphZoomActions = (
  getSvgBounds: () => DOMRect | undefined,
  setTransform: SetAtlasTransform,
): AtlasGraphZoomActions => {
  const zoomAt = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const bounds = getSvgBounds();
      if (!bounds) {
        return;
      }
      setTransform((current) =>
        getZoomedAtlasTransform(current, clientX - bounds.left, clientY - bounds.top, factor),
      );
    },
    [getSvgBounds, setTransform],
  );
  const zoomAtCenter = useCallback(
    (factor: number) => {
      const bounds = getSvgBounds();
      if (bounds) {
        zoomAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, factor);
      }
    },
    [getSvgBounds, zoomAt],
  );
  const zoomIn = useCallback(() => {
    zoomAtCenter(1.18);
  }, [zoomAtCenter]);
  const zoomOut = useCallback(() => {
    zoomAtCenter(1 / 1.18);
  }, [zoomAtCenter]);
  const handleWheel = useCallback(
    (event: AtlasWheelEvent) => {
      event.preventDefault();
      zoomAt(
        event.clientX,
        event.clientY,
        getAtlasWheelFactor(event.deltaY),
      );
    },
    [zoomAt],
  );

  return { handleWheel, zoomAt, zoomIn, zoomOut };
};

const useAtlasGraphZoom = (
  getSvgBounds: () => DOMRect | undefined,
  layoutKey: string,
  fittedTransform: Readonly<Transform>,
): AtlasGraphZoomState => {
  const model = useAtlasGraphZoomModel(layoutKey, fittedTransform);
  const actions = useAtlasGraphZoomActions(getSvgBounds, model.setTransform);
  return { ...model, ...actions };
};

type SetAtlasPan = Dispatch<SetStateAction<PanState | null>>;

const useAtlasGraphPointerDown = (
  transform: Readonly<Transform>,
  setPan: SetAtlasPan,
): AtlasGraphPanState["handlePointerDown"] =>
  useCallback(
    (event: AtlasPointerEvent) => {
      const target = event.target;
      if (
        event.button !== 0 ||
        (target instanceof Element && target.closest("[data-node-id]") !== null)
      ) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setPan({
        originX: transform.offsetX,
        originY: transform.offsetY,
        pointerId: event.pointerId,
        pointerX: event.clientX,
        pointerY: event.clientY,
      });
    },
    [setPan, transform.offsetX, transform.offsetY],
  );

const useAtlasGraphPointerMove = (
  pan: PanState | null,
  setTransform: SetAtlasTransform,
): AtlasGraphPanState["handlePointerMove"] =>
  useCallback(
    (event: AtlasPointerEvent) => {
      if (!pan || pan.pointerId !== event.pointerId) {
        return;
      }
      setTransform((current) => ({
        ...current,
        offsetX: pan.originX + event.clientX - pan.pointerX,
        offsetY: pan.originY + event.clientY - pan.pointerY,
      }));
    },
    [pan, setTransform],
  );

const useAtlasGraphPointerUp = (
  pan: PanState | null,
  setPan: SetAtlasPan,
): AtlasGraphPanState["handlePointerUp"] =>
  useCallback(
    (event: AtlasPointerEvent) => {
      if (pan?.pointerId !== event.pointerId) {
        return;
      }
      setPan(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [pan, setPan],
  );

const useAtlasGraphPan = (
  transform: Readonly<Transform>,
  setTransform: SetAtlasTransform,
): AtlasGraphPanState => {
  const [pan, setPan] = useState<PanState | null>(null);
  const handlePointerDown = useAtlasGraphPointerDown(transform, setPan);
  const handlePointerMove = useAtlasGraphPointerMove(pan, setTransform);
  const handlePointerUp = useAtlasGraphPointerUp(pan, setPan);

  return { handlePointerDown, handlePointerMove, handlePointerUp, panning: pan !== null };
};

export {
  useAtlasGraphDimensions,
  useAtlasGraphLayout,
  useAtlasGraphPan,
  useAtlasGraphSelection,
  useAtlasGraphZoom,
};
