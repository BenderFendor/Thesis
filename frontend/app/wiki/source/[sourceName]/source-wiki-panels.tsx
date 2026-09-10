import type { ReactElement } from "react";
import { Building2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FundingBiasPanel } from "@/features/intelligence-atlas/funding-bias-panel";
import { OwnershipChain } from "@/features/intelligence-atlas/ownership-chain";
import { Panel, SidebarFact } from "@/features/wiki/ui/wiki-primitives";
import { WikiCitationPanel } from "@/features/wiki/ui/wiki-citation-panel";
import {
  ANALYSIS_ORDER,
  formatLedgerValue,
  getAnalysisMeta,
  hasText,
  scoreStyleFor,
} from "./source-wiki-helpers";
import type {
  DeepReadonly,
  ReadonlyAnalysisAxis,
  ReadonlyFundingAndBias,
  ReadonlyOwnershipChain,
  ReadonlySourceLedger,
  ReadonlySourceLedgerMetric,
  ReadonlySourceProfile,
} from "./source-wiki-types";

type SourcePageBodyProps = DeepReadonly<{
  data: ReadonlySourceProfile;
  outletEntityId?: string;
  ownershipChain: ReadonlyOwnershipChain;
  fundingAndBias: ReadonlyFundingAndBias;
}>;

const SourcePageBody = (props: SourcePageBodyProps): ReactElement => (
  <>
    <OverviewPanel data={props.data} />
    <PublicEvidencePanel data={props.data} />
    <SourcePageOptionalPanels
      data={props.data}
      fundingAndBias={props.fundingAndBias}
      outletEntityId={props.outletEntityId}
      ownershipChain={props.ownershipChain}
    />
  </>
);

const SourcePageOptionalPanels = (props: SourcePageBodyProps): ReactElement => (
  <>
    {props.data.source_ledger !== null && props.data.source_ledger !== undefined && (
      <SourceLedgerPanel ledger={props.data.source_ledger} />
    )}
    {props.data.organization !== null && props.data.organization !== undefined && (
      <OrganizationPanel
        organization={props.data.organization}
        ownershipChain={props.data.ownership_chain}
      />
    )}
    {props.fundingAndBias !== null && <FundingBiasBlock fundingAndBias={props.fundingAndBias} />}
    {props.ownershipChain.length > 1 && hasText(props.outletEntityId) && (
      <OwnershipChainBlock
        ownershipChain={props.ownershipChain}
        outletEntityId={props.outletEntityId}
      />
    )}
    {props.data.reporters.length > 0 && <ReportersPanel data={props.data} />}
    {props.data.analysis_axes.length > 0 && <StoredAnalysisPanel axes={props.data.analysis_axes} />}
    {props.data.citations.length > 0 && <WikiCitationPanel citations={props.data.citations} />}
  </>
);

const FundingBiasBlock = (
  props: DeepReadonly<{ fundingAndBias: NonNullable<ReadonlyFundingAndBias> }>,
): ReactElement => (
  <Panel title="Funding & Bias" eyebrow="Funding type beside cited bias/factuality ratings">
    <div className="rounded-2xl bg-black/20 border border-white/5 p-5">
      <FundingBiasPanel block={props.fundingAndBias} />
    </div>
  </Panel>
);

const OwnershipChainBlock = (
  props: DeepReadonly<{
    ownershipChain: ReadonlyOwnershipChain;
    outletEntityId: string;
  }>,
): ReactElement => (
  <Panel
    title="Ownership Chain"
    eyebrow="Evidence-backed ownership, from this outlet to its ultimate owner"
  >
    <div className="rounded-2xl bg-black/20 border border-white/5 p-5">
      <OwnershipChain chain={props.ownershipChain} currentEntityId={props.outletEntityId} />
    </div>
  </Panel>
);

const OverviewPanel = (props: DeepReadonly<{ data: ReadonlySourceProfile }>): ReactElement => (
  <Panel title="Overview" eyebrow="Deterministic profile">
    <div className="grid gap-4 md:grid-cols-2">
      <OverviewText
        text={props.data.overview ?? "No overview extracted from official or public records yet."}
      />
      <OverviewMatchMethod data={props.data} />
    </div>
  </Panel>
);

