"use client";

import { Network } from "lucide-react";
import { SidebarCard, SidebarFact } from "@/features/wiki/ui/wiki-primitives";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { buildAtlasNeighborhoodHref } from "@/features/intelligence-atlas/lib/atlas-query-state";
import { formatArticleDate } from "@/lib/date-formatters";
import type {
  BadgeProps,
  OrganizationContentProps,
  OrganizationSidebarProps,
  OptionalSidebarFactProps,
  RoleBreakdownCardProps,
  RoleBreakdownEntryProps,
  VerifiedDateFactProps,
} from "./organization-wiki-view-types";
import { EMPTY_COUNT, getNonEmptyText, getStringDetail } from "./organization-wiki-view-types";
import { AtlasBackLink, ExternalIdentifiersCard } from "./organization-wiki-view-parts";

const BadgeValue = ({ value }: BadgeProps) => {
    const text = getNonEmptyText(value);
    if (text === undefined) {
      return null;
    }

    return (
      <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
        {text}
      </Badge>
    );
  };
const NeighborhoodLink = ({ entityId }: { readonly entityId: string }) => (
    <Link
      href={buildAtlasNeighborhoodHref(entityId)}
      className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
    >
      <Network className="h-3 w-3" />
      Explore neighborhood
    </Link>
  );
const OptionalBadge = ({ value }: BadgeProps) => <BadgeValue value={value} />;
const OptionalSidebarFact = ({ label, value }: OptionalSidebarFactProps) => {
    const text = value ?? undefined;
    if (text === undefined) {
      return null;
    }

    return <SidebarFact label={label} value={text} />;
  };
const OrganizationIdentity = ({ data }: OrganizationContentProps) => (
    <>
      <AtlasBackLink />
      <div className="mt-5">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Organization
        </div>
        <h1 className="mt-1 font-serif text-3xl">{data.label}</h1>
        <OrganizationBadges data={data} />
        <NeighborhoodLink entityId={data.id} />
      </div>
    </>
  );
const OrganizationSidebar = ({ data, externalIds, roleBreakdown }: OrganizationSidebarProps) => (
    <aside className="rounded-2xl border bg-black/40 backdrop-blur-2xl border-white/10 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] ring-1 ring-white/5 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto custom-scrollbar">
      <OrganizationIdentity data={data} />
      <SidebarCard title="Quick Facts">
        <QuickFacts data={data} />
      </SidebarCard>
      <RoleBreakdownCard roleBreakdown={roleBreakdown} />
      <ExternalIdentifiersCard externalIds={externalIds} />
    </aside>
  );
const QuickFacts = ({ data }: OrganizationContentProps) => (
    <>
      <SidebarFact label="Evidence" value={String(data.evidence.length)} />
      <SidebarFact label="Connections" value={String(data.connections.length)} />
      <OptionalSidebarFact label="Funding" value={getStringDetail(data.details.funding_type)} />
      <VerifiedDateFact value={data.last_verified_at} />
    </>
  );
const OrganizationBadges = ({ data }: OrganizationContentProps) => (
    <div className="mt-3 flex flex-wrap gap-1.5">
      <OptionalBadge value={data.subtitle} />
      <OptionalBadge value={data.status} />
      <OptionalBadge value={data.confidence_tier} />
    </div>
  );
const RoleBreakdownEntry = ({ count, role }: RoleBreakdownEntryProps) => (
    <div className="flex items-center justify-between text-[10px] font-mono tracking-widest uppercase">
      <span className="text-muted-foreground">{role.replaceAll("_", " ")}</span>
      <span>{count}</span>
    </div>
  );
const RoleBreakdownCard = ({ roleBreakdown }: RoleBreakdownCardProps) => {
    if (Object.keys(roleBreakdown).length === EMPTY_COUNT) {
      return null;
    }

    return (
      <SidebarCard title="Role Breakdown">
        <div className="space-y-2">
          {Object.entries(roleBreakdown).map(([role, count]: readonly [string, number]) => (
            <RoleBreakdownEntry key={role} role={role} count={count} />
          ))}
        </div>
      </SidebarCard>
    );
  };
const VerifiedDateFact = ({ value }: VerifiedDateFactProps) => {
    const date = getNonEmptyText(value);
    if (date === undefined) {
      return null;
    }

    return <SidebarFact label="Last verified" value={formatArticleDate(date)} />;
  };

export {
  OrganizationSidebar,
};
