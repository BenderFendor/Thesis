import { API_BASE_URL } from "@/lib/api";

import {
  AtlasEntityRecordSchema,
  AtlasGraphResponseSchema,
  AtlasIndexResponseSchema,
  AtlasSearchResponseSchema,
  AtlasStatsResponseSchema,
  type AtlasGraphFilters,
} from "./atlas-schema";

function appendList(params: URLSearchParams, key: string, values: string[]): void {
  if (values.length > 0) params.set(key, values.join(","));
}

async function parseResponse<T>(response: Response, parser: { parse: (value: unknown) => T }): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Atlas request failed with status ${response.status}`);
  }
  return parser.parse(await response.json());
}

export function atlasGraphQueryString(filters: AtlasGraphFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  appendList(params, "entity_types", filters.entity_types);
  appendList(params, "relation_types", filters.relation_types);
  appendList(params, "country", filters.country);
  appendList(params, "funding", filters.funding);
  appendList(params, "bias", filters.bias);
  if (filters.min_confidence > 0) params.set("min_confidence", String(filters.min_confidence));
  if (filters.selected) params.set("selected", filters.selected);
  if (filters.neighbors > 0) params.set("neighbors", String(filters.neighbors));
  params.set("layout", filters.layout);
  params.set("limit_nodes", String(filters.limit_nodes));
  params.set("limit_edges", String(filters.limit_edges));
  params.set("include_evidence_preview", String(filters.include_evidence_preview));
  if (filters.as_of) params.set("as_of", filters.as_of);
  if (filters.known_at) params.set("known_at", filters.known_at);
  if (filters.accepted_only) params.set("accepted_only", "true");
  return params.toString();
}

export async function fetchAtlasGraph(filters: AtlasGraphFilters, signal?: AbortSignal) {
  const query = atlasGraphQueryString(filters);
  const response = await fetch(`${API_BASE_URL}/api/wiki/atlas/graph?${query}`, { signal });
  return parseResponse(response, AtlasGraphResponseSchema);
}

export async function fetchAtlasStats(signal?: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/api/wiki/atlas/stats`, { signal });
  return parseResponse(response, AtlasStatsResponseSchema);
}

export async function searchAtlas(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query, limit: "8" });
  const response = await fetch(`${API_BASE_URL}/api/wiki/atlas/search?${params}`, { signal });
  return parseResponse(response, AtlasSearchResponseSchema);
}

export async function fetchAtlasEntity(entityId: string, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/api/wiki/atlas/entities/${encodeURIComponent(entityId)}`, { signal });
  return parseResponse(response, AtlasEntityRecordSchema);
}

export async function fetchAtlasIndex(
  params: {
    entityTypes: string[];
    q?: string;
    country?: string[];
    funding?: string[];
    bias?: string[];
    sort?: string;
    cursor?: string | null;
    limit?: number;
  },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  appendList(query, "entity_types", params.entityTypes);
  if (params.q) query.set("q", params.q);
  appendList(query, "country", params.country ?? []);
  appendList(query, "funding", params.funding ?? []);
  appendList(query, "bias", params.bias ?? []);
  if (params.sort) query.set("sort", params.sort);
  if (params.cursor) query.set("cursor", params.cursor);
  query.set("limit", String(params.limit ?? 60));
  const response = await fetch(`${API_BASE_URL}/api/wiki/atlas/index?${query}`, { signal });
  return parseResponse(response, AtlasIndexResponseSchema);
}

export async function exportAtlas(
  filters: AtlasGraphFilters,
  format: "json" | "csv_nodes" | "csv_relationships" | "csv_evidence" = "json",
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/wiki/atlas/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters,
      selected_entity: filters.selected,
      format,
      include_evidence: true,
    }),
  });
  if (!response.ok) throw new Error(`Atlas export failed with status ${response.status}`);
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? "atlas-investigation.json";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