const OverviewText = (props: DeepReadonly<{ text: string }>): ReactElement => (
  <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
    <p className="text-sm leading-7 text-foreground/90">{props.text}</p>
  </div>
);

const OverviewMatchMethod = (
  props: DeepReadonly<{ data: ReadonlySourceProfile }>,
): ReactElement => (
  <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      Match method
    </div>
    <p className="mt-2 text-sm leading-7 text-muted-foreground">
      {props.data.match_explanation ??
        "Built from official site pages, public records, and linked ownership data."}
    </p>
  </div>
);

const SourceLedgerPanel = (props: DeepReadonly<{ ledger: ReadonlySourceLedger }>): ReactElement => (
  <Panel title="Source Ledger" eyebrow="Observed database signals">
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {props.ledger.metrics.map((metric) => (
        <LedgerMetricCard key={metric.id} metric={metric} />
      ))}
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <LedgerFact
        label="Paywall mix"
        value={`${props.ledger.paywall.paywalled_articles} locked / ${props.ledger.paywall.free_articles} free`}
      />
      <LedgerFact label="RSS health" value={props.ledger.rss_health.status} />
      <LedgerFact
        label="Policy signals"
        value={String(props.ledger.source_transparency.policy_signal_count)}
      />
    </div>
  </Panel>
);

const LedgerMetricHeader = (
  props: DeepReadonly<{ metric: ReadonlySourceLedgerMetric }>,
): ReactElement => (
  <div className="flex items-start justify-between gap-3">
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {props.metric.label}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{props.metric.description}</p>
    </div>
    <Badge variant="outline" className="font-mono text-[10px] tracking-widest">
      {props.metric.status}
    </Badge>
  </div>
);

const LedgerMetricCard = (
  props: DeepReadonly<{ metric: ReadonlySourceLedgerMetric }>,
): ReactElement => (
  <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4">
    <LedgerMetricHeader metric={props.metric} />
    <div className="mt-4 font-serif text-2xl">
      {formatLedgerValue(props.metric.value, props.metric.unit)}
    </div>
  </div>
);

const LedgerFact = (props: DeepReadonly<{ label: string; value: string }>): ReactElement => (
  <div className="rounded-2xl bg-black/20 border border-white/5 p-4">
    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {props.label}
    </div>
    <div className="mt-2 font-mono text-sm">{props.value}</div>
  </div>
);

const PublicEvidencePanel = (
  props: DeepReadonly<{ data: ReadonlySourceProfile }>,
): ReactElement => (
  <Panel title="Public Evidence" eyebrow="Official pages and public records">
    <div className="space-y-3">
      {props.data.dossier_sections.map((section) => (
        <EvidenceSectionCard key={section.id} section={section} />
      ))}
    </div>
  </Panel>
);

type EvidenceSection = ReadonlySourceProfile["dossier_sections"][number];
type EvidenceItem = EvidenceSection["items"][number];

const EvidenceItemRow = (props: DeepReadonly<{ item: EvidenceItem }>): ReactElement => (
  <div>
    <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
      {props.item.label ?? "Record"}
    </div>
    <div className="mt-1 text-sm leading-6 text-foreground/90">{props.item.value}</div>
  </div>
);

const EvidenceSectionItems = (props: DeepReadonly<{ section: EvidenceSection }>): ReactElement => {
  if (props.section.items.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted-foreground font-mono text-[10px] tracking-widest uppercase">
        No public record found.
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-3">
      {props.section.items.slice(0, 6).map((item) => (
        <EvidenceItemRow
          key={`${props.section.id}-${item.label ?? "record"}-${item.value ?? ""}`}
          item={item}
        />
      ))}
    </div>
  );
};

const EvidenceSectionCard = (props: DeepReadonly<{ section: EvidenceSection }>): ReactElement => (
  <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4">
    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      {props.section.title}
    </div>
    <EvidenceSectionItems section={props.section} />
  </div>
);

