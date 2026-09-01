"use client";

import { ChevronLeft, ExternalLink, Loader2, Network } from "lucide-react";
import {
  parseControls,
  parseExternalIds,
  parseFundingAndBias,
  parseOwnershipChain,
  parseRoleBreakdown,
} from "@/features/intelligence-atlas/lib/atlas-schema";
import { Badge } from "@/components/ui/badge";
import { FundingBiasPanel } from "@/features/intelligence-atlas/funding-bias-panel";
import { GlobalNavigation } from "@/components/global-navigation";
import { OwnershipChain } from "@/features/intelligence-atlas/ownership-chain";
import { buildAtlasNeighborhoodHref } from "@/features/intelligence-atlas/lib/atlas-query-state";
import { fetchAtlasEntity } from "@/features/intelligence-atlas/lib/atlas-api";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

type AtlasEntityRecord = Awaited<ReturnType<typeof fetchAtlasEntity>>;
type AtlasConnectionRecord = AtlasEntityRecord["connections"][number];
type AtlasEvidenceRecord = AtlasEntityRecord["evidence"][number];
type AtlasControlsEntry = ReturnType<typeof parseControls>[number];
type AtlasExternalId = ReturnType<typeof parseExternalIds>[number];
type AtlasFundingAndBias = NonNullable<ReturnType<typeof parseFundingAndBias>>;
type AtlasOwnershipChainHop = ReturnType<typeof parseOwnershipChain>[number];
type DetailValue = AtlasEntityRecord["details"][string];

interface AtlasConnectionView { readonly edge: { readonly direction: AtlasConnectionRecord["edge"]["direction"]; readonly evidence_count: number; readonly fact_status: AtlasConnectionRecord["edge"]["fact_status"]; readonly id: string; readonly relation_type: AtlasConnectionRecord["edge"]["relation_type"] }; readonly entity: { readonly label: string; readonly profile_path?: string | null }; }
interface AtlasControlView { readonly entity_id: string; readonly entity_type: AtlasControlsEntry["entity_type"]; readonly evidence_count: number; readonly label: string; readonly percentage?: number | null; readonly profile_path?: string | null; }
type AtlasDetailsView = Readonly<Record<string, DetailValue>>;
interface AtlasEvidenceView { readonly excerpt?: string | null; readonly id: string; readonly retrieved_at?: string | null; readonly source_name?: string | null; readonly source_type: string; readonly source_url?: string | null; }
interface AtlasExternalIdView { readonly scheme: string; readonly url?: string | null; readonly value: string; }
interface OrganizationDataView { readonly confidence_tier?: string | null; readonly connections: readonly AtlasConnectionView[]; readonly details: AtlasDetailsView; readonly evidence: readonly AtlasEvidenceView[]; readonly id: string; readonly label: string; readonly last_verified_at?: string | null; readonly status?: string | null; readonly subtitle?: string | null; }
interface BadgeProps { readonly value: string | null | undefined; }
interface ConnectionRowProps { readonly connection: AtlasConnectionView; }
interface ConnectionStatusProps { readonly connection: AtlasConnectionView; }
interface ConnectionsPanelProps { readonly connections: readonly AtlasConnectionView[]; }
interface ControlCardProps { readonly entry: AtlasControlView; }
interface ControlsPanelProps { readonly controls: readonly AtlasControlView[]; }
interface ErrorStateProps { readonly error: Error | null | undefined; }
interface EvidenceCardProps { readonly item: AtlasEvidenceView; }
interface EvidenceDateProps { readonly value: string | null | undefined; }
interface EvidenceDetailsProps { readonly item: AtlasEvidenceView; }
interface EvidencePanelProps { readonly evidence: readonly AtlasEvidenceView[]; }
interface EvidenceSourceLinkProps { readonly value: string | null | undefined; }
interface ExternalIdentifierProps { readonly identifier: AtlasExternalIdView; }
interface ExternalIdentifiersCardProps { readonly externalIds: readonly AtlasExternalIdView[]; }
interface ExternalIdentifierValueProps { readonly label: string; readonly url: string | undefined; }
interface FundingAndBiasSectionProps { readonly block: AtlasFundingAndBias | undefined; }
interface OrganizationContentProps { readonly data: OrganizationDataView; }
interface OrganizationLayoutProps { readonly children: React.ReactNode; }
interface OrganizationMainProps { readonly chain: AtlasOwnershipChainHop[]; readonly connections: readonly AtlasConnectionView[]; readonly controls: readonly AtlasControlView[]; readonly evidence: readonly AtlasEvidenceView[]; readonly fundingAndBias: AtlasFundingAndBias | undefined; readonly entityId: string; }
interface OrganizationSidebarProps { readonly data: OrganizationDataView; readonly externalIds: readonly AtlasExternalIdView[]; readonly roleBreakdown: Readonly<Record<string, number>>; }
interface OrganizationWikiViewProps { readonly entityId: string; }
interface OwnershipPanelProps { readonly chain: readonly AtlasOwnershipChainHop[]; readonly currentEntityId: string; }
interface PageShellProps { readonly children: React.ReactNode; readonly contentClassName: string; }
interface PanelEmptyMessageProps { readonly children: React.ReactNode; readonly icon?: boolean; }
interface PanelHeadingProps { readonly eyebrow: string; readonly title: string; }
interface PanelProps { readonly children: React.ReactNode; readonly eyebrow: string; readonly title: string; }
interface PercentageProps { readonly value: number | null | undefined; }
interface RoleBreakdownEntryProps { readonly count: number; readonly role: string; }
interface RoleBreakdownCardProps { readonly roleBreakdown: Readonly<Record<string, number>>; }
interface SidebarCardProps { readonly children: React.ReactNode; readonly title: string; }
interface SidebarFactProps { readonly label: string; readonly value: string; }
interface OptionalSidebarFactProps { readonly label: string; readonly value: string | undefined; }
interface VerifiedDateFactProps { readonly value: string | null | undefined; }

