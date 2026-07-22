import type { AtlasEntityType, AtlasRelationType } from "./atlas-schema";

export type AtlasLayoutMode = "clustered" | "ownership" | "geography" | "radial";
export type AtlasPanel = "none" | "inspector" | "operations";
// "directory" (the paginated/faceted entity list) is the default landing
// surface; "graph" is the demoted force-directed canvas, reachable via the
// "Explore graph" tab or a pre-focused link from an entity profile page.
export type AtlasView = "directory" | "graph";

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
  view: AtlasView;
}

const ENTITY_VALUES = new Set<AtlasEntityType>(["outlet", "organization", "person", "reporter"]);
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
  "founded_by",
  "sibling_via_owner",
]);
const LAYOUT_VALUES = new Set<AtlasLayoutMode>(["clustered", "ownership", "geography", "radial"]);
const PANEL_VALUES = new Set<AtlasPanel>(["none", "inspector", "operations"]);
const VIEW_VALUES = new Set<AtlasView>(["directory", "graph"]);

export const DEFAULT_ATLAS_QUERY_STATE: AtlasQueryState = {
  q: "",
  entities: ["outlet", "organization", "person", "reporter"],
  relations: [
    "ownership",
    "owned_by",
    "parent_org",
    "part_of",
    "publishes",
    "employed_by",
    "current_outlet",
    "coauthor",
    "shared_outlet",
    "founded_by",
    "sibling_via_owner",
  ],
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
  view: "directory",
};

function csvValues(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

// Legacy alias: old bookmarks/shared links may still carry "source" for what
// is now the "outlet" entity type. Normalize on read; never write it back out.
function normalizeLegacyEntityValue(value: string): string {
  return value === "source" ? "outlet" : value;
}

function normalizeLegacySelectedId(value: string): string {
  return value.startsWith("source:") ? `outlet:${value.slice("source:".length)}` : value;
}

function boundedNumber(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseAtlasQueryState(params: URLSearchParams): AtlasQueryState {
  const entities = csvValues(params.get("entities"))
    .map(normalizeLegacyEntityValue)
    .filter((value): value is AtlasEntityType => ENTITY_VALUES.has(value as AtlasEntityType));
  const relations = csvValues(params.get("relations")).filter((value): value is AtlasRelationType =>
    RELATION_VALUES.has(value as AtlasRelationType),
  );
  const layoutValue = params.get("layout") as AtlasLayoutMode | null;
  const panelValue = params.get("panel") as AtlasPanel | null;
  const neighborValue = Math.round(boundedNumber(params.get("neighbors"), 0, 0, 2)) as 0 | 1 | 2;
  const viewValue = params.get("view") as AtlasView | null;
  const hasSelected = Boolean(params.get("selected"));

  return {
    q: params.get("q")?.slice(0, 200) ?? "",
    entities: entities.length > 0 ? entities : DEFAULT_ATLAS_QUERY_STATE.entities,
    relations: relations.length > 0 ? relations : DEFAULT_ATLAS_QUERY_STATE.relations,
    country: csvValues(params.get("country")),
    funding: csvValues(params.get("funding")),
    bias: csvValues(params.get("bias")),
    minConfidence: boundedNumber(params.get("min_confidence"), 0, 0, 1),
    selected: params.get("selected") ? normalizeLegacySelectedId(params.get("selected")!.slice(0, 160)) : null,
    neighbors: neighborValue,
    focus: params.get("focus") === "1",
    layout: layoutValue && LAYOUT_VALUES.has(layoutValue) ? layoutValue : "clustered",
    panel: panelValue && PANEL_VALUES.has(panelValue) ? panelValue : hasSelected ? "inspector" : "none",
    tab: params.get("tab")?.slice(0, 40) || "ingestion",
    // A legacy/omitted "view" with an explicit "selected" entity (old
    // deep-links that always meant "show this in the graph") still resolves
    // to the graph; otherwise the directory is the default landing surface.
    view: viewValue && VIEW_VALUES.has(viewValue) ? viewValue : hasSelected ? "graph" : "directory",
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
  // Written explicitly whenever a selected entity is present so a directory
  // view with a lingering selection round-trips instead of being reinferred
  // as "graph" by the legacy-deep-link fallback in parseAtlasQueryState.
  if (state.view !== "directory" || state.selected) params.set("view", state.view);
  return params;
}

export function updateAtlasQueryState(
  current: AtlasQueryState,
  patch: Partial<AtlasQueryState>,
): AtlasQueryState {
  return { ...current, ...patch };
}

/**
 * Href for the compact "Explore neighborhood" entry point on entity profile
 * pages: the Atlas graph view, pre-focused on `entityId` with its immediate
 * neighbors visible. Used by outlet/organization/person profile views to
 * link into `/wiki/ownership` without embedding the graph canvas itself.
 */
export function buildAtlasNeighborhoodHref(entityId: string): string {
  const query = serializeAtlasQueryState({
    ...DEFAULT_ATLAS_QUERY_STATE,
    view: "graph",
    selected: entityId,
    neighbors: 1,
    focus: true,
  }).toString();
  return `/wiki/ownership?${query}`;
}
