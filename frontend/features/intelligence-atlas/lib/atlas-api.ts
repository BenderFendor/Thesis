import type {
  AtlasEntityRecord,
  AtlasGraphResponse,
  AtlasIndexResponse,
  AtlasIngestStatusResponse,
  AtlasMeasurementsResponse,
  AtlasSearchResponse,
  AtlasStatsResponse,
  FundingBiasAnalysisResponse,
} from './atlas-schema';
import {
  AtlasEntityRecordSchema,
  AtlasGraphResponseSchema,
  AtlasIndexResponseSchema,
  AtlasIngestStatusResponseSchema,
  AtlasMeasurementsResponseSchema,
  AtlasSearchResponseSchema,
  AtlasStatsResponseSchema,
  FundingBiasAnalysisResponseSchema,
} from './atlas-schema';
import { API_BASE_URL } from "@/lib/api";
import type { ZodType } from "zod";

type AtlasIndexParams = Readonly<{
  entityTypes: readonly string[];
  // oxlint-disable-next-line id-length -- The backend's canonical query key is q.
  q?: string;
  country?: readonly string[];
  funding?: readonly string[];
  bias?: readonly string[];
  kind?: readonly string[];
  sort?: string;
  cursor?: string | null;
  limit?: number;
}>;

interface AtlasGraphFilterInput {
  readonly accepted_only?: boolean;
  readonly as_of?: string | null;
  readonly bias: readonly string[];
  readonly country: readonly string[];
  readonly entity_types: readonly string[];
  readonly funding: readonly string[];
  readonly include_evidence_preview: boolean;
  readonly known_at?: string | null;
  readonly layout: string;
  readonly limit_edges: number;
  readonly limit_nodes: number;
  readonly min_confidence: number;
  readonly neighbors: number;
  // oxlint-disable-next-line id-length -- The backend's canonical query key is q.
  readonly q?: string | null;
  readonly relation_types: readonly string[];
  readonly selected?: string | null;
}

interface ResponseBoundary {
  readonly json: Response["json"];
  readonly ok: Response["ok"];
  readonly status: Response["status"];
  readonly text: Response["text"];
}

interface RequestSignal {
  readonly aborted: AbortSignal["aborted"];
  readonly addEventListener: AbortSignal["addEventListener"];
  readonly dispatchEvent: AbortSignal["dispatchEvent"];
  readonly onabort: AbortSignal["onabort"];
  readonly reason: AbortSignal["reason"];
  readonly removeEventListener: AbortSignal["removeEventListener"];
  readonly throwIfAborted: AbortSignal["throwIfAborted"];
}

interface ResponseParser<TOutput> {
  readonly parse: ZodType<TOutput>["parse"];
}

