import type { AtlasEntityType, AtlasRelationType } from "./atlas-schema";

type AtlasLayoutMode = "clustered" | "ownership" | "geography" | "radial";
type AtlasPanel = "none" | "inspector" | "operations";
// "directory" is the default landing surface; "graph" is the demoted
// Force-directed canvas, reachable via the "Explore graph" tab or a
// Pre-focused link from an entity profile page.
type AtlasView = "directory" | "graph";

type AtlasNeighborDepth =
  | typeof ATLAS_DEFAULT_NEIGHBOR_DEPTH
  | typeof MAX_NEIGHBOR_DEPTH
  | typeof ONE_NEIGHBOR_DEPTH;

interface AtlasQueryState {
  "q": string;
  entities: AtlasEntityType[];
  relations: AtlasRelationType[];
  country: string[];
  funding: string[];
  bias: string[];
  minConfidence: number;
  selected: string | null;
  neighbors: AtlasNeighborDepth;
  focus: boolean;
  layout: AtlasLayoutMode;
  panel: AtlasPanel;
  tab: string;
  view: AtlasView;
}

type AtlasValueGuard<ValueType extends string> = (value: string) => value is ValueType;
type SerializationEntry = readonly [key: string, value: string, shouldSet: boolean];
interface ReadonlyAtlasQueryState {
  readonly "q": string;
  readonly bias: readonly string[];
  readonly country: readonly string[];
  readonly entities: readonly AtlasEntityType[];
  readonly funding: readonly string[];
  readonly relations: readonly AtlasRelationType[];
  readonly minConfidence: number;
  readonly selected: string | null;
  readonly neighbors: AtlasNeighborDepth;
  readonly focus: boolean;
  readonly layout: AtlasLayoutMode;
  readonly panel: AtlasPanel;
  readonly tab: string;
  readonly view: AtlasView;
}

const ATLAS_DEFAULT_NEIGHBOR_DEPTH = 0,
  EMPTY_COLLECTION_SIZE = 0,
  EMPTY_QUERY_VALUE = "",
  ENTITY_VALUES: ReadonlySet<string> = new Set<AtlasEntityType>([
    "outlet",
    "organization",
    "person",
    "reporter",
  ]),
  LAYOUT_VALUES: ReadonlySet<string> = new Set<AtlasLayoutMode>([
    "clustered",
    "ownership",
    "geography",
    "radial",
  ]),
  MAX_CONFIDENCE = 1,
  MAX_NEIGHBOR_DEPTH = 2,
  MAX_QUERY_LENGTH = 200,
  MAX_SELECTED_LENGTH = 160,
  MAX_TAB_LENGTH = 40,
  ONE_NEIGHBOR_DEPTH = 1,
  PANEL_VALUES: ReadonlySet<string> = new Set<AtlasPanel>(["none", "inspector", "operations"]),
  QUERY_STATE_DEFAULTS: AtlasQueryState = {
    bias: [],
    country: [],
    entities: ["outlet", "organization", "person", "reporter"],
    focus: false,
    funding: [],
    layout: "clustered",
    minConfidence: 0,
    neighbors: ATLAS_DEFAULT_NEIGHBOR_DEPTH,
    panel: "none",
    "q": "",
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
    // oxlint-disable-next-line unicorn/no-null -- null is the URL-state no-selection sentinel.
    selected: null,
    tab: "ingestion",
    view: "directory",
  },
  RELATION_VALUES: ReadonlySet<string> = new Set<AtlasRelationType>([
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
  ]),
  START_INDEX = 0,
  VIEW_VALUES: ReadonlySet<string> = new Set<AtlasView>(["directory", "graph"]),

