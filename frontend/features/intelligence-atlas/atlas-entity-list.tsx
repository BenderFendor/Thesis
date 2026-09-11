"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useMemo } from "react";

import styles from "./atlas.module.css";
import { DirectoryHeader } from "./atlas-entity-list-header";
import type { AtlasEntityListVariant, FilterPatch } from "./atlas-entity-list-header";
import { useAtlasEntityListState } from "./atlas-entity-list-state";
import type { AtlasEntityListState } from "./atlas-entity-list-state";
import type { AtlasEntityType, AtlasNode } from "./lib/atlas-schema";

interface AtlasEntityListProps {
  readonly entityTypes: readonly AtlasEntityType[];
  readonly country: readonly string[];
  readonly funding: readonly string[];
  readonly bias: readonly string[];
  readonly onFiltersChange: (filters: FilterPatch) => void;
  readonly onSelect: (node: AtlasNode) => void;
  /** "page" fills its container; "modal" keeps the bounded height used inside a dialog. */
  readonly variant?: AtlasEntityListVariant;
  readonly active?: boolean;
}

const analysisSummary = (node: AtlasNode): string => {
  const count = Object.keys(node.analysis_scores).length;
  if (count > 0) {
    return ` · ${count} analysis scores`;
  }
  return "";
};

const connectionSummary = (count: number): string => {
  if (count > 0) {
    return `${count} links`;
  }
  return "—";
};

const isResearchedNode = (node: AtlasNode): boolean =>
  (node.current_parent !== null && node.current_parent !== undefined) ||
  node.connection_count > 0 ||
  node.evidence_coverage !== "not researched" ||
  Object.keys(node.analysis_scores).length > 0;

const ownershipSummary = (node: AtlasNode): string => {
  if (node.current_parent !== null && node.current_parent !== undefined) {
    return `Owned by ${node.current_parent}`;
  }
  return node.evidence_coverage;
};

const pendingSummary = (node: AtlasNode): string => {
  if (node.pending_change === null || node.pending_change === undefined || node.pending_change.length === 0) {
    return "";
  }
  return ` · ${node.pending_change}`;
};

const IndexHeaderRow = () => (
    <div className={styles.indexHeaderRow} aria-hidden="true">
      <span />
      <span>Name</span>
      <span>Country</span>
      <span>Funding</span>
      <span>Links</span>
      <span>Confidence</span>
    </div>
  );

interface EntityRowProps {
  readonly node: AtlasNode;
  readonly height: number;
  readonly start: number;
  readonly onSelect: (node: AtlasNode) => void;
}

