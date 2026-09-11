"use client";

import { ChevronLeft, ExternalLink, Loader2, Network } from "lucide-react";
import { Panel, SidebarCard } from "@/features/wiki/ui/wiki-primitives";
import { Badge } from "@/components/ui/badge";
import { FundingBiasPanel } from "@/features/intelligence-atlas/funding-bias-panel";
import { GlobalNavigation } from "@/components/global-navigation";
import Link from "next/link";
import { OwnershipChain } from "@/features/intelligence-atlas/ownership-chain";
import { formatArticleDate } from "@/lib/date-formatters";
import type {
  AtlasConnectionView,
  AtlasControlView,
  AtlasEvidenceView,
  AtlasExternalIdView,
  ConnectionRowProps,
  ConnectionStatusProps,
  ConnectionsPanelProps,
  ControlCardProps,
  ControlsPanelProps,
  ErrorStateProps,
  EvidenceCardProps,
  EvidenceDateProps,
  EvidenceDetailsProps,
  EvidencePanelProps,
  EvidenceSourceLinkProps,
  ExternalIdentifierProps,
  ExternalIdentifiersCardProps,
  ExternalIdentifierValueProps,
  FundingAndBiasSectionProps,
  OrganizationLayoutProps,
  OrganizationMainProps,
  OwnershipPanelProps,
  PageShellProps,
  PanelEmptyMessageProps,
  PercentageProps,
} from "./organization-wiki-view-types";
import {
  ATLAS_HREF,
  DECIMAL_PLACES,
  EMPTY_COUNT,
  SINGLE_ITEM_COUNT,
  getErrorMessage,
  getEvidenceSourceLabel,
  getNonEmptyText,
} from "./organization-wiki-view-types";

const AmbientBackground = () => (
    <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
  );
const AtlasBackLink = () => (
    <Link
      href={ATLAS_HREF}
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <ChevronLeft className="h-4 w-4" />
      Back to Intelligence Atlas
    </Link>
  );
const ConnectionRow = ({ connection }: ConnectionRowProps) => {
    const profilePath = getNonEmptyText(connection.entity.profile_path),
      row = <ConnectionRowBody connection={connection} />;
    if (profilePath === undefined) {
      return <div>{row}</div>;
    }

    return <Link href={profilePath}>{row}</Link>;
  };
const ConnectionRowBody = ({ connection }: ConnectionRowProps) => (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg group">
      <ConnectionSummary connection={connection} />
      <ConnectionStatus connection={connection} />
    </div>
  );
const ConnectionStatus = ({ connection }: ConnectionStatusProps) => (
    <div className="text-right">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {connection.edge.fact_status}
      </div>
      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
        {connection.edge.evidence_count} evidence
      </div>
    </div>
  );
const ConnectionSummary = ({ connection }: ConnectionRowProps) => (
    <div className="min-w-0">
      <div className="truncate font-serif group-hover:text-white transition-colors">
        {connection.entity.label}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {connection.edge.relation_type.replaceAll("_", " ")} · {connection.edge.direction}
      </div>
    </div>
  );
const ConnectionsPanel = ({ connections }: ConnectionsPanelProps) => {
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
          {connections.map((connection: AtlasConnectionView) => (
            <ConnectionRow key={connection.edge.id} connection={connection} />
          ))}
        </div>
      </Panel>
    );
  };
const ControlCard = ({ entry }: ControlCardProps) => {
    const profilePath = getNonEmptyText(entry.profile_path);
    const body = <ControlCardBody entry={entry} />;
    if (profilePath === undefined) {
      return <div key={entry.entity_id}>{body}</div>;
    }

    return (
      <Link key={entry.entity_id} href={profilePath}>
        {body}
      </Link>
    );
  };
const ControlCardBody = ({ entry }: ControlCardProps) => (
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
  );
const ControlsPanel = ({ controls }: ControlsPanelProps) => {
    if (controls.length === EMPTY_COUNT) {
      return (
        <Panel
          title="Controls"
          eyebrow="Everything this owner reaches through accepted ownership edges"
        >
          <PanelEmptyMessage>No downstream entities recorded under this owner.</PanelEmptyMessage>
        </Panel>
      );
    }

    return (
      <Panel
        title="Controls"
        eyebrow="Everything this owner reaches through accepted ownership edges"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {controls.map((entry: AtlasControlView) => (
            <ControlCard key={entry.entity_id} entry={entry} />
          ))}
        </div>
      </Panel>
    );
  };
const EvidenceCard = ({ item }: EvidenceCardProps) => (
    <div className="rounded-2xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <EvidenceDetails item={item} />
        <EvidenceSourceLink value={item.source_url} />
      </div>
    </div>
  );
const EvidenceDate = ({ value }: EvidenceDateProps) => {
    const date = getNonEmptyText(value);
    if (date === undefined) {
      return (
        <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Not recorded
        </div>
      );
    }

    return (
      <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {formatArticleDate(date)}
      </div>
    );
  };
const EvidenceDetails = ({ item }: EvidenceDetailsProps) => (
    <div className="min-w-0">
      <div className="text-sm font-serif">{getEvidenceSourceLabel(item)}</div>
      <OptionalExcerpt value={item.excerpt} />
      <EvidenceDate value={item.retrieved_at} />
    </div>
  );
