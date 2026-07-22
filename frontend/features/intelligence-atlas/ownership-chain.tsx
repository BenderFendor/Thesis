"use client";

import Link from "next/link";

import type { AtlasOwnershipChainHop } from "./lib/atlas-schema";

function formatPercentage(hop: AtlasOwnershipChainHop): string | null {
  if (hop.percentage_range) {
    const { lower, upper } = hop.percentage_range;
    if (Math.abs(upper - lower) < 0.05) return `${lower.toFixed(1)}%`;
    return `${lower.toFixed(1)}–${upper.toFixed(1)}%`;
  }
  if (hop.percentage != null) return `${hop.percentage.toFixed(1)}%`;
  return null;
}

/**
 * Vertical hierarchical ownership chain: this entity at the bottom of the
 * DOM, its ultimate parent/beneficial owner at the top. Each hop shows a
 * percentage (or range) label and an evidence-count badge, and links to
 * that entity's own profile page. Renders nothing when the chain has no
 * accepted owner above the entity itself (self-only chain).
 */
export function OwnershipChain({
  chain,
  currentEntityId,
}: {
  chain: AtlasOwnershipChainHop[];
  currentEntityId: string;
}) {
  if (chain.length <= 1) return null;

  const topDown = [...chain].reverse();

  return (
    <ol
      aria-label="Ownership chain, from the ultimate owner down to this entity"
      className="space-y-2"
    >
      {topDown.map((hop, index) => {
        const isSelf = hop.entity_id === currentEntityId;
        const isRoot = index === 0;
        const pct = formatPercentage(hop);
        const body = (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-serif text-sm">{hop.label}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {hop.entity_type}
                {isRoot ? " · ultimate owner" : ""}
                {isSelf ? " · this entity" : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {pct ? (
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[10px] tracking-widest">
                  {pct}
                </span>
              ) : null}
              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground">
                {hop.evidence_count} evidence
              </span>
            </div>
          </div>
        );
        return (
          <li
            key={hop.entity_id}
            className="rounded-xl border border-white/5 bg-black/20 px-3 py-2 transition-all hover:bg-white/[0.03]"
            style={{ marginLeft: `${Math.min(index, 6) * 14}px` }}
          >
            {hop.profile_path && !isSelf ? (
              <Link href={hop.profile_path} className="block transition-colors hover:text-white">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}
