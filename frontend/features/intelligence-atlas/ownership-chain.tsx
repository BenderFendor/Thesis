"use client";

import type { AtlasOwnershipChainHop } from "./lib/atlas-schema";
import Link from "next/link";
import type { ReactElement } from "react";

interface OwnershipChainHop {
  readonly entity_id: AtlasOwnershipChainHop["entity_id"];
  readonly entity_type: AtlasOwnershipChainHop["entity_type"];
  readonly evidence_count: AtlasOwnershipChainHop["evidence_count"];
  readonly label: AtlasOwnershipChainHop["label"];
  readonly percentage?: AtlasOwnershipChainHop["percentage"];
  readonly percentage_range?: Readonly<{ lower: number; upper: number }> | null;
  readonly profile_path?: AtlasOwnershipChainHop["profile_path"];
}

const INDENT_SIZE = 14,
  MAX_INDENT_LEVEL = 6,
  MIN_CHAIN_LENGTH = 1,
  /**
   * Vertical hierarchical ownership chain: this entity at the bottom of the
   * DOM, its ultimate parent/beneficial owner at the top. Each hop shows a
   * percentage (or range) label and an evidence-count badge, and links to
   * that entity's own profile page. Renders nothing when the chain has no
   * accepted owner above the entity itself (self-only chain).
   *
   * @param {readonly OwnershipChainHop[]} chain - Ordered ownership hops from this entity toward its owner.
   * @param {string} currentEntityId - Identifier of the entity rendered at the bottom.
   * @returns {ReactElement | undefined} The ownership chain list, or undefined for a self-only chain.
   */
  OwnershipChain = ({
    chain,
    currentEntityId,
  }: Readonly<{
    readonly chain: readonly OwnershipChainHop[];
    readonly currentEntityId: string;
  }>): ReactElement | undefined => {
    if (chain.length <= MIN_CHAIN_LENGTH) {return undefined;}

    const topDown: readonly OwnershipChainHop[] = chain.toReversed();

    return (
      <ol
        aria-label="Ownership chain, from the ultimate owner down to this entity"
        className="space-y-2"
      >
        {topDown.map((hop, index) => {
          const isRoot = index === ROOT_INDEX,
            isSelf = hop.entity_id === currentEntityId,
            percentage = formatPercentage(hop);
          return (
            <OwnershipChainItem
              key={hop.entity_id}
              hop={hop}
              index={index}
              isRoot={isRoot}
              isSelf={isSelf}
              percentage={percentage}
            />
          );
        })}
      </ol>
    );
  },
  OwnershipChainBody = ({
    hop,
    isRoot,
    isSelf,
    percentage,
  }: Readonly<{
    readonly hop: OwnershipChainHop;
    readonly isRoot: boolean;
    readonly isSelf: boolean;
    readonly percentage: string | undefined;
  }>): ReactElement => {
    const body = (
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
        {renderEntityLabel(hop)}
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {getRoleDescription(hop, isRoot, isSelf)}
        </span>
        {renderPercentageBadge(percentage)}
        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground">
          {hop.evidence_count} evidence
        </span>
      </div>
    ),
      profilePath = hop.profile_path ?? "";
    if (profilePath !== "" && !isSelf) {
      return (
        <Link href={profilePath} className="block transition-colors hover:text-white">
          {body}
        </Link>
      );
    }
    return body;
  },
  OwnershipChainItem = ({
    hop,
    index,
    isRoot,
    isSelf,
    percentage,
  }: Readonly<{
    readonly hop: OwnershipChainHop;
    readonly index: number;
    readonly isRoot: boolean;
    readonly isSelf: boolean;
    readonly percentage: string | undefined;
  }>): ReactElement => (
    <li
      className="rounded-xl border border-white/5 bg-black/20 px-3 py-2 transition-all hover:bg-white/[0.03]"
      style={getChainItemStyle(index)}
    >
      <OwnershipChainBody
        hop={hop}
        isRoot={isRoot}
        isSelf={isSelf}
        percentage={percentage}
      />
    </li>
  ),
  PERCENTAGE_DECIMAL_PLACES = 1,
  PERCENTAGE_EPSILON = 0.05,
  ROOT_INDEX = 0,
  formatPercentage = (hop: Readonly<Pick<OwnershipChainHop, "percentage" | "percentage_range">>): string | undefined => {
    if (hop.percentage_range) {
      const { lower, upper } = hop.percentage_range;
      if (Math.abs(upper - lower) < PERCENTAGE_EPSILON) {
        return `${lower.toFixed(PERCENTAGE_DECIMAL_PLACES)}%`;
      }
      return `${lower.toFixed(PERCENTAGE_DECIMAL_PLACES)}–${upper.toFixed(PERCENTAGE_DECIMAL_PLACES)}%`;
    }
    const percentage = hop.percentage ?? undefined;
    if (percentage === undefined) {return undefined;}
    return `${percentage.toFixed(PERCENTAGE_DECIMAL_PLACES)}%`;
  },
  getChainItemStyle = (index: number) => ({
    marginLeft: `${Math.min(index, MAX_INDENT_LEVEL) * INDENT_SIZE}px`,
  }),
  getRoleDescription = (
    hop: Readonly<Pick<OwnershipChainHop, "entity_type">>,
    isRoot: boolean,
    isSelf: boolean,
  ): string => {
    const labels: string[] = [hop.entity_type];
    if (isRoot) {labels.push("ultimate owner");}
    if (isSelf) {labels.push("this entity");}
    return labels.join(" · ");
  },
  renderEntityLabel = (
    hop: Readonly<Pick<OwnershipChainHop, "label">>,
  ): ReactElement => <span className="truncate font-serif text-sm">{hop.label}</span>,
  renderPercentageBadge = (percentage: string | undefined): ReactElement | undefined => {
    if (percentage === undefined) {return undefined;}
    return (
      <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[10px] tracking-widest">
        {percentage}
      </span>
    );
  };

export { OwnershipChain };
