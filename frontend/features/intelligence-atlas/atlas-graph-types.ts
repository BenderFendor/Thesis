import type { AtlasEdge, AtlasNode } from "./lib/atlas-schema";
import type { AtlasLayoutMode } from "./lib/atlas-query-state";

interface AtlasKeyboardEvent {
  readonly key: string;
  readonly preventDefault: () => void;
}

interface AtlasPointerEvent {
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly currentTarget: Readonly<
    Pick<SVGSVGElement, "releasePointerCapture" | "setPointerCapture">
  >;
  readonly pointerId: number;
  readonly target: Readonly<EventTarget> | null;
}

interface AtlasWheelEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaY: number;
  readonly preventDefault: () => void;
}

interface AtlasClickEvent {
  readonly stopPropagation: () => void;
}

interface AtlasGraphProps {
  readonly nodes: readonly AtlasNode[];
  readonly edges: readonly AtlasEdge[];
  readonly graphVersion: string;
  readonly layout: AtlasLayoutMode;
  readonly selectedId: string | null;
  readonly focus: boolean;
  readonly loading: boolean;
  readonly onSelect: (nodeId: string) => void;
}

interface Transform {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
}

interface AtlasGraphSelectionState {
  readonly activeNodeId: string | null;
  readonly handleHoverLeave: (nodeId: string) => void;
  readonly handleNodeKeyboard: (event: AtlasKeyboardEvent, nodeId: string) => void;
  readonly handleNodeSelect: (nodeId: string) => void;
  readonly hoveredNode: AtlasNode | null;
  readonly hoveredNodeId: string | null;
  readonly interactionNeighbors: ReadonlySet<string>;
  readonly interactionNodeId: string | null;
  readonly onHover: (nodeId: string) => void;
  readonly priorityLabelIds: ReadonlySet<string>;
  readonly selectedNeighbors: ReadonlySet<string>;
}

type SetAtlasTransform = (update: (current: Readonly<Transform>) => Transform) => void;

interface AtlasGraphZoomState {
  readonly fitGraph: () => void;
  readonly handleWheel: (event: AtlasWheelEvent) => void;
  readonly setTransform: SetAtlasTransform;
  readonly transform: Transform;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly zoomAt: (clientX: number, clientY: number, factor: number) => void;
}

interface AtlasGraphPanState {
  readonly handlePointerDown: (event: AtlasPointerEvent) => void;
  readonly handlePointerMove: (event: AtlasPointerEvent) => void;
  readonly handlePointerUp: (event: AtlasPointerEvent) => void;
  readonly panning: boolean;
}

export type {
  AtlasClickEvent,
  AtlasGraphPanState,
  AtlasGraphProps,
  AtlasGraphSelectionState,
  AtlasGraphZoomState,
  AtlasKeyboardEvent,
  AtlasPointerEvent,
  AtlasWheelEvent,
  SetAtlasTransform,
  Transform,
};