const EntityRow = ({ node, height, start, onSelect }: EntityRowProps) => {
  const researched = isResearchedNode(node);
  const rowStyle = useMemo(
      () => ({ height, transform: `translateY(${start}px)` }),
      [height, start],
    );
  const handleClick = useCallback(() => {
      onSelect(node);
    }, [node, onSelect]);

  return (
    <button
      type="button"
      className={styles.indexCard}
      style={rowStyle}
      onClick={handleClick}
    >
      <span className={styles.entityMark} data-type={node.entity_type} aria-hidden="true">
        {node.entity_type.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-[#f0ede4]">{node.label}</span>
        <span className="mt-1 block truncate font-mono text-[9px] uppercase tracking-[0.13em] text-[#77736a]">
          {node.subtitle ?? node.entity_type}
          {analysisSummary(node)}
        </span>
        {(() => {
  if (researched) {
    return <span className={`mt-1 block truncate text-[10px] ${styles.indexParent}`}>
            {ownershipSummary(node)}
            {pendingSummary(node)}
          </span>;
  }
  return <span className={`mt-1 block truncate text-[10px] ${styles.indexUnresearched}`}>
            Not yet researched
          </span>;
})()}
      </span>
      <span className="text-xs text-[#c9c3b6]">{node.country_code ?? "—"}</span>
      <span className="text-xs text-[#c9c3b6]">{node.funding_type ?? "—"}</span>
      <span className="text-xs text-[#c9c3b6]">{connectionSummary(node.connection_count)}</span>
      <span className={styles.confidence} data-tier={node.confidence_tier ?? "unresolved"}>
        {node.confidence_tier ?? "unresolved"}
      </span>
    </button>
  );
};

interface EntityRowsProps {
  readonly items: readonly AtlasNode[];
  readonly virtualItems: readonly Readonly<{ index: number; size: number; start: number }>[];
  readonly totalSize: number;
  readonly onSelect: (node: AtlasNode) => void;
}

const EntityRows = ({ items, virtualItems, totalSize, onSelect }: EntityRowsProps) => {
  const viewportStyle = useMemo(
    () => ({ height: totalSize, position: "relative" as const }),
    [totalSize],
  );
  return (
    <>
      <IndexHeaderRow />
      <div style={viewportStyle}>
        {virtualItems.map((row) => {
          const node = items[row.index];
          if (node === undefined) {
            return null;
          }
          return (
            <EntityRow
              key={node.id}
              node={node}
              height={row.size}
              start={row.start}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </>
  );
};

interface IndexViewportContentProps {
  readonly isLoading: boolean;
  readonly error: unknown;
  readonly items: readonly AtlasNode[];
  readonly virtualItems: readonly Readonly<{ index: number; size: number; start: number }>[];
  readonly totalSize: number;
  readonly onSelect: (node: AtlasNode) => void;
}

const IndexViewportContent = ({
    isLoading,
    error,
    items,
    virtualItems,
    totalSize,
    onSelect,
  }: IndexViewportContentProps) => {
    if (isLoading) {
      return (
        <div className={styles.emptyState}>
          <Loader2
            className="h-6 w-6 animate-spin text-[#d7b35f]"
            aria-label="Loading entity index"
          />
        </div>
      );
    }

    if (error instanceof Error) {
      return (
        <div className={styles.emptyState}>
          <div>
            <div className={styles.brandTitle}>Index unavailable</div>
            <p className={styles.contextCopy}>{error.message}</p>
          </div>
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className={styles.emptyState}>No entity records match the current index filters.</div>
      );
    }

    return (
      <EntityRows
        items={items}
        virtualItems={virtualItems}
        totalSize={totalSize}
        onSelect={onSelect}
      />
    );
  },
  LoadingMore = ({ active }: Readonly<{ active: boolean }>) => {
    if (!active) {
      return null;
    }
    return (
      <div className="flex items-center justify-center gap-2 border-t border-white/10 p-3 text-xs text-[#77736a]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading more records
      </div>
    );
  };

const getAtlasRootClass = (variant: AtlasEntityListVariant): string | undefined => {
  if (variant === "page") {
    return "flex min-h-0 flex-1 flex-col";
  }
  return undefined;
};

const getAtlasViewportClass = (variant: AtlasEntityListVariant): string | undefined => {
  if (variant === "page") {
    return "relative min-h-0 flex-1 overflow-auto";
  }
  return styles.indexViewport;
};

interface AtlasEntityListViewProps {
  readonly state: AtlasEntityListState;
  readonly country: readonly string[];
  readonly funding: readonly string[];
  readonly bias: readonly string[];
  readonly onFiltersChange: (filters: FilterPatch) => void;
  readonly onSelect: (node: AtlasNode) => void;
  readonly variant: AtlasEntityListVariant;
}

type AtlasEntityListHeaderProps = Omit<AtlasEntityListViewProps, "onSelect">;

const AtlasEntityListHeader = ({
  state,
  country,
  funding,
  bias,
  onFiltersChange,
  variant,
}: AtlasEntityListHeaderProps) => {
  const {
    biasOptions,
    changeKind: handleKindChange,
    changeType: handleTypeChange,
    clearKinds: handleClearKinds,
    countryOptions,
    fundingOptions,
    kind,
    kindOptions,
    query,
    setQuery: handleQueryChange,
    setSort: handleSortChange,
    sort,
    total,
    type,
  } = state;
  return (
    <DirectoryHeader
      variant={variant}
      total={total}
      query={query}
      sort={sort}
      type={type}
      kind={kind}
      kindOptions={kindOptions}
      country={country}
      funding={funding}
      bias={bias}
      countryOptions={countryOptions}
      fundingOptions={fundingOptions}
      biasOptions={biasOptions}
      onQueryChange={handleQueryChange}
      onSortChange={handleSortChange}
      onTypeChange={handleTypeChange}
      onKindChange={handleKindChange}
      onClearKinds={handleClearKinds}
      onFiltersChange={onFiltersChange}
    />
  );
};

const AtlasEntityListView = ({
  state,
  country,
  funding,
  bias,
  onFiltersChange,
  onSelect,
  variant,
}: AtlasEntityListViewProps) => {
  const {
    error,
    isFetchingNextPage,
    isLoading,
    items,
    totalSize,
    virtualItems,
    viewportRef,
  } = state;
  const rootClass = getAtlasRootClass(variant);
  const viewportClass = getAtlasViewportClass(variant);

  return (
    <div className={rootClass}>
      <AtlasEntityListHeader
        state={state}
        country={country}
        funding={funding}
        bias={bias}
        onFiltersChange={onFiltersChange}
        variant={variant}
      />
      <div ref={viewportRef} className={viewportClass}>
        <IndexViewportContent
          isLoading={isLoading}
          error={error}
          items={items}
          virtualItems={virtualItems}
          totalSize={totalSize}
          onSelect={onSelect}
        />
      </div>
      <LoadingMore active={isFetchingNextPage} />
    </div>
  );
};

const AtlasEntityList = ({
  entityTypes,
  country,
  funding,
  bias,
  onFiltersChange,
  onSelect,
  variant = "page",
  active = true,
}: AtlasEntityListProps) => {
  const state = useAtlasEntityListState({ active, bias, country, entityTypes, funding });
  return (
    <AtlasEntityListView
      state={state}
      country={country}
      funding={funding}
      bias={bias}
      onFiltersChange={onFiltersChange}
      onSelect={onSelect}
      variant={variant}
    />
  );
};

export { AtlasEntityList };