const ATLAS_HREF = "/wiki/ownership",
 DECIMAL_PLACES = 1,
 EMPTY_COUNT = 0,
 RETRY_COUNT = 1,
 SINGLE_ITEM_COUNT = 1,
 AmbientBackground = () => (
  <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
),
 AtlasBackLink = () => (
  <Link
    href={ATLAS_HREF}
    className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
  >
    <ChevronLeft className="h-4 w-4" />
    Back to Intelligence Atlas
  </Link>
),
 BadgeValue = ({ value }: BadgeProps) => {
  const text = getNonEmptyText(value);
  if (text === undefined) {
    return;
  }

  return (
    <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
      {text}
    </Badge>
  );
},
 ConnectionRow = ({ connection }: ConnectionRowProps) => {
  const profilePath = getNonEmptyText(connection.entity.profile_path),
   row = <ConnectionRowBody connection={connection} />;
  if (profilePath === undefined) {
    return <div>{row}</div>;
  }

  return <Link href={profilePath}>{row}</Link>;
},
 ConnectionRowBody = ({ connection }: ConnectionRowProps) => (
  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg group">
    <ConnectionSummary connection={connection} />
    <ConnectionStatus connection={connection} />
  </div>
),
 ConnectionStatus = ({ connection }: ConnectionStatusProps) => (
  <div className="text-right">
    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {connection.edge.fact_status}
    </div>
    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
      {connection.edge.evidence_count} evidence
    </div>
  </div>
),
 ConnectionSummary = ({ connection }: ConnectionRowProps) => (
  <div className="min-w-0">
    <div className="truncate font-serif group-hover:text-white transition-colors">
      {connection.entity.label}
    </div>
    <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {connection.edge.relation_type.replaceAll("_", " ")} · {connection.edge.direction}
    </div>
  </div>
),
 ConnectionsPanel = ({ connections }: ConnectionsPanelProps) => {
  if (connections.length === EMPTY_COUNT) {
    return (
      <Panel title="Connections" eyebrow="Every relationship in the bounded evidence graph">
        <PanelEmptyMessage>No relationships in the current bounded graph.</PanelEmptyMessage>
      </Panel>
    );
  }

  return (
    <Panel title="Connections" eyebrow="Every relationship in the bounded evidence graph">
      <div className="space-y-2">
        {connections.map((connection: AtlasConnectionView) => <ConnectionRow key={connection.edge.id} connection={connection} />)}
      </div>
    </Panel>
  );
},
 ControlCard = ({ entry }: ControlCardProps) => {
  const profilePath = getNonEmptyText(entry.profile_path),
   body = <ControlCardBody entry={entry} />;
  if (profilePath === undefined) {
    return <div key={entry.entity_id}>{body}</div>;
  }

  return (
    <Link key={entry.entity_id} href={profilePath}>
      {body}
    </Link>
  );
},
 ControlCardBody = ({ entry }: ControlCardProps) => (
  <div className="group rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4 relative overflow-hidden">
    <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 to-primary/5 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />
    <div className="font-serif text-base relative z-10">{entry.label}</div>
    <div className="mt-2 flex flex-wrap items-center gap-2 relative z-10">
      <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
        {entry.entity_type}
      </Badge>
      <Percentage value={entry.percentage} />
    </div>
    <div className="mt-2 font-mono text-[10px] tracking-widest text-muted-foreground relative z-10">
      {entry.evidence_count} evidence
    </div>
  </div>
),
 ControlsPanel = ({ controls }: ControlsPanelProps) => {
  if (controls.length === EMPTY_COUNT) {
    return (
      <Panel title="Controls" eyebrow="Everything this owner reaches through accepted ownership edges">
        <PanelEmptyMessage>No downstream entities recorded under this owner.</PanelEmptyMessage>
      </Panel>
    );
  }

  return (
    <Panel title="Controls" eyebrow="Everything this owner reaches through accepted ownership edges">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {controls.map((entry: AtlasControlView) => <ControlCard key={entry.entity_id} entry={entry} />)}
      </div>
    </Panel>
  );
},
 EvidenceCard = ({ item }: EvidenceCardProps) => (
  <div className="rounded-2xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <div className="flex items-start justify-between gap-3">
      <EvidenceDetails item={item} />
      <EvidenceSourceLink value={item.source_url} />
    </div>
  </div>
),
 EvidenceDate = ({ value }: EvidenceDateProps) => {
  const date = getNonEmptyText(value);
  if (date === undefined) {
    return <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Not recorded</div>;
  }

  return (
    <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {new Date(date).toLocaleDateString()}
    </div>
  );
},
 EvidenceDetails = ({ item }: EvidenceDetailsProps) => (
  <div className="min-w-0">
    <div className="text-sm font-serif">{getEvidenceSourceLabel(item)}</div>
    <OptionalExcerpt value={item.excerpt} />
    <EvidenceDate value={item.retrieved_at} />
  </div>
),
 EvidencePanel = ({ evidence }: EvidencePanelProps) => {
  if (evidence.length === EMPTY_COUNT) {
    return (
      <Panel title="Evidence Trail" eyebrow="Citations backing the relationships above">
        <PanelEmptyMessage icon>
          No evidence rows attached to the visible relationships.
        </PanelEmptyMessage>
      </Panel>
    );
  }

  return (
    <Panel title="Evidence Trail" eyebrow="Citations backing the relationships above">
      <div className="space-y-3">
        {evidence.map((item: AtlasEvidenceView) => <EvidenceCard key={item.id} item={item} />)}
      </div>
    </Panel>
  );
},
 EvidenceSourceLink = ({ value }: EvidenceSourceLinkProps) => {
  const sourceUrl = getNonEmptyText(value);
  if (sourceUrl === undefined) {
    return;
  }

  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-white transition-colors shrink-0"
    >
      <ExternalLink className="h-4 w-4" />
    </a>
  );
},
 ExternalIdentifier = ({ identifier }: ExternalIdentifierProps) => {
  const label = `${identifier.scheme.replaceAll("_", " ")}: ${identifier.value}`,
   url = getNonEmptyText(identifier.url);
  return (
    <div key={`${identifier.scheme}-${identifier.value}`} className="flex items-center gap-2">
      <ExternalIdentifierValue label={label} url={url} />
    </div>
  );
},
 ExternalIdentifierList = ({ externalIds }: ExternalIdentifiersCardProps) => {
  if (externalIds.length === EMPTY_COUNT) {
    return <PanelEmptyMessage>No external identifiers recorded.</PanelEmptyMessage>;
  }

  return (
    <div className="space-y-2 text-sm">
      {externalIds.map((identifier: AtlasExternalIdView) => <ExternalIdentifier key={`${identifier.scheme}-${identifier.value}`} identifier={identifier} />)}
    </div>
  );
},
 ExternalIdentifierValue = ({ label, url }: ExternalIdentifierValueProps) => {
  if (url === undefined) {
    return (
      <span className="truncate font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
        {label}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-2 text-muted-foreground transition-colors hover:text-white"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      <span className="truncate font-serif">{label}</span>
    </a>
  );
},
 ExternalIdentifiersCard = ({ externalIds }: ExternalIdentifiersCardProps) => (
  <SidebarCard title="External Identifiers">
    <ExternalIdentifierList externalIds={externalIds} />
  </SidebarCard>
),
 FundingAndBiasSection = ({ block }: FundingAndBiasSectionProps) => {
  if (block === undefined) {
    return;
  }

  return (
    <Panel title="Funding & Bias" eyebrow="Funding type beside cited bias/factuality ratings">
      <div className="rounded-2xl border border-white/5 bg-black/20 p-5">
        <FundingBiasPanel block={block} />
      </div>
    </Panel>
  );
},
 NeighborhoodLink = ({ entityId }: { readonly entityId: string }) => (
  <Link
    href={buildAtlasNeighborhoodHref(entityId)}
    className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
  >
    <Network className="h-3 w-3" />
    Explore neighborhood
  </Link>
),
 OptionalBadge = ({ value }: BadgeProps) => <BadgeValue value={value} />,
 OptionalExcerpt = ({ value }: { readonly value: string | null | undefined }) => {
  const excerpt = getNonEmptyText(value);
  if (excerpt === undefined) {
    return;
  }

  return <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{excerpt}</p>;
},
 OptionalSidebarFact = ({ label, value }: OptionalSidebarFactProps) => {
  const text = value ?? undefined;
  if (text === undefined) {
    return;
  }

  return <SidebarFact label={label} value={text} />;
},
 OrganizationContent = ({ data }: OrganizationContentProps) => {
  const chain = parseOwnershipChain(data.details),
   controls = parseControls(data.details),
   externalIds = parseExternalIds(data.details),
   fundingAndBias = parseFundingAndBias(data.details) ?? undefined,
   roleBreakdown = parseRoleBreakdown(data.details);

  return (
    <OrganizationPageShell contentClassName="flex-1 overflow-y-auto relative z-10 custom-scrollbar">
      <OrganizationLayout>
        <OrganizationSidebar data={data} externalIds={externalIds} roleBreakdown={roleBreakdown} />
        <OrganizationMain
          chain={chain}
          connections={data.connections}
          controls={controls}
          evidence={data.evidence}
          fundingAndBias={fundingAndBias}
          entityId={data.id}
        />
      </OrganizationLayout>
    </OrganizationPageShell>
  );
},
 OrganizationErrorState = ({ error }: ErrorStateProps) => (
  <OrganizationPageShell contentClassName="flex-1 p-6 relative z-10 custom-scrollbar">
    <AtlasBackLink />
    <div className="mt-16 text-center text-red-400 font-mono text-sm">{getErrorMessage(error)}</div>
  </OrganizationPageShell>
),
 OrganizationIdentity = ({ data }: OrganizationContentProps) => (
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
),
 OrganizationLayout = ({ children }: OrganizationLayoutProps) => (
  <main className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
    {children}
  </main>
),
 OrganizationLoadingState = () => (
  <OrganizationPageShell contentClassName="flex-1 flex min-h-screen items-center justify-center relative z-10 custom-scrollbar">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </OrganizationPageShell>
),
 OrganizationMain = ({ chain, connections, controls, evidence, fundingAndBias, entityId }: OrganizationMainProps) => (
  <section className="space-y-5">
    <FundingAndBiasSection block={fundingAndBias} />
    <OwnershipPanel chain={chain} currentEntityId={entityId} />
    <ControlsPanel controls={controls} />
    <ConnectionsPanel connections={connections} />
    <EvidencePanel evidence={evidence} />
  </section>
),
 OrganizationPageShell = ({ children, contentClassName }: PageShellProps) => (
  <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
    <GlobalNavigation />
    <div className={contentClassName}>
      <AmbientBackground />
      {children}
    </div>
  </div>
),
 OrganizationSidebar = ({ data, externalIds, roleBreakdown }: OrganizationSidebarProps) => (
  <aside className="rounded-2xl border bg-black/40 backdrop-blur-2xl border-white/10 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] ring-1 ring-white/5 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto custom-scrollbar">
    <OrganizationIdentity data={data} />
    <SidebarCard title="Quick Facts">
      <QuickFacts data={data} />
    </SidebarCard>
    <RoleBreakdownCard roleBreakdown={roleBreakdown} />
    <ExternalIdentifiersCard externalIds={externalIds} />
  </aside>
),
 OrganizationWikiView = ({ entityId }: OrganizationWikiViewProps) => {
  const { data, error, isLoading } = useQuery<AtlasEntityRecord>({
    enabled: Boolean(entityId),
    queryFn: () => fetchAtlasEntity(entityId),
    queryKey: ["atlas-entity", entityId],
    retry: RETRY_COUNT,
  });

  if (isLoading) {
    return <OrganizationLoadingState />;
  }

  const queryError = error ?? undefined;
  if (queryError !== undefined || data === undefined) {
    return <OrganizationErrorState error={queryError} />;
  }

  return <OrganizationContent data={data} />;
},
 OwnershipPanel = ({ chain, currentEntityId }: OwnershipPanelProps) => {
  if (chain.length <= SINGLE_ITEM_COUNT) {
    return (
      <Panel title="Ownership Chain" eyebrow="This entity's evidenced parents, up to the ultimate owner">
        <PanelEmptyMessage>No accepted ownership chain recorded above this entity.</PanelEmptyMessage>
      </Panel>
    );
  }

  return (
    <Panel title="Ownership Chain" eyebrow="This entity's evidenced parents, up to the ultimate owner">
      <div className="rounded-2xl border border-white/5 bg-black/20 p-5">
        <OwnershipChain chain={chain} currentEntityId={currentEntityId} />
      </div>
    </Panel>
  );
},
 Panel = ({ children, eyebrow, title }: PanelProps) => (
  <section>
    <PanelHeading eyebrow={eyebrow} title={title} />
    {children}
  </section>
),
 PanelEmptyMessage = ({ children, icon }: PanelEmptyMessageProps) => {
  if (icon === true) {
    return (
      <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        <Network className="h-3.5 w-3.5" />
        {children}
      </div>
    );
  }

  return <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">{children}</p>;
},
 PanelHeading = ({ eyebrow, title }: PanelHeadingProps) => (
  <div className="mb-3">
    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{eyebrow}</div>
    <h2 className="mt-1 font-serif text-2xl">{title}</h2>
  </div>
),
 Percentage = ({ value }: PercentageProps) => {
  const percentage = value ?? undefined;
  if (percentage === undefined) {
    return;
  }

  return <span className="font-mono text-[10px] tracking-widest text-muted-foreground">{percentage.toFixed(DECIMAL_PLACES)}%</span>;
},
 QuickFacts = ({ data }: OrganizationContentProps) => (
  <>
    <SidebarFact label="Evidence" value={String(data.evidence.length)} />
    <SidebarFact label="Connections" value={String(data.connections.length)} />
    <OptionalSidebarFact label="Funding" value={getStringDetail(data.details.funding_type)} />
    <VerifiedDateFact value={data.last_verified_at} />
  </>
),
 OrganizationBadges = ({ data }: OrganizationContentProps) => (
  <div className="mt-3 flex flex-wrap gap-1.5">
    <OptionalBadge value={data.subtitle} />
    <OptionalBadge value={data.status} />
    <OptionalBadge value={data.confidence_tier} />
  </div>
),
 RoleBreakdownEntry = ({ count, role }: RoleBreakdownEntryProps) => (
  <div className="flex items-center justify-between text-[10px] font-mono tracking-widest uppercase">
    <span className="text-muted-foreground">{role.replaceAll("_", " ")}</span>
    <span>{count}</span>
  </div>
),
 RoleBreakdownCard = ({ roleBreakdown }: RoleBreakdownCardProps) => {
  if (Object.keys(roleBreakdown).length === EMPTY_COUNT) {
    return;
  }

  return (
    <SidebarCard title="Role Breakdown">
      <div className="space-y-2">
        {Object.entries(roleBreakdown).map(([role, count]: readonly [string, number]) => <RoleBreakdownEntry key={role} role={role} count={count} />)}
      </div>
    </SidebarCard>
  );
},
 SidebarCard = ({ children, title }: SidebarCardProps) => (
  <div className="mt-4 rounded-2xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
    <div className="mb-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{title}</div>
    {children}
  </div>
),
 SidebarFact = ({ label, value }: SidebarFactProps) => (
  <div className="flex items-start justify-between gap-3 text-[10px] font-mono tracking-widest uppercase mt-2">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right">{value}</span>
  </div>
),
 VerifiedDateFact = ({ value }: VerifiedDateFactProps) => {
  const date = getNonEmptyText(value);
  if (date === undefined) {
    return;
  }

  return <SidebarFact label="Last verified" value={new Date(date).toLocaleDateString()} />;
},
 getErrorMessage = (error: Error | null | undefined): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Organization not found";
},
 getEvidenceSourceLabel = (item: AtlasEvidenceView): string => {
  const sourceName = getNonEmptyText(item.source_name);
  if (sourceName !== undefined) {
    return sourceName;
  }

  return item.source_type;
},
 getNonEmptyText = (value: string | null | undefined): string | undefined => {
  const text = value ?? undefined;
  if (text === undefined || text.length === EMPTY_COUNT) {
    return;
  }

  return text;
},
 getStringDetail = (value: DetailValue): string | undefined => {
  if (isStringDetail(value)) {
    return value;
  }

  return;
},
 isStringDetail = (value: DetailValue): value is string => typeof value === "string";

export { OrganizationWikiView };