// Build the profile link from the same serializer used for regular Atlas state.
  buildAtlasNeighborhoodHref = (entityId: string): string => {
    const query = serializeAtlasQueryState({
      ...QUERY_STATE_DEFAULTS,
      focus: true,
      neighbors: ONE_NEIGHBOR_DEPTH,
      selected: entityId,
      view: "graph",
    }).toString();
    return `/wiki/ownership?${query}`;
  },
  buildSerializationEntries = (state: ReadonlyAtlasQueryState): readonly SerializationEntry[] => {
    const trimmedQuery = state.q.trim();
    return [
      ["q", trimmedQuery, hasValue(trimmedQuery)],
      ["entities", state.entities.join(","), state.entities.length > EMPTY_COLLECTION_SIZE],
      ["relations", state.relations.join(","), state.relations.length > EMPTY_COLLECTION_SIZE],
      ["country", state.country.join(","), state.country.length > EMPTY_COLLECTION_SIZE],
      ["funding", state.funding.join(","), state.funding.length > EMPTY_COLLECTION_SIZE],
      ["bias", state.bias.join(","), state.bias.length > EMPTY_COLLECTION_SIZE],
      [
        "min_confidence",
        String(state.minConfidence),
        state.minConfidence > QUERY_STATE_DEFAULTS.minConfidence,
      ],
      ["selected", state.selected ?? EMPTY_QUERY_VALUE, hasValue(state.selected)],
      ["neighbors", String(state.neighbors), state.neighbors > ATLAS_DEFAULT_NEIGHBOR_DEPTH],
      ["focus", "1", state.focus],
      ["layout", state.layout, state.layout !== QUERY_STATE_DEFAULTS.layout],
      [
        "panel",
        state.panel,
        state.panel !== QUERY_STATE_DEFAULTS.panel || hasValue(state.selected),
      ],
      ["tab", state.tab, state.panel === "operations" && hasValue(state.tab)],
      ["view", state.view, state.view !== QUERY_STATE_DEFAULTS.view || hasValue(state.selected)],
    ];
  },
  clampNumber = (value: string | null, fallback: number, min: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
  },
  csvValues = (value: string | null): string[] => {
    if (value === null || value.length === EMPTY_QUERY_VALUE.length) {
      return [];
    }
    return [
      ...new Set(
        value
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > EMPTY_QUERY_VALUE.length),
      ),
    ];
  },
  hasValue = (value: string | null): boolean => {
    if (value === null) {
      return false;
    }
    return value.length > EMPTY_QUERY_VALUE.length;
  },
  isAtlasEntityType = (value: string): value is AtlasEntityType => ENTITY_VALUES.has(value),
  isAtlasLayoutMode = (value: string): value is AtlasLayoutMode => LAYOUT_VALUES.has(value),
  isAtlasPanel = (value: string): value is AtlasPanel => PANEL_VALUES.has(value),
  isAtlasRelationType = (value: string): value is AtlasRelationType => RELATION_VALUES.has(value),
  isAtlasView = (value: string): value is AtlasView => VIEW_VALUES.has(value),
  normalizeLegacyEntityValue = (value: string): string => {
    if (value === "source") {
      return "outlet";
    }
    return value;
  },
  normalizeLegacySelectedId = (value: string): string => {
    if (value.startsWith("source:")) {
      return `outlet:${value.slice("source:".length)}`;
    }
    return value;
  },
  parseAtlasQueryState = (params: Readonly<URLSearchParams>): AtlasQueryState => {
    const selected = parseOptionalSelected(params);
    return {
      bias: csvValues(params.get("bias")),
      country: csvValues(params.get("country")),
      entities: parseEntityValues(params.get("entities")),
      focus: params.get("focus") === "1",
      funding: csvValues(params.get("funding")),
      layout: parseEnumValue(
        params.get("layout"),
        isAtlasLayoutMode,
        QUERY_STATE_DEFAULTS.layout,
      ),
      minConfidence: clampNumber(
        params.get("min_confidence"),
        QUERY_STATE_DEFAULTS.minConfidence,
        QUERY_STATE_DEFAULTS.minConfidence,
        MAX_CONFIDENCE,
      ),
      neighbors: parseNeighborDepth(params.get("neighbors")),
      panel: parsePanel(params.get("panel"), selected),
      "q": parseTextParam(params.get("q"), MAX_QUERY_LENGTH, QUERY_STATE_DEFAULTS.q),
      relations: parseRelations(params.get("relations")),
      selected,
      tab: parseTextParam(params.get("tab"), MAX_TAB_LENGTH, QUERY_STATE_DEFAULTS.tab),
      view: parseView(params.get("view"), selected),
    };
  },
  parseEntityValues = (value: string | null): AtlasEntityType[] => {
    const parsed = csvValues(value)
      .map((item) => normalizeLegacyEntityValue(item))
      .filter((item): item is AtlasEntityType => isAtlasEntityType(item));
    if (parsed.length > EMPTY_COLLECTION_SIZE) {
      return parsed;
    }
    return QUERY_STATE_DEFAULTS.entities;
  },
  parseEnumValue = <ValueType extends string>(
    value: string | null,
    isAllowed: AtlasValueGuard<ValueType>,
    fallback: ValueType,
  ): ValueType => {
    if (value === null) {
      return fallback;
    }
    if (isAllowed(value)) {
      return value;
    }
    return fallback;
  },
  parseNeighborDepth = (value: string | null): AtlasNeighborDepth => {
    const rounded = Math.round(
        clampNumber(
        value,
        ATLAS_DEFAULT_NEIGHBOR_DEPTH,
        ATLAS_DEFAULT_NEIGHBOR_DEPTH,
        MAX_NEIGHBOR_DEPTH,
      ),
    );
    if (rounded === MAX_NEIGHBOR_DEPTH) {
      return MAX_NEIGHBOR_DEPTH;
    }
    if (rounded === ONE_NEIGHBOR_DEPTH) {
      return ONE_NEIGHBOR_DEPTH;
    }
    return ATLAS_DEFAULT_NEIGHBOR_DEPTH;
  },
  parseOptionalSelected = (params: Readonly<URLSearchParams>): string | null => {
    const value = params.get("selected");
    if (value === null || value.length === EMPTY_QUERY_VALUE.length) {
      return QUERY_STATE_DEFAULTS.selected;
    }
    return normalizeLegacySelectedId(value.slice(START_INDEX, MAX_SELECTED_LENGTH));
  },
  parsePanel = (value: string | null, selected: string | null): AtlasPanel => {
    if (value !== null && isAtlasPanel(value)) {
      return value;
    }
    if (selected !== QUERY_STATE_DEFAULTS.selected) {
      return "inspector";
    }
    return QUERY_STATE_DEFAULTS.panel;
  },
  parseRelations = (value: string | null): AtlasRelationType[] => {
    const parsed = csvValues(value).filter(
      (item): item is AtlasRelationType => isAtlasRelationType(item),
    );
    if (parsed.length > EMPTY_COLLECTION_SIZE) {
      return parsed;
    }
    return QUERY_STATE_DEFAULTS.relations;
  },
  parseTextParam = (value: string | null, maxLength: number, fallback: string): string => {
    if (value === null || value.length === EMPTY_QUERY_VALUE.length) {
      return fallback;
    }
    return value.slice(START_INDEX, maxLength);
  },
  parseView = (value: string | null, selected: string | null): AtlasView => {
    if (value !== null && isAtlasView(value)) {
      return value;
    }
    if (selected !== QUERY_STATE_DEFAULTS.selected) {
      return "graph";
    }
    return QUERY_STATE_DEFAULTS.view;
  },
  serializeAtlasQueryState = (state: ReadonlyAtlasQueryState): URLSearchParams => {
    const entries = buildSerializationEntries(state),
      params = new URLSearchParams();
    for (const [key, value, shouldSet] of entries) {
      setParamIf(params, key, value, shouldSet);
    }
    return params;
  },
  setParamIf = (
    params: Readonly<URLSearchParams>,
    key: string,
    value: string,
    shouldSet: boolean,
  ): void => {
    if (!shouldSet) {
      return;
    }
    params.set(key, value);
  },
  updateAtlasQueryState = (
    current: ReadonlyAtlasQueryState,
    patch: Readonly<Partial<ReadonlyAtlasQueryState>>,
  ): AtlasQueryState => ({
    ...current,
    ...patch,
    bias: [...(patch.bias ?? current.bias)],
    country: [...(patch.country ?? current.country)],
    entities: [...(patch.entities ?? current.entities)],
    funding: [...(patch.funding ?? current.funding)],
    relations: [...(patch.relations ?? current.relations)],
  });

export {
  type AtlasLayoutMode,
  type AtlasPanel,
  type AtlasQueryState,
  type ReadonlyAtlasQueryState,
  type AtlasView,
  buildAtlasNeighborhoodHref,
  QUERY_STATE_DEFAULTS as DEFAULT_ATLAS_QUERY_STATE,
  parseAtlasQueryState,
  serializeAtlasQueryState,
  updateAtlasQueryState,
};