const EvidencePanel = ({ evidence }: EvidencePanelProps) => {
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
          {evidence.map((item: AtlasEvidenceView) => (
            <EvidenceCard key={item.id} item={item} />
          ))}
        </div>
      </Panel>
    );
  };
const EvidenceSourceLink = ({ value }: EvidenceSourceLinkProps) => {
    const sourceUrl = getNonEmptyText(value);
    if (sourceUrl === undefined) {
      return null;
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
  };
const ExternalIdentifier = ({ identifier }: ExternalIdentifierProps) => {
    const label = `${identifier.scheme.replaceAll("_", " ")}: ${identifier.value}`,
      url = getNonEmptyText(identifier.url);
    return (
      <div key={`${identifier.scheme}-${identifier.value}`} className="flex items-center gap-2">
        <ExternalIdentifierValue label={label} url={url} />
      </div>
    );
  };
const ExternalIdentifierList = ({ externalIds }: ExternalIdentifiersCardProps) => {
    if (externalIds.length === EMPTY_COUNT) {
      return <PanelEmptyMessage>No external identifiers recorded.</PanelEmptyMessage>;
    }

    return (
      <div className="space-y-2 text-sm">
        {externalIds.map((identifier: AtlasExternalIdView) => (
          <ExternalIdentifier
            key={`${identifier.scheme}-${identifier.value}`}
            identifier={identifier}
          />
        ))}
      </div>
    );
  };
const ExternalIdentifierValue = ({ label, url }: ExternalIdentifierValueProps) => {
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
  };
const ExternalIdentifiersCard = ({ externalIds }: ExternalIdentifiersCardProps) => (
    <SidebarCard title="External Identifiers">
      <ExternalIdentifierList externalIds={externalIds} />
    </SidebarCard>
  );
const FundingAndBiasSection = ({ block }: FundingAndBiasSectionProps) => {
    if (block === undefined) {
      return null;
    }

    return (
      <Panel title="Funding & Bias" eyebrow="Funding type beside cited bias/factuality ratings">
        <div className="rounded-2xl border border-white/5 bg-black/20 p-5">
          <FundingBiasPanel block={block} />
        </div>
      </Panel>
    );
  };
const OptionalExcerpt = ({ value }: { readonly value: string | null | undefined }) => {
    const excerpt = getNonEmptyText(value);
    if (excerpt === undefined) {
      return null;
    }

    return <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{excerpt}</p>;
  };
const OrganizationErrorState = ({ error }: ErrorStateProps) => (
    <OrganizationPageShell contentClassName="flex-1 p-6 relative z-10 custom-scrollbar">
      <AtlasBackLink />
      <div className="mt-16 text-center text-red-400 font-mono text-sm">
        {getErrorMessage(error)}
      </div>
    </OrganizationPageShell>
  );
const OrganizationLayout = ({ children }: Readonly<OrganizationLayoutProps>) => (
    <main className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      {children}
    </main>
  );
const OrganizationLoadingState = () => (
    <OrganizationPageShell contentClassName="flex-1 flex min-h-screen items-center justify-center relative z-10 custom-scrollbar">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </OrganizationPageShell>
  );
const OrganizationMain = ({
    chain,
    connections,
    controls,
    evidence,
    fundingAndBias,
    entityId,
  }: OrganizationMainProps) => (
    <section className="space-y-5">
      <FundingAndBiasSection block={fundingAndBias} />
      <OwnershipPanel chain={chain} currentEntityId={entityId} />
      <ControlsPanel controls={controls} />
      <ConnectionsPanel connections={connections} />
      <EvidencePanel evidence={evidence} />
    </section>
  );
const OrganizationPageShell = ({ children, contentClassName }: Readonly<PageShellProps>) => (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      <GlobalNavigation />
      <div className={contentClassName}>
        <AmbientBackground />
        {children}
      </div>
    </div>
  );
const OwnershipPanel = ({ chain, currentEntityId }: OwnershipPanelProps) => {
    if (chain.length <= SINGLE_ITEM_COUNT) {
      return (
        <Panel
          title="Ownership Chain"
          eyebrow="This entity's evidenced parents, up to the ultimate owner"
        >
          <PanelEmptyMessage>
            No accepted ownership chain recorded above this entity.
          </PanelEmptyMessage>
        </Panel>
      );
    }

    return (
      <Panel
        title="Ownership Chain"
        eyebrow="This entity's evidenced parents, up to the ultimate owner"
      >
        <div className="rounded-2xl border border-white/5 bg-black/20 p-5">
          <OwnershipChain chain={chain} currentEntityId={currentEntityId} />
        </div>
      </Panel>
    );
  };
const PanelEmptyMessage = ({ children, icon }: Readonly<PanelEmptyMessageProps>) => {
    if (icon === true) {
      return (
        <div className="flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
          <Network className="h-3.5 w-3.5" />
          {children}
        </div>
      );
    }

    return (
      <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        {children}
      </p>
    );
  };
const Percentage = ({ value }: PercentageProps) => {
    const percentage = value ?? undefined;
    if (percentage === undefined) {
      return null;
    }

    return (
      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
        {percentage.toFixed(DECIMAL_PLACES)}%
      </span>
    );
  };

export {
  AtlasBackLink,
  ExternalIdentifiersCard,
  OrganizationErrorState,
  OrganizationLayout,
  OrganizationLoadingState,
  OrganizationMain,
  OrganizationPageShell,
};
