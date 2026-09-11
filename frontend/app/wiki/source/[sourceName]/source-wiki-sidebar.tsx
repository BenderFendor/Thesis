import type { ReactElement } from "react";
import { ChevronLeft, ExternalLink, Network, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { SidebarCard, SidebarFact } from "@/features/wiki/ui/wiki-primitives";
import { buildAtlasNeighborhoodHref } from "@/features/intelligence-atlas/lib/atlas-query-state";
import { hasText } from "@/lib/utils";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { formatLedgerValue } from "./source-wiki-helpers";
import type { ReadonlySourceProfile } from "./source-wiki-types";

type SourceSidebarProps = DeepReadonly<{
  data: ReadonlySourceProfile;
  embedded: boolean;
  outletEntityId?: string;
  avgScore: number | null;
  indexing: boolean;
  onIndex: () => void;
}>;

const SourceSidebar = (props: SourceSidebarProps): ReactElement => (
  <>
    {!props.embedded && (
      <Link
        href="/wiki/ownership"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="font-mono text-[10px] tracking-widest uppercase">Source wiki</span>
      </Link>
    )}

    <div className="mt-5">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Source
      </div>
      <h1 className="mt-1 font-serif text-3xl">{props.data.name}</h1>
      <SourceIdentityBadges data={props.data} />
      <SourceNeighborhoodLink outletEntityId={props.outletEntityId} />
    </div>

    <SidebarCard title="Quick Facts">
      <QuickFacts data={props.data} avgScore={props.avgScore} />
    </SidebarCard>

    <SidebarCard title="Official Pages">
      <OfficialPages pages={props.data.official_pages} />
    </SidebarCard>

    <SidebarCard title="Links">
      <SourceSidebarLinks data={props.data} />
    </SidebarCard>

    <SidebarCard title="People And Ownership">
      <PeopleAndOwnership data={props.data} />
    </SidebarCard>

    <SourceIndexButton data={props.data} indexing={props.indexing} onIndex={props.onIndex} />
  </>
);

const SourceIdentityBadges = (
  props: DeepReadonly<{ data: ReadonlySourceProfile }>,
): ReactElement => (
  <div className="mt-3 flex flex-wrap gap-1.5">
    {hasText(props.data.country) && (
      <Badge variant="outline" className="font-mono text-[10px] tracking-widest">
        {props.data.country}
      </Badge>
    )}
    {hasText(props.data.bias_rating) && (
      <Badge variant="outline" className="font-mono text-[10px] tracking-widest">
        {props.data.bias_rating}
      </Badge>
    )}
    {hasText(props.data.funding_type) && (
      <Badge variant="outline" className="font-mono text-[10px] tracking-widest">
        {props.data.funding_type}
      </Badge>
    )}
    {props.data.is_state_media === true && (
      <Badge variant="outline" className="font-mono text-[10px] tracking-widest">
        State media
      </Badge>
    )}
  </div>
);

const SourceNeighborhoodLink = (
  props: DeepReadonly<{ outletEntityId?: string }>,
): ReactElement | null => {
  if (!hasText(props.outletEntityId)) {
    return null;
  }
  return (
    <Link
      href={buildAtlasNeighborhoodHref(props.outletEntityId)}
      className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
    >
      <Network className="h-3 w-3" />
      Explore neighborhood
    </Link>
  );
};

const SourceSidebarLinks = (props: DeepReadonly<{ data: ReadonlySourceProfile }>): ReactElement => (
  <div className="space-y-2 text-sm">
    {hasText(props.data.website) && <SidebarLink href={props.data.website} label="Official site" />}
    {hasText(props.data.wikidata_url) && (
      <SidebarLink href={props.data.wikidata_url} label="Wikidata" />
    )}
    {hasText(props.data.wikipedia_url) && (
      <SidebarLink href={props.data.wikipedia_url} label="Wikipedia fallback" />
    )}
    {hasText(props.data.search_links?.source_search) && (
      <SidebarLink href={props.data.search_links.source_search} label="Search the web" />
    )}
  </div>
);

const getIndexButtonClassName = (indexing: boolean): string => {
  if (indexing) {
    return "animate-spin";
  }
  return "";
};

const getIndexButtonLabel = (indexing: boolean): string => {
  if (indexing) {
    return "Indexing...";
  }
  return "Index source";
};

const SourceIndexButton = (
  props: DeepReadonly<{
    data: ReadonlySourceProfile;
    indexing: boolean;
    onIndex: () => void;
  }>,
): ReactElement | null => {
  if (props.data.index_status === "complete") {
    return null;
  }
  return (
    <button
      onClick={props.onIndex}
      disabled={props.indexing}
      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10 disabled:opacity-50 font-mono text-[10px] tracking-widest uppercase"
    >
      <RefreshCw className={`h-4 w-4 ${getIndexButtonClassName(props.indexing)}`} />
      {getIndexButtonLabel(props.indexing)}
    </button>
  );
};

const QuickFacts = (
  props: DeepReadonly<{ data: ReadonlySourceProfile; avgScore: number | null }>,
): ReactElement => (
  <>
    <SidebarFact label="Articles" value={String(props.data.article_count)} />
    <SidebarFact label="Index" value={props.data.index_status ?? "unindexed"} />
    {hasText(props.data.source_type) && <SidebarFact label="Type" value={props.data.source_type} />}
    {hasText(props.data.category) && <SidebarFact label="Category" value={props.data.category} />}
    {hasText(props.data.parent_company) && (
      <SidebarFact label="Parent" value={props.data.parent_company} />
    )}
    {props.data.credibility_score !== null && props.data.credibility_score !== undefined && (
      <SidebarFact label="Credibility" value={props.data.credibility_score.toFixed(1)} />
    )}
    {props.data.source_ledger && (
      <SidebarFact
        label="Paywall rate"
        value={formatLedgerValue(props.data.source_ledger.paywall.paywall_rate, "share")}
      />
    )}
    {props.data.source_ledger && (
      <SidebarFact label="RSS health" value={props.data.source_ledger.rss_health.status} />
    )}
    {props.avgScore !== null && (
      <SidebarFact label="Avg stored score" value={props.avgScore.toFixed(1)} />
    )}
  </>
);

const OfficialPages = (
  props: DeepReadonly<{ pages: ReadonlySourceProfile["official_pages"] }>,
): ReactElement => {
  if (props.pages === undefined || props.pages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground font-mono text-[10px] tracking-widest uppercase">
        No official pages extracted yet.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {props.pages.map((page) => (
        <OfficialPageLink key={`${page.label}-${page.url}`} page={page} />
      ))}
    </div>
  );
};

type OfficialPage = NonNullable<ReadonlySourceProfile["official_pages"]>[number];

const OfficialPageLink = (props: DeepReadonly<{ page: OfficialPage }>): ReactElement => (
  <a
    href={props.page.url}
    target="_blank"
    rel="noreferrer"
    className="block rounded-xl bg-black/20 border border-white/5 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg group relative overflow-hidden"
  >
    <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 to-primary/5 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />
    <div className="capitalize font-serif relative z-10">{props.page.label}</div>
    <div className="mt-1 line-clamp-3 text-xs text-muted-foreground relative z-10">
      {props.page.summary}
    </div>
  </a>
);

const OwnershipItem = (props: DeepReadonly<{ name: string }>): ReactElement => (
  <div className="rounded-xl bg-black/20 border border-white/10 px-3 py-2 text-sm">
    {props.name}
  </div>
);

const OwnershipSection = (
  props: DeepReadonly<{ data: ReadonlySourceProfile }>,
): ReactElement | null => {
  if (props.data.ownership_chain.length === 0) {
    return null;
  }
  return (
    <>
      <div className="mb-2 font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
        Ownership
      </div>
      <div className="space-y-2">
        {props.data.ownership_chain.map((organization) => (
          <OwnershipItem key={organization.name} name={organization.name} />
        ))}
      </div>
    </>
  );
};

const ReporterListLink = (
  props: DeepReadonly<{ reporter: ReadonlySourceProfile["reporters"][number] }>,
): ReactElement => (
  <Link
    href={`/wiki/reporter/${props.reporter.id}`}
    className="flex items-center justify-between rounded-xl bg-black/20 border border-white/5 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg group relative overflow-hidden"
  >
    <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 to-primary/5 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />
    <span className="truncate font-serif relative z-10">{props.reporter.name}</span>
    <span className="font-mono text-[10px] tracking-widest text-muted-foreground relative z-10">
      {props.reporter.article_count}
    </span>
  </Link>
);

const ReporterSection = (
  props: DeepReadonly<{ data: ReadonlySourceProfile }>,
): ReactElement | null => {
  if (props.data.reporters.length === 0) {
    return null;
  }
  return (
    <>
      <div className="mb-2 font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
        Reporters
      </div>
      <div className="space-y-2">
        {props.data.reporters.slice(0, 8).map((reporter) => (
          <ReporterListLink key={reporter.id} reporter={reporter} />
        ))}
      </div>
    </>
  );
};

const PeopleAndOwnership = (props: DeepReadonly<{ data: ReadonlySourceProfile }>): ReactElement => (
  <div className="space-y-3">
    <OwnershipSection data={props.data} />
    <ReporterSection data={props.data} />
  </div>
);

const SidebarLink = (props: DeepReadonly<{ href: string; label: string }>): ReactElement => (
  <a
    href={props.href}
    target="_blank"
    rel="noreferrer"
    className="flex items-center gap-2 text-[#b8d7ff] hover:text-white transition-colors group"
  >
    <ExternalLink className="h-3.5 w-3.5 group-hover:opacity-100" />
    <span className="font-mono text-[10px] tracking-widest uppercase">{props.label}</span>
  </a>
);

export { SourceSidebar };