type SourceOrganization = NonNullable<ReadonlySourceProfile["organization"]>;

const OrganizationFacts = (
  props: DeepReadonly<{ organization: SourceOrganization }>,
): ReactElement => (
  <div className="grid gap-2 text-sm">
    {hasText(props.organization.org_type) && (
      <SidebarFact label="Type" value={props.organization.org_type} />
    )}
    {hasText(props.organization.funding_type) && (
      <SidebarFact label="Funding" value={props.organization.funding_type} />
    )}
    {hasText(props.organization.factual_reporting) && (
      <SidebarFact label="Factual reporting" value={props.organization.factual_reporting} />
    )}
    {hasText(props.organization.media_bias_rating) && (
      <SidebarFact label="Bias rating" value={props.organization.media_bias_rating} />
    )}
    {props.organization.annual_revenue !== null &&
      props.organization.annual_revenue !== undefined && (
        <SidebarFact
          label="Annual revenue"
          value={`$${props.organization.annual_revenue.toLocaleString()}`}
        />
      )}
  </div>
);

const OrganizationIdentity = (
  props: DeepReadonly<{ organization: SourceOrganization }>,
): ReactElement => (
  <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
    <div className="mb-3 flex items-center gap-2 text-sm font-medium">
      <Building2 className="h-4 w-4 text-muted-foreground" />
      <span className="font-serif text-lg">{props.organization.name}</span>
    </div>
    <OrganizationFacts organization={props.organization} />
  </div>
);

const OwnershipOrganizationItem = (props: DeepReadonly<{ name: string }>): ReactElement => (
  <div className="rounded-xl bg-black/20 border border-white/10 px-3 py-2 text-sm transition-all hover:bg-white/[0.03]">
    {props.name}
  </div>
);

const OrganizationOwnership = (
  props: DeepReadonly<{ ownershipChain: ReadonlySourceProfile["ownership_chain"] }>,
): ReactElement => (
  <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
      Ownership chain
    </div>
    <OrganizationOwnershipContent ownershipChain={props.ownershipChain} />
    <Link
      href="/wiki/ownership"
      className="mt-4 inline-flex items-center gap-2 text-sm text-[#b8d7ff] hover:text-white group transition-colors"
    >
      <span className="font-mono text-[10px] tracking-widest uppercase">
        Open ownership explorer
      </span>
      <ExternalLink className="h-3.5 w-3.5 group-hover:opacity-100" />
    </Link>
  </div>
);

const OrganizationOwnershipContent = (
  props: DeepReadonly<{ ownershipChain: ReadonlySourceProfile["ownership_chain"] }>,
): ReactElement => {
  if (props.ownershipChain.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted-foreground font-mono text-[10px] tracking-widest uppercase">
        No ownership chain recorded.
      </p>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {props.ownershipChain.map((organization) => (
        <OwnershipOrganizationItem key={organization.name} name={organization.name} />
      ))}
    </div>
  );
};

const OrganizationPanel = (
  props: DeepReadonly<{
    organization: SourceOrganization;
    ownershipChain: ReadonlySourceProfile["ownership_chain"];
  }>,
): ReactElement => (
  <Panel title="Organization" eyebrow="Ownership and funding record">
    <div className="grid gap-4 lg:grid-cols-2">
      <OrganizationIdentity organization={props.organization} />
      <OrganizationOwnership ownershipChain={props.ownershipChain} />
    </div>
  </Panel>
);

const ReportersPanel = (props: DeepReadonly<{ data: ReadonlySourceProfile }>): ReactElement => (
  <Panel title="Reporters" eyebrow="People attached to this source in the local corpus">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {props.data.reporters.map((reporter) => (
        <ReporterCard key={reporter.id} reporter={reporter} />
      ))}
    </div>
  </Panel>
);

type SourceReporter = ReadonlySourceProfile["reporters"][number];

const ReporterTopics = (
  props: DeepReadonly<{ topics?: readonly string[] }>,
): ReactElement | null => {
  if (props.topics === undefined || props.topics.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1 relative z-10">
      {props.topics.slice(0, 3).map((topic) => (
        <Badge key={topic} variant="outline" className="font-mono text-[10px] tracking-widest">
          {topic}
        </Badge>
      ))}
    </div>
  );
};

