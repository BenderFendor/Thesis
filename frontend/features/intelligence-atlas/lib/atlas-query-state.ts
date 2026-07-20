import type { AtlasEntityType, AtlasRelationType } from "./atlas-schema";

export type AtlasLayoutMode = "clustered" | "ownership" | "geography" | "radial";
export type AtlasPanel = "none" | "inspector" | "index" | "operations";

export interface AtlasQueryState {
  q: string;
  entities: AtlasEntityType[];
  relations: AtlasRelationType[];
  country: string[];
  funding: string[];
  bias: string[];
  minConfidence: number;
  selected: string | null;
  neighbors: 0 | 1 | 2;
  focus: boolean;
  layout: AtlasLayoutMode;
  panel: AtlasPanel;
  tab: string;
}

const ENTITY_VALUES = new Set<AtlasEntityType>(["source", "organization", "reporter"]);
const RELATION_VALUES = new Set<AtlasRelationType>([
  "ownership",
  "owned_by",
  "parent_org",
  "part_of",
  "publishes",
  "employed_by",
  "current_outlet",
  "coauthor",
  "shared_outlet",
]);
const LAYOUT_VALUES = new Set<AtlasLayoutMode>(["clustered", "ownership", "geography", "radial"]);
const PANEL_VALUES = new Set<AtlasPanel>(["none", "inspector", "index", "operations"]);

export const DEFAULT_ATLAS_QUERY_STATE: AtlasQueryState = {
  q: "",
  entities: ["source", "organization"],
  relations: ["ownership", "owned_by", "parent_org", "part_of", "publishes"],
  country: [],
  funding: [],
  bias: [],
  minConfidence: 0,
  selected: null,
  neighbors: 0,
  focus: false,
  layout: "clustered",
  panel: "none",
  tab: "ingestion",
};

function csvValues(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function boundedNumber(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseAtlasQueryState(params: URLSearchParams): AtlasQueryState {
  const entities = csvValues(params.get("entities")).filter((value): value is AtlasEntityType =>
    ENTITY_VALUES.has(value as AtlasEntityType),
  );
  const relations = csvValues(params.get("relations")).filter((value): value is AtlasRelationType =>
    RELATION_VALUES.has(value as AtlasRelationType),
  );
  const layoutValue = params.get("layout") as AtlasLayoutMode | null;
  const panelValue = params.get("panel") as AtlasPanel | null;
  const neighborValue = Math.round(boundedNumber(params.get("neighbors"), 0, 0, 2)) as 0 | 1 | 2;

  return {
    q: params.get("q")?.slice(0, 200) ?? "",
    entities: entities.length > 0 ? entities : DEFAULT_ATLAS_QUERY_STATE.entities,
    relations: relations.length > 0 ? relations : DEFAULT_ATLAS_QUERY_STATE.relations,
    country: csvValues(params.get("country")),
    funding: csvValues(params.get("funding")),
    bias: csvValues(params.get("bias")),
    minConfidence: boundedNumber(params.get("min_confidence"), 0, 0, 1),
    selected: params.get("selected")?.slice(0, 160) || null,
    neighbors: neighborValue,
    focus: params.get("focus") === "1",
    layout: layoutValue && LAYOUT_VALUES.has(layoutValue) ? layoutValue : "clustered",
    panel: panelValue && PANEL_VALUES.has(panelValue) ? panelValue : params.get("selected") ? "inspector" : "none",
    tab: params.get("tab")?.slice(0, 40) || "ingestion",
  };
}

export function serializeAtlasQueryState(state: AtlasQueryState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.entities.length > 0) params.set("entities", state.entities.join(","));
  if (state.relations.length > 0) params.set("relations", state.relations.join(","));
  if (state.country.length > 0) params.set("country", state.country.join(","));
  if (state.funding.length > 0) params.set("funding", state.funding.join(","));
  if (state.bias.length > 0) params.set("bias", state.bias.join(","));
  if (state.minConfidence > 0) params.set("min_confidence", String(state.minConfidence));
  if (state.selected) params.set("selected", state.selected);
  if (state.neighbors > 0) params.set("neighbors", String(state.neighbors));
  if (state.focus) params.set("focus", "1");
  if (state.layout !== "clustered") params.set("layout", state.layout);
  if (state.panel !== "none" || state.selected) params.set("panel", state.panel);
  if (state.panel === "operations" && state.tab) params.set("tab", state.tab);
  return params;
}

export function updateAtlasQueryState(
  current: AtlasQueryState,
  patch: Partial<AtlasQueryState>,
): AtlasQueryState {
  return { ...current, ...patch };
}
