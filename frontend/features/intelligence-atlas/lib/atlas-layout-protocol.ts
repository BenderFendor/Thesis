import type { AtlasEdge, AtlasNode } from "./atlas-schema";
import type { AtlasLayoutMode } from "./atlas-query-state";

export interface AtlasPosition {
  x: number;
  y: number;
}

export interface AtlasLayoutRequest {
  type: "layout";
  requestId: number;
  width: number;
  height: number;
  layout: AtlasLayoutMode;
  selectedId: string | null;
  nodes: Array<Pick<AtlasNode, "id" | "entity_type" | "country_code" | "connection_count">>;
  edges: Array<Pick<AtlasEdge, "source_id" | "target_id" | "relation_type" | "weight">>;
}

export interface AtlasLayoutCancelRequest {
  type: "cancel";
  requestId: number;
}

export interface AtlasLayoutResponse {
  type: "positions" | "complete";
  requestId: number;
  positions: Record<string, AtlasPosition>;
}

export type AtlasWorkerRequest = AtlasLayoutRequest | AtlasLayoutCancelRequest;