const ReporterCard = (props: DeepReadonly<{ reporter: SourceReporter }>): ReactElement => (
  <Link
    href={`/wiki/reporter/${props.reporter.id}`}
    className="group rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4 relative overflow-hidden"
  >
    <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 to-primary/5 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />
    <div className="font-serif text-base relative z-10">{props.reporter.name}</div>
    <ReporterTopics topics={props.reporter.topics} />
    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground relative z-10">
      <span className="font-mono text-[10px] tracking-widest uppercase">
        {props.reporter.political_leaning ?? "unknown"}
      </span>
      <span className="font-mono text-[10px] tracking-widest uppercase">
        {props.reporter.article_count} articles
      </span>
    </div>
  </Link>
);

const StoredAnalysisPanel = (
  props: DeepReadonly<{ axes: readonly ReadonlyAnalysisAxis[] }>,
): ReactElement => (
  <Panel title="Stored Analysis" eyebrow="Existing score records already attached to this source">
    <div className="space-y-3">
      {ANALYSIS_ORDER.map((axisName) => {
        const axis = props.axes.find((item) => item.axis_name === axisName);
        if (axis === undefined) {
          return null;
        }
        return <AnalysisAxisCard key={axis.axis_name} score={axis} />;
      })}
    </div>
  </Panel>
);

const AnalysisAxisHeader = (props: DeepReadonly<{ score: ReadonlyAnalysisAxis }>): ReactElement => {
  const meta = getAnalysisMeta(props.score.axis_name);
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-widest">{meta.label}</div>
        <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
      </div>
      <AnalysisAxisScore score={props.score} />
    </div>
  );
};

const AnalysisAxisScore = (props: DeepReadonly<{ score: ReadonlyAnalysisAxis }>): ReactElement => (
  <div className="text-right">
    <div className="font-serif text-xl font-semibold" style={scoreStyleFor(props.score.score)}>
      {props.score.score}/5
    </div>
    {hasText(props.score.confidence) && (
      <div className="mt-1 font-mono text-[10px] tracking-widest text-muted-foreground">
        {props.score.confidence}
      </div>
    )}
  </div>
);

const AnalysisCitation = (
  props: DeepReadonly<{
    citation: NonNullable<ReadonlyAnalysisAxis["citations"]>[number];
  }>,
): ReactElement | null => {
  if (!hasText(props.citation.url)) {
    return null;
  }
  return (
    <a
      href={props.citation.url}
      target="_blank"
      rel="noreferrer"
      className="text-[#b8d7ff] transition-colors hover:text-white group"
    >
      <span className="group-hover:opacity-100">{props.citation.title ?? props.citation.url}</span>
    </a>
  );
};

const AnalysisAxisBody = (props: DeepReadonly<{ score: ReadonlyAnalysisAxis }>): ReactElement => (
  <>
    {hasText(props.score.prose_explanation) && (
      <p className="mt-4 text-sm leading-6 text-foreground/90">{props.score.prose_explanation}</p>
    )}
    {hasText(props.score.empirical_basis) && (
      <div className="mt-3 rounded-xl bg-black/20 border border-white/10 p-3 text-xs leading-6 text-muted-foreground font-mono tracking-wide">
        {props.score.empirical_basis}
      </div>
    )}
    {props.score.citations !== undefined && props.score.citations.length > 0 && (
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {props.score.citations.map((citation) => (
          <AnalysisCitation
            key={`${citation.title ?? "citation"}-${citation.url ?? citation.snippet ?? ""}`}
            citation={citation}
          />
        ))}
      </div>
    )}
  </>
);

const AnalysisAxisCard = (props: DeepReadonly<{ score: ReadonlyAnalysisAxis }>): ReactElement => (
  <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4">
    <AnalysisAxisHeader score={props.score} />
    <AnalysisAxisBody score={props.score} />
  </div>
);

export { SourcePageBody };
