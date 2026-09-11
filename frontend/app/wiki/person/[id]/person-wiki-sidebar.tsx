import type { ReactElement } from "react";
import { ChevronLeft, ExternalLink, Network } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buildAtlasNeighborhoodHref } from "@/features/intelligence-atlas/lib/atlas-query-state";
import { SidebarCard, SidebarFact } from "@/features/wiki/ui/wiki-primitives";
import { formatArticleDate } from "@/lib/date-formatters";
import { hasText } from "@/lib/utils";
import type {
  DeepReadonly,
  PersonWikiSidebarProps,
  ReadonlyExternalIds,
  ReadonlyPersonEntity,
  ReadonlyRoleBreakdown,
} from "./person-wiki-types";

const PersonWikiSidebar = (props: DeepReadonly<PersonWikiSidebarProps>): ReactElement => (
  <aside className="rounded-2xl border bg-black/40 backdrop-blur-2xl border-white/10 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] ring-1 ring-white/5 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto custom-scrollbar">
    <PersonSidebarHeading />
    <PersonIdentity data={props.data} />
    <PersonQuickFacts data={props.data} />
    <RoleBreakdownCard roleBreakdown={props.roleBreakdown} />
    <ExternalIdentifiersCard externalIds={props.externalIds} />
  </aside>
);

const PersonSidebarHeading = (): ReactElement => (
  <Link
    href="/wiki/ownership"
    className="inline-flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
  >
    <ChevronLeft className="h-3 w-3" />
    Intelligence Atlas
  </Link>
);

const PersonStatusBadges = (props: DeepReadonly<{ data: ReadonlyPersonEntity }>): ReactElement => (
  <div className="mt-3 flex flex-wrap gap-1.5">
    {hasText(props.data.status) && (
      <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
        {props.data.status}
      </Badge>
    )}
    {hasText(props.data.confidence_tier) && (
      <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
        {props.data.confidence_tier}
      </Badge>
    )}
  </div>
);

const PersonIdentity = (props: DeepReadonly<{ data: ReadonlyPersonEntity }>): ReactElement => (
  <div className="mt-5">
    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      Person
    </div>
    <h1 className="mt-1 font-serif text-3xl">{props.data.label}</h1>
    <PersonStatusBadges data={props.data} />
    <Link
      href={buildAtlasNeighborhoodHref(props.data.id)}
      className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
    >
      <Network className="h-3 w-3" />
      Explore neighborhood
    </Link>
  </div>
);

const PersonQuickFacts = (props: DeepReadonly<{ data: ReadonlyPersonEntity }>): ReactElement => (
  <SidebarCard title="Quick Facts">
    <SidebarFact label="Evidence" value={String(props.data.evidence.length)} />
    <SidebarFact label="Connections" value={String(props.data.connections.length)} />
    {hasText(props.data.last_verified_at) && (
      <SidebarFact label="Last verified" value={formatArticleDate(props.data.last_verified_at)} />
    )}
  </SidebarCard>
);

const RoleBreakdownRow = (props: DeepReadonly<{ role: string; count: number }>): ReactElement => (
  <div className="flex items-center justify-between text-[10px] font-mono tracking-widest uppercase">
    <span className="text-muted-foreground">{props.role.replaceAll("_", " ")}</span>
    <span>{props.count}</span>
  </div>
);

const RoleBreakdownList = (
  props: DeepReadonly<{ roleBreakdown: ReadonlyRoleBreakdown }>,
): ReactElement => (
  <div className="space-y-2">
    {Object.entries(props.roleBreakdown).map(([role, count]) => (
      <RoleBreakdownRow key={role} role={role} count={count} />
    ))}
  </div>
);

const RoleBreakdownCard = (
  props: DeepReadonly<{ roleBreakdown: ReadonlyRoleBreakdown }>,
): ReactElement | null => {
  if (Object.keys(props.roleBreakdown).length === 0) {
    return null;
  }
  return (
    <SidebarCard title="Role Breakdown">
      <RoleBreakdownList roleBreakdown={props.roleBreakdown} />
    </SidebarCard>
  );
};

type ExternalIdentifier = ReadonlyExternalIds[number];

const ExternalIdentifierLink = (
  props: DeepReadonly<{ externalId: ExternalIdentifier }>,
): ReactElement => {
  const label = `${props.externalId.scheme.replaceAll("_", " ")}: ${props.externalId.value}`;
  if (hasText(props.externalId.url)) {
    return (
      <a
        href={props.externalId.url}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-2 text-muted-foreground transition-colors hover:text-white"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span className="truncate font-serif">{label}</span>
      </a>
    );
  }
  return (
    <span className="truncate font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
      {label}
    </span>
  );
};

const ExternalIdentifierRow = (
  props: DeepReadonly<{ externalId: ExternalIdentifier }>,
): ReactElement => (
  <div className="flex items-center gap-2">
    <ExternalIdentifierLink externalId={props.externalId} />
  </div>
);

const ExternalIdentifierContent = (
  props: DeepReadonly<{ externalIds: ReadonlyExternalIds }>,
): ReactElement => {
  if (props.externalIds.length === 0) {
    return (
      <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        No external identifiers recorded.
      </p>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      {props.externalIds.map((externalId) => (
        <ExternalIdentifierRow
          key={`${externalId.scheme}-${externalId.value}`}
          externalId={externalId}
        />
      ))}
    </div>
  );
};

const ExternalIdentifiersCard = (
  props: DeepReadonly<{ externalIds: ReadonlyExternalIds }>,
): ReactElement => (
  <SidebarCard title="External Identifiers">
    <ExternalIdentifierContent externalIds={props.externalIds} />
  </SidebarCard>
);

export { PersonWikiSidebar };
