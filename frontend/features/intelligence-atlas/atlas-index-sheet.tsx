"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownAZ, Loader2, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { fetchAtlasIndex } from "./lib/atlas-api";
import type { AtlasEntityType, AtlasNode } from "./lib/atlas-schema";
import styles from "./atlas.module.css";

interface AtlasIndexSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityTypes: AtlasEntityType[];
  country: string[];
  funding: string[];
  bias: string[];
  onFiltersChange: (filters: { country?: string[]; funding?: string[]; bias?: string[] }) => void;
  onSelect: (nodeId: string) => void;
}

const TYPE_TABS: Array<{ value: "all" | AtlasEntityType; label: string }> = [
  { value: "all", label: "All" },
  { value: "source", label: "Sources" },
  { value: "organization", label: "Organizations" },
  { value: "reporter", label: "Reporters" },
];

export function AtlasIndexSheet({
  open,
  onOpenChange,
  entityTypes,
  country,
  funding,
  bias,
  onFiltersChange,
  onSelect,
}: AtlasIndexSheetProps) {
  const [type, setType] = useState<"all" | AtlasEntityType>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const viewportRef = useRef<HTMLDivElement>(null);
  const effectiveTypes = type === "all" ? entityTypes : [type];

  const indexQuery = useInfiniteQuery({
    queryKey: ["atlas", "index", effectiveTypes, query, country, funding, bias, sort],
    queryFn: ({ pageParam, signal }) =>
      fetchAtlasIndex(
        {
          entityTypes: effectiveTypes,
          q: query || undefined,
          country,
          funding,
          bias,
          sort,
          cursor: pageParam,
          limit: 80,
        },
        signal,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: open,
    staleTime: 60_000,
  });

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = indexQuery;
  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const total = data?.pages[0]?.total ?? 0;
  const facets = data?.pages[0]?.facets;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 66,
    overscan: 8,
  });
  const { getTotalSize, getVirtualItems } = virtualizer;

  useEffect(() => {
    if (!open) return;
    const virtualItems = getVirtualItems();
    const last = virtualItems[virtualItems.length - 1];
    if (!last || last.index < items.length - 8 || !hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [fetchNextPage, getVirtualItems, hasNextPage, isFetchingNextPage, items.length, open]);

  function choose(node: AtlasNode) {
    onSelect(node.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-auto bottom-0 left-1/2 flex max-h-[82vh] w-[min(1120px,calc(100%-1rem))] max-w-none translate-y-0 flex-col gap-0 rounded-b-none border-white/10 bg-[#0d0f0c]/[0.98] p-0 text-[#f0ede4] shadow-2xl">
        <DialogHeader className="border-b border-white/10 p-5 pr-14">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <DialogTitle className="font-serif text-3xl font-normal">Entity index</DialogTitle>
              <DialogDescription className="mt-1 text-[#77736a]">
                {total.toLocaleString()} matching records. Results are server-filtered and rendered virtually.
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[230px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#77736a]" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search the entity index"
                  aria-label="Search the entity index"
                  className="border-white/10 bg-black/20 pl-9"
                />
              </div>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3">
                <ArrowDownAZ className="h-4 w-4 text-[#77736a]" />
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                  className="h-10 bg-transparent text-sm text-[#c9c3b6] outline-none"
                  aria-label="Sort entity index"
                >
                  <option value="name">Name</option>
                  <option value="most_connected">Most connected</option>
                  <option value="most_articles">Most articles</option>
                  <option value="recently_indexed">Recently indexed</option>
                  <option value="lowest_confidence">Lowest confidence</option>
                </select>
              </label>
              <FacetSelect
                label="Country"
                value={country[0] ?? "all"}
                values={Object.keys(facets?.country ?? {}).sort()}
                onChange={(value) => onFiltersChange({ country: value === "all" ? [] : [value] })}
              />
              <FacetSelect
                label="Funding"
                value={funding[0] ?? "all"}
                values={Object.keys(facets?.funding ?? {}).sort()}
                onChange={(value) => onFiltersChange({ funding: value === "all" ? [] : [value] })}
              />
              <FacetSelect
                label="Bias"
                value={bias[0] ?? "all"}
                values={Object.keys(facets?.bias ?? {}).sort()}
                onChange={(value) => onFiltersChange({ bias: value === "all" ? [] : [value] })}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto">
            {TYPE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                className={styles.pillButton}
                data-active={type === tab.value}
                onClick={() => setType(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div ref={viewportRef} className={styles.indexViewport}>
          {isLoading ? (
            <div className={styles.emptyState}>
              <Loader2 className="h-6 w-6 animate-spin text-[#d7b35f]" aria-label="Loading entity index" />
            </div>
          ) : error instanceof Error ? (
            <div className={styles.emptyState}>
              <div>
                <div className={styles.brandTitle}>Index unavailable</div>
                <p className={styles.contextCopy}>{error.message}</p>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className={styles.emptyState}>No entity records match the current index filters.</div>
          ) : (
            <div style={{ height: getTotalSize(), position: "relative" }}>
              {getVirtualItems().map((row) => {
                const node = items[row.index];
                if (!node) return null;
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={styles.indexCard}
                    style={{ height: row.size, transform: `translateY(${row.start}px)` }}
                    onClick={() => choose(node)}
                  >
                    <span className={styles.entityMark} data-type={node.entity_type} aria-hidden="true">
                      {node.entity_type.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-[#f0ede4]">{node.label}</span>
                      <span className="mt-1 block truncate font-mono text-[9px] uppercase tracking-[0.13em] text-[#77736a]">
                        {node.subtitle || node.entity_type}
                        {Object.keys(node.analysis_scores).length > 0
                          ? ` · ${Object.keys(node.analysis_scores).length} analysis scores`
                          : ""}
                      </span>
                    </span>
                    <span className="text-xs text-[#c9c3b6]">{node.country_code || "—"}</span>
                    <span className="text-xs text-[#c9c3b6]">{node.funding_type || "—"}</span>
                    <span className="text-xs text-[#c9c3b6]">{node.connection_count} links</span>
                    <span className={styles.confidence} data-tier={node.confidence_tier ?? "unresolved"}>
                      {node.confidence_tier || "unresolved"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {isFetchingNextPage ? (
          <div className="flex items-center justify-center gap-2 border-t border-white/10 p-3 text-xs text-[#77736a]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading more records
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FacetSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-xl border border-white/10 bg-black/20 px-3">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 max-w-36 bg-transparent text-sm text-[#c9c3b6] outline-none"
        aria-label={`Filter by ${label.toLowerCase()}`}
      >
        <option value="all">All {label.toLowerCase()}</option>
        {values.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