const DEFAULT_INDEX_LIMIT = 60,
 DEFAULT_SEARCH_LIMIT = 8,
 EMPTY_VALUE_LENGTH = 0,
 MINIMUM_FILTER_VALUE = 0,
 SEARCH_QUERY_KEY = "q",
 atlasGraphQueryString = (filters: AtlasGraphFilterInput): string => {
  const listFilters = [
    ["entity_types", filters.entity_types],
    ["relation_types", filters.relation_types],
    ["country", filters.country],
    ["funding", filters.funding],
    ["bias", filters.bias],
  ] as const,
   params = new URLSearchParams({
     include_evidence_preview: String(filters.include_evidence_preview),
     layout: filters.layout,
     limit_edges: String(filters.limit_edges),
     limit_nodes: String(filters.limit_nodes),
  });
  for (const [key, value] of createListQueryEntries(listFilters)) {params.append(key, value);}
  for (const [key, value] of createGraphOptionalQueryEntries(filters)) {params.set(key, value);}
  return params.toString();
},
 buildAtlasIndexQuery = (params: AtlasIndexParams): string => {
  const listFilters = [
    ["entity_types", params.entityTypes],
    ["country", params.country ?? []],
    ["funding", params.funding ?? []],
    ["bias", params.bias ?? []],
    ["kind", params.kind ?? []],
  ] as const,
   optionalTextFilters = [
     [SEARCH_QUERY_KEY, params.q],
     ["sort", params.sort],
     ["cursor", params.cursor],
   ] as const,
   query = new URLSearchParams();
  for (const [key, value] of createListQueryEntries(listFilters)) {query.append(key, value);}
  for (const [key, value] of createOptionalQueryEntries(optionalTextFilters)) {query.set(key, value);}
 query.set("limit", String(params.limit ?? DEFAULT_INDEX_LIMIT));
  return query.toString();
},
 createGraphOptionalQueryEntries = (filters: AtlasGraphFilterInput): readonly (readonly [string, string])[] => {
  const optionalTextFilters: (readonly [string, string | null | undefined])[] = [
    [SEARCH_QUERY_KEY, filters.q],
    ["selected", filters.selected],
    ["as_of", filters.as_of],
    ["known_at", filters.known_at],
  ];
  if (filters.min_confidence > MINIMUM_FILTER_VALUE) {optionalTextFilters.push(["min_confidence", String(filters.min_confidence)]);}
  if (filters.neighbors > MINIMUM_FILTER_VALUE) {optionalTextFilters.push(["neighbors", String(filters.neighbors)]);}
  if (filters.accepted_only === true) {optionalTextFilters.push(["accepted_only", "true"]);}
  return createOptionalQueryEntries(optionalTextFilters);
},
 createListQueryEntries = (
  listFilters: readonly (readonly [string, readonly string[]])[],
): readonly (readonly [string, string])[] => listFilters.flatMap(
  ([key, values]): (readonly [string, string])[] => {
    if (values.length <= EMPTY_VALUE_LENGTH) {return [];}
    return [[key, values.join(",")]];
  },
),
 createOptionalQueryEntries = (
  optionalTextFilters: readonly (readonly [string, string | null | undefined])[],
): readonly (readonly [string, string])[] => {
  const entries: (readonly [string, string])[] = [];
  for (const [key, value] of optionalTextFilters) {
    if (value !== null && value !== undefined && value.length > EMPTY_VALUE_LENGTH) {entries.push([key, value]);}
  }
  return entries;
},
 exportAtlas = async (
  filters: AtlasGraphFilterInput,
  format: "json" | "csv_nodes" | "csv_relationships" | "csv_evidence" = "json",
): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/wiki/atlas/export`, {
    body: JSON.stringify({
      filters,
      format,
      include_evidence: true,
      selected_entity: filters.selected,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {throw new Error(`Atlas export failed with status ${response.status}`);}
  {
    const anchor = document.createElement("a"),
     blob = await response.blob(),
     disposition = response.headers.get("Content-Disposition") ?? "",
     filename = (/filename="?(?<filename>[^";]+)"?/iu.exec(disposition))?.groups?.filename ?? "atlas-investigation.json",
     url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
},
 fetchAtlasEntity = async (entityId: string, signal?: RequestSignal): Promise<AtlasEntityRecord> => {
  const response = await fetch(`${API_BASE_URL}/api/wiki/atlas/entities/${encodeURIComponent(entityId)}`, { signal });
  return parseResponse<AtlasEntityRecord>(response, AtlasEntityRecordSchema);
},
 fetchAtlasGraph = async (filters: AtlasGraphFilterInput, signal?: RequestSignal): Promise<AtlasGraphResponse> => {
  const query = atlasGraphQueryString(filters),
   response = await fetch(`${API_BASE_URL}/api/wiki/atlas/graph?${query}`, { signal });
  return parseResponse<AtlasGraphResponse>(response, AtlasGraphResponseSchema);
},
 fetchAtlasIndex = async (
  params: AtlasIndexParams,
  signal?: RequestSignal,
): Promise<AtlasIndexResponse> => {
  const query = buildAtlasIndexQuery(params),
   response = await fetch(`${API_BASE_URL}/api/wiki/atlas/index?${query}`, { signal });
  return parseResponse<AtlasIndexResponse>(response, AtlasIndexResponseSchema);
},
 fetchAtlasIngestStatus = async (signal?: RequestSignal): Promise<AtlasIngestStatusResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/wiki/atlas/ingestion-status`, { signal });
  return parseResponse<AtlasIngestStatusResponse>(response, AtlasIngestStatusResponseSchema);
},
 fetchAtlasStats = async (signal?: RequestSignal): Promise<AtlasStatsResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/wiki/atlas/stats`, { signal });
  return parseResponse<AtlasStatsResponse>(response, AtlasStatsResponseSchema);
},
 fetchFundingBiasAnalysis = async (signal?: RequestSignal): Promise<FundingBiasAnalysisResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/wiki/atlas/analysis/funding-bias`, { signal });
  return parseResponse<FundingBiasAnalysisResponse>(response, FundingBiasAnalysisResponseSchema);
},
 fetchMediaMeasurements = async (sourceName: string, signal?: RequestSignal): Promise<AtlasMeasurementsResponse> => {
  const query = new URLSearchParams({ source_name: sourceName }),
   response = await fetch(`${API_BASE_URL}/api/wiki/atlas/analysis/media-measurements?${query}`, { signal });
  return parseResponse<AtlasMeasurementsResponse>(response, AtlasMeasurementsResponseSchema);
},
 parseResponse = async <TOutput,>(
  response: ResponseBoundary,
  parser: ResponseParser<TOutput>,
): Promise<TOutput> => {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Atlas request failed with status ${response.status}`);
  }
  return parser.parse(await response.json());
},
 searchAtlas = async (query: string, signal?: RequestSignal): Promise<AtlasSearchResponse> => {
  const params = new URLSearchParams({ limit: String(DEFAULT_SEARCH_LIMIT), [SEARCH_QUERY_KEY]: query }),
   response = await fetch(`${API_BASE_URL}/api/wiki/atlas/search?${params}`, { signal });
  return parseResponse<AtlasSearchResponse>(response, AtlasSearchResponseSchema);
};

export {
  atlasGraphQueryString,
  exportAtlas,
  fetchAtlasEntity,
  fetchAtlasGraph,
  fetchAtlasIndex,
  fetchAtlasIngestStatus,
  fetchAtlasStats,
  fetchFundingBiasAnalysis,
  fetchMediaMeasurements,
  searchAtlas,
};
