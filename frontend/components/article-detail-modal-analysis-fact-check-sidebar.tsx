"use client";

import { Badge } from "@/components/ui/badge";
import type {
  FactCheckResult,
  FactCheckStatus,
  FactCheckStatusFilter,
} from "../lib/article-detail-modal-data";
import {
  STATUS_FILTERS,
  VERIFICATION_LABEL_MAP,
  VERIFICATION_STYLE_MAP,
} from "./article-detail-modal-analysis-fact-check-data";
import { useCallback } from "react";

type DataClickEvent = Readonly<{
  currentTarget: Readonly<{
    dataset: Readonly<{ claim?: string; status?: string }>;
  }>;
}>;

type FactCheckClaimSidebarProps = Readonly<{
  factCheckResults: readonly FactCheckResult[];
  statusCounts: Record<FactCheckStatus, number>;
  activeStatusFilter: FactCheckStatusFilter;
  onFilterChange: (filter: FactCheckStatusFilter) => void;
  filteredClaims: readonly FactCheckResult[];
  selectedClaim: FactCheckResult | undefined;
  onSelectClaim: (claim: FactCheckResult) => void;
}>;

const getFactCheckStatusLabel = (status: FactCheckStatusFilter): string => {
  if (status === "all") {
    return "All";
  }
  return VERIFICATION_LABEL_MAP[status];
};

const getFactCheckStatusClass = (isActive: boolean, isDisabled: boolean): string => {
  let activeClass =
    "border-border/60 bg-background/40 text-foreground/75 hover:border-primary/40 hover:text-foreground";
  if (isActive) {
    activeClass = "border-primary/50 bg-primary/10 text-foreground";
  }
  if (isDisabled) {
    return `${activeClass} cursor-not-allowed opacity-40 hover:border-border/60 hover:text-foreground/75`;
  }
  return `${activeClass} cursor-pointer`;
};

const FactCheckStatusButton = ({
  status,
  count,
  isActive,
  isDisabled,
  onClick,
}: Readonly<{
  status: FactCheckStatusFilter;
  count: number;
  isActive: boolean;
  isDisabled: boolean;
  onClick: (event: DataClickEvent) => void;
}>) => (
  <button
    key={status}
    type="button"
    data-status={status}
    className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-all ${getFactCheckStatusClass(isActive, isDisabled)}`}
    onClick={onClick}
  >
    {getFactCheckStatusLabel(status)}
    <span className="ml-2 rounded-full bg-background/70 px-2 py-0.5 text-xs font-bold text-foreground/80">
      {count}
    </span>
  </button>
);

const FactCheckStatusFilters = ({
  factCheckResults,
  statusCounts,
  activeStatusFilter,
  onClick,
}: Readonly<{
  factCheckResults: readonly FactCheckResult[];
  statusCounts: Record<FactCheckStatus, number>;
  activeStatusFilter: FactCheckStatusFilter;
  onClick: (event: DataClickEvent) => void;
}>) => (
  <div className="flex flex-wrap gap-2">
    {STATUS_FILTERS.map((status) => {
      const isAll = status === "all";
      const count = getFactCheckStatusCount(status, factCheckResults, statusCounts);
      return (
        <FactCheckStatusButton
          key={status}
          status={status}
          count={count}
          isDisabled={!isAll && count === 0}
          isActive={activeStatusFilter === status}
          onClick={onClick}
        />
      );
    })}
  </div>
);

const getFactCheckStatusCount = (
  status: FactCheckStatusFilter,
  factCheckResults: readonly FactCheckResult[],
  statusCounts: Record<FactCheckStatus, number>,
): number => {
  if (status === "all") {
    return factCheckResults.length;
  }
  return statusCounts[status];
};

const FactCheckClaimButton = ({
  claim,
  isActive,
  onClick,
}: Readonly<{
  claim: FactCheckResult;
  isActive: boolean;
  onClick: (event: DataClickEvent) => void;
}>) => (
  <button
    key={claim.claim}
    type="button"
    data-claim={claim.claim}
    className={`w-full rounded-xl border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 ${getFactCheckClaimClass(isActive)}`}
    onClick={onClick}
  >
    <div className="mb-2 flex items-center gap-2">
      <Badge
        className={`${VERIFICATION_STYLE_MAP[claim.verification_status]} text-xs uppercase tracking-wide`}
      >
        {VERIFICATION_LABEL_MAP[claim.verification_status]}
      </Badge>
    </div>
    <span className="line-clamp-3 text-sm text-foreground/85">{claim.claim}</span>
  </button>
);

const getFactCheckClaimClass = (isActive: boolean): string => {
  if (isActive) {
    return "border-primary/50 bg-primary/10 shadow-lg shadow-black/20";
  }
  return "border-border/60 bg-background/45";
};

const FactCheckClaimList = ({
  filteredClaims,
  selectedClaim,
  onClick,
}: Readonly<{
  filteredClaims: readonly FactCheckResult[];
  selectedClaim: FactCheckResult | undefined;
  onClick: (event: DataClickEvent) => void;
}>) => (
  <div className="max-h-96 space-y-2 overflow-y-auto pr-1 md:max-h-full">
    {filteredClaims.map((claim) => (
      <FactCheckClaimButton
        key={claim.claim}
        claim={claim}
        isActive={selectedClaim?.claim === claim.claim}
        onClick={onClick}
      />
    ))}
    {filteredClaims.length === 0 && (
      <div className="rounded-xl border border-border/60 bg-background/40 p-4 text-xs text-muted-foreground">
        No claims in this category yet. Try another filter.
      </div>
    )}
  </div>
);

const FactCheckClaimSidebar = (props: FactCheckClaimSidebarProps) => {
  const { filteredClaims, onFilterChange, onSelectClaim, statusCounts } = props;
  const handleSidebarClick = useCallback(
    (event: DataClickEvent): void => {
      const status = STATUS_FILTERS.find(
        (candidate) => candidate === event.currentTarget.dataset.status,
      );
      if (status !== undefined) {
        if (status !== "all" && statusCounts[status] === 0) {
          return;
        }
        onFilterChange(status);
        return;
      }
      const claim = filteredClaims.find(
        (candidate) => candidate.claim === event.currentTarget.dataset.claim,
      );
      if (claim !== undefined) {
        onSelectClaim(claim);
      }
    },
    [filteredClaims, onFilterChange, onSelectClaim, statusCounts],
  );
  return (
    <div className="border-b border-border/60 bg-card/40 p-5 md:col-span-4 md:border-b-0 md:border-r lg:col-span-3">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Claim Filters
        </p>
      </div>
      <FactCheckStatusFilters
        factCheckResults={props.factCheckResults}
        statusCounts={props.statusCounts}
        activeStatusFilter={props.activeStatusFilter}
        onClick={handleSidebarClick}
      />
      <div className="mt-5">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Claims
        </h4>
        <FactCheckClaimList
          filteredClaims={props.filteredClaims}
          selectedClaim={props.selectedClaim}
          onClick={handleSidebarClick}
        />
      </div>
    </div>
  );
};

export { FactCheckClaimSidebar };
