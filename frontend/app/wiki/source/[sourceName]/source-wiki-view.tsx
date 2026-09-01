"use client";

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronLeft,
  ExternalLink,
  Loader2,
  Network,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GlobalNavigation } from "@/components/global-navigation";
import { fetchWikiSource, triggerWikiIndex } from '@/lib/api';
import type { SourceLedger, SourceLedgerMetric, WikiAnalysisAxis, WikiSourceProfile } from '@/lib/api';
import { fetchAtlasEntity, searchAtlas } from "@/features/intelligence-atlas/lib/atlas-api";
import { parseFundingAndBias, parseOwnershipChain } from "@/features/intelligence-atlas/lib/atlas-schema";
import { buildAtlasNeighborhoodHref } from "@/features/intelligence-atlas/lib/atlas-query-state";
import { FundingBiasPanel } from "@/features/intelligence-atlas/funding-bias-panel";
import { OwnershipChain } from "@/features/intelligence-atlas/ownership-chain";

const ANALYSIS_META: Record<string, { label: string; description: string }> = {
  credibility: { description: "Correction and reliability track record.", label: "Credibility" },
  framing_omission: { description: "Loaded framing and omissions.", label: "Framing / Omission" },
  funding: { description: "Funding and structural dependency.", label: "Funding" },
  political_bias: { description: "Observed ideological tilt.", label: "Political Bias" },
  source_network: { description: "Who the outlet relies on.", label: "Source Network" },
},

 ANALYSIS_ORDER = [
  "funding",
  "source_network",
  "political_bias",
  "credibility",
  "framing_omission",
] as const;

function useEmbeddedFlag(): boolean {
  const [embedded, setEmbedded] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") {return}
    setEmbedded(new URLSearchParams(globalThis.location.search).get("embedded") === "1")
  }, [])
  return embedded
}

const getOwnershipChain = (entity: { details: Record<string, unknown> } | undefined) =>
  entity ? parseOwnershipChain(entity.details) : [],

 getFundingAndBias = (entity: { details: Record<string, unknown> } | undefined) =>
  entity ? parseFundingAndBias(entity.details) : null,

 getAverageScore = (axes: readonly WikiAnalysisAxis[] | undefined): number | null => {
  if (!axes?.length) {return null}
  return axes.reduce((sum, axis) => sum + axis.score, 0) / axes.length
},

 runWikiIndex = async ({
  sourceName,
  setIndexing,
  refetch,
}: {
  sourceName: string
  setIndexing: (value: boolean) => void
  refetch: () => Promise<unknown>
}): Promise<void> => {
  setIndexing(true)
  try {
    await triggerWikiIndex(sourceName)
    await refetch()
  } finally {
    setIndexing(false)
  }
}

export function SourceWikiView({ sourceName }:Readonly< { sourceName: string }>) {
  const embedded = useEmbeddedFlag(),
   [indexing, setIndexing] = useState(false),
   {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery<WikiSourceProfile>({
    queryFn: () => fetchWikiSource(sourceName),
    queryKey: ["wiki-source", sourceName],
    retry: 1,
  }),

   { data: atlasSearch } = useQuery({
    enabled: Boolean(sourceName),
    queryFn: () => searchAtlas(sourceName),
    queryKey: ["wiki-source-atlas-search", sourceName],
    retry: 1,
  }),
   outletEntityId = atlasSearch?.outlets.find(
    (item) => item.label.toLowerCase() === sourceName.toLowerCase(),
  )?.id ?? atlasSearch?.outlets[0]?.id,
   { data: outletAtlasEntity } = useQuery({
    enabled: Boolean(outletEntityId),
    queryFn: () => fetchAtlasEntity(outletEntityId as string),
    queryKey: ["wiki-source-atlas-entity", outletEntityId],
    retry: 1,
  }),
   ownershipChain = getOwnershipChain(outletAtlasEntity),
   fundingAndBias = getFundingAndBias(outletAtlasEntity),
   avgScore = getAverageScore(data?.analysis_axes);

  return renderSourceWikiContent({
    avgScore,
    data,
    embedded,
    error,
    fundingAndBias,
    isLoading,
    indexing,
    outletEntityId,
    onIndex: () => void runWikiIndex({ refetch, setIndexing, sourceName }),
    ownershipChain,
  });
}

function renderSourceWikiContent({
  avgScore,
  data,
  embedded,
  error,
  fundingAndBias,
  indexing,
  isLoading,
  onIndex,
  outletEntityId,
  ownershipChain,
}: Readonly<{
  avgScore: number | null;
  data: WikiSourceProfile | undefined;
  embedded: boolean;
  error: unknown;
  fundingAndBias: ReturnType<typeof parseFundingAndBias>;
  indexing: boolean;
  isLoading: boolean;
  onIndex: () => void;
  outletEntityId?: string;
  ownershipChain: ReturnType<typeof parseOwnershipChain>;
}>) {
  if (isLoading) {
    return <SourceWikiLoading embedded={embedded} />;
  }

  if (error || !data) {
    const message = error instanceof Error ? error.message : "Source not found";
    return <SourceWikiError embedded={embedded} message={message} />;
  }

  return (
    <SourceWikiLayout
      avgScore={avgScore}
      data={data}
      embedded={embedded}
      fundingAndBias={fundingAndBias}
      indexing={indexing}
      onIndex={onIndex}
      outletEntityId={outletEntityId}
      ownershipChain={ownershipChain}
    />
  );
}

function SourceSidebar({
  data,
  embedded,
  outletEntityId,
  avgScore,
  indexing,
  onIndex,
}:Readonly< {
  data: WikiSourceProfile;
  embedded: boolean;
  outletEntityId?: string;
  avgScore: number | null;
  indexing: boolean;
  onIndex: () => void;
}>) {
  return (
    <>
      {!embedded && (
        <Link href="/wiki/ownership" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          <span className="font-mono text-[10px] tracking-widest uppercase">Source wiki</span>
        </Link>
      )}

      <div className="mt-5">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Source
        </div>
        <h1 className="mt-1 font-serif text-3xl">{data.name}</h1>
        <SourceIdentityBadges data={data} />
        <SourceNeighborhoodLink outletEntityId={outletEntityId} />
      </div>

      <SidebarCard title="Quick Facts">
        <QuickFacts data={data} avgScore={avgScore} />
      </SidebarCard>

      <SidebarCard title="Official Pages">
        <OfficialPages pages={data.official_pages} />
      </SidebarCard>

      <SidebarCard title="Links">
        <SourceSidebarLinks data={data} />
      </SidebarCard>

      <SidebarCard title="People And Ownership">
        <PeopleAndOwnership data={data} />
      </SidebarCard>

      <SourceIndexButton data={data} indexing={indexing} onIndex={onIndex} />
    </>
  );
}

function SourceIdentityBadges({ data }: { data: WikiSourceProfile }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {data.country && <Badge variant="outline" className="font-mono text-[10px] tracking-widest">{data.country}</Badge>}
      {data.bias_rating && <Badge variant="outline" className="font-mono text-[10px] tracking-widest">{data.bias_rating}</Badge>}
      {data.funding_type && <Badge variant="outline" className="font-mono text-[10px] tracking-widest">{data.funding_type}</Badge>}
      {data.is_state_media && <Badge variant="outline" className="font-mono text-[10px] tracking-widest">State media</Badge>}
    </div>
  )
}

function SourceNeighborhoodLink({ outletEntityId }: { outletEntityId?: string }) {
  if (!outletEntityId) {return null}
  return (
    <Link
      href={buildAtlasNeighborhoodHref(outletEntityId)}
      className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
    >
      <Network className="h-3 w-3" />
      Explore neighborhood
    </Link>
  )
}

function SourceSidebarLinks({ data }: { data: WikiSourceProfile }) {
  return (
    <div className="space-y-2 text-sm">
      {data.website && <SidebarLink href={data.website} label="Official site" />}
      {data.wikidata_url && <SidebarLink href={data.wikidata_url} label="Wikidata" />}
      {data.wikipedia_url && <SidebarLink href={data.wikipedia_url} label="Wikipedia fallback" />}
      {data.search_links?.source_search && <SidebarLink href={data.search_links.source_search} label="Search the web" />}
    </div>
  )
}

function SourceIndexButton({
  data,
  indexing,
  onIndex,
}: {
  data: WikiSourceProfile
  indexing: boolean
  onIndex: () => void
}) {
  if (data.index_status === "complete") {return null}
  return (
    <button
      onClick={onIndex}
      disabled={indexing}
      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10 disabled:opacity-50 font-mono text-[10px] tracking-widest uppercase"
    >
      <RefreshCw className={`h-4 w-4 ${indexing ? "animate-spin" : ""}`} />
      {indexing ? "Indexing..." : "Index source"}
    </button>
  )
}

function QuickFacts({ data, avgScore }:Readonly< { data: WikiSourceProfile; avgScore: number | null }>) {
  return (
    <>
      <SidebarFact label="Articles" value={String(data.article_count)} />
      <SidebarFact label="Index" value={data.index_status || "unindexed"} />
      {data.source_type && <SidebarFact label="Type" value={data.source_type} />}
      {data.category && <SidebarFact label="Category" value={data.category} />}
      {data.parent_company && <SidebarFact label="Parent" value={data.parent_company} />}
      {data.credibility_score != null && (
        <SidebarFact label="Credibility" value={data.credibility_score.toFixed(1)} />
      )}
      {data.source_ledger && (
        <SidebarFact
          label="Paywall rate"
          value={formatLedgerValue(data.source_ledger.paywall.paywall_rate, "share")}
        />
      )}
      {data.source_ledger && (
        <SidebarFact label="RSS health" value={data.source_ledger.rss_health.status} />
      )}
      {avgScore != null && <SidebarFact label="Avg stored score" value={avgScore.toFixed(1)} />}
    </>
  );
}

function OfficialPages({ pages }:Readonly< { pages: WikiSourceProfile["official_pages"] }>) {
  if (!pages?.length) {
    return (
      <p className="text-sm text-muted-foreground font-mono text-[10px] tracking-widest uppercase">
        No official pages extracted yet.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {pages.map((page) => (
        <OfficialPageLink key={`${page.label}-${page.url}`} page={page} />
      ))}
    </div>
  );
}

function OfficialPageLink({ page }:Readonly< { page: NonNullable<WikiSourceProfile["official_pages"]>[number] }>) {
  return (
    <a
      href={page.url}
      target="_blank"
      rel="noreferrer"
      className="block rounded-xl bg-black/20 border border-white/5 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg group relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 to-primary/5 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />
      <div className="capitalize font-serif relative z-10">{page.label}</div>
      <div className="mt-1 line-clamp-3 text-xs text-muted-foreground relative z-10">{page.summary}</div>
    </a>
  );
}

function PeopleAndOwnership({ data }:Readonly< { data: WikiSourceProfile }>) {
  return (
    <div className="space-y-3">
      {data.ownership_chain.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Ownership
          </div>
          <div className="space-y-2">
            {data.ownership_chain.map((org) => (
              <div key={org.name} className="rounded-xl bg-black/20 border border-white/10 px-3 py-2 text-sm">
                {org.name}
              </div>
            ))}
          </div>
        </div>
      )}
      {data.reporters.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            Reporters
          </div>
          <div className="space-y-2">
            {data.reporters.slice(0, 8).map((reporter) => (
              <ReporterListLink key={reporter.id} reporter={reporter} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReporterListLink({ reporter }:Readonly< { reporter: WikiSourceProfile["reporters"][number] }>) {
  return (
    <Link
      href={`/wiki/reporter/${reporter.id}`}
      className="flex items-center justify-between rounded-xl bg-black/20 border border-white/5 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg group relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 to-primary/5 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />
      <span className="truncate font-serif relative z-10">{reporter.name}</span>
      <span className="font-mono text-[10px] tracking-widest text-muted-foreground relative z-10">{reporter.article_count}</span>
    </Link>
  );
}

function SourcePageBody({
  data,
  outletEntityId,
  ownershipChain,
  fundingAndBias,
}:Readonly< {
  data: WikiSourceProfile;
  outletEntityId?: string;
  ownershipChain: ReturnType<typeof parseOwnershipChain>;
  fundingAndBias: ReturnType<typeof parseFundingAndBias>;
}>) {
  return (
    <>
      <OverviewPanel data={data} />
      {data.source_ledger && <SourceLedgerPanel ledger={data.source_ledger} />}
      <PublicEvidencePanel data={data} />
      {data.organization && (
        <OrganizationPanel organization={data.organization} ownershipChain={data.ownership_chain} />
      )}
      {fundingAndBias && (
        <Panel title="Funding & Bias" eyebrow="Funding type beside cited bias/factuality ratings">
          <div className="rounded-2xl bg-black/20 border border-white/5 p-5">
            <FundingBiasPanel block={fundingAndBias} />
          </div>
        </Panel>
      )}
      {ownershipChain.length > 1 && outletEntityId && (
        <Panel title="Ownership Chain" eyebrow="Evidence-backed ownership, from this outlet to its ultimate owner">
          <div className="rounded-2xl bg-black/20 border border-white/5 p-5">
            <OwnershipChain chain={ownershipChain} currentEntityId={outletEntityId} />
          </div>
        </Panel>
      )}
      {data.reporters.length > 0 && <ReportersPanel data={data} />}
      {data.analysis_axes.length > 0 && <StoredAnalysisPanel axes={data.analysis_axes} />}
      {data.citations.length > 0 && <CitationsPanel citations={data.citations} />}
    </>
  );
}

function SourceWikiLoading({ embedded }: Readonly<{ embedded: boolean }>) {
  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      {!embedded && <GlobalNavigation />}
      <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar flex items-center justify-center">
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}

function SourceWikiError({
  embedded,
  message,
}: Readonly<{ embedded: boolean; message: string }>) {
  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      {!embedded && <GlobalNavigation />}
      <div
        className={`flex-1 overflow-y-auto relative z-10 custom-scrollbar ${embedded ? "p-4" : "p-6"}`}
      >
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
        {!embedded && (
          <Link
            href="/wiki/ownership"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="font-mono text-[10px] tracking-widest uppercase">
              Back to source wiki
            </span>
          </Link>
        )}
        <div className="mt-16 text-center text-red-400 font-mono">{message}</div>
      </div>
    </div>
  );
}

function SourceWikiLayout({
  data,
  embedded,
  outletEntityId,
  avgScore,
  indexing,
  onIndex,
  ownershipChain,
  fundingAndBias,
}: Readonly<{
  data: WikiSourceProfile;
  embedded: boolean;
  outletEntityId?: string;
  avgScore: number | null;
  indexing: boolean;
  onIndex: () => void;
  ownershipChain: ReturnType<typeof parseOwnershipChain>;
  fundingAndBias: ReturnType<typeof parseFundingAndBias>;
}>) {
  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      {!embedded && <GlobalNavigation />}
      <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar">
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
        <main
          className={`mx-auto grid gap-5 p-4 ${embedded ? "max-w-none lg:grid-cols-[280px_minmax(0,1fr)]" : "max-w-[1500px] lg:grid-cols-[300px_minmax(0,1fr)]"}`}
        >
          <aside
            className={`rounded-2xl bg-black/40 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] ring-1 ring-white/5 p-4 ${embedded ? "lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto" : "lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto"}`}
          >
            <SourceSidebar
              data={data}
              embedded={embedded}
              outletEntityId={outletEntityId}
              avgScore={avgScore}
              indexing={indexing}
              onIndex={onIndex}
            />
          </aside>
          <section className="space-y-5">
            <SourcePageBody
              data={data}
              outletEntityId={outletEntityId}
              ownershipChain={ownershipChain}
              fundingAndBias={fundingAndBias}
            />
          </section>
        </main>
      </div>
    </div>
  );
}

function OverviewPanel({ data }:Readonly< { data: WikiSourceProfile }>) {
  return (
    <Panel title="Overview" eyebrow="Deterministic profile">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
          <p className="text-sm leading-7 text-foreground/90">
            {data.overview || "No overview extracted from official or public records yet."}
          </p>
        </div>
        <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Match method
          </div>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            {data.match_explanation || "Built from official site pages, public records, and linked ownership data."}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function SourceLedgerPanel({ ledger }:Readonly< { ledger: SourceLedger }>) {
  return (
    <Panel title="Source Ledger" eyebrow="Observed database signals">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ledger.metrics.map((metric) => (
          <LedgerMetricCard key={metric.id} metric={metric} />
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <LedgerFact
          label="Paywall mix"
          value={`${ledger.paywall.paywalled_articles} locked / ${ledger.paywall.free_articles} free`}
        />
        <LedgerFact
          label="RSS health"
          value={ledger.rss_health.status}
        />
        <LedgerFact
          label="Policy signals"
          value={String(ledger.source_transparency.policy_signal_count)}
        />
      </div>
    </Panel>
  );
}

function LedgerMetricCard({ metric }:Readonly< { metric: SourceLedgerMetric }>) {
  return (
    <div
      className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {metric.label}
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {metric.description}
          </p>
        </div>
        <Badge variant="outline" className="font-mono text-[10px] tracking-widest">
          {metric.status}
        </Badge>
      </div>
      <div className="mt-4 font-serif text-2xl">
        {formatLedgerValue(metric.value, metric.unit)}
      </div>
    </div>
  );
}

function PublicEvidencePanel({ data }:Readonly< { data: WikiSourceProfile }>) {
  return (
    <Panel title="Public Evidence" eyebrow="Official pages and public records">
      <div className="space-y-3">
        {data.dossier_sections.map((section) => (
          <EvidenceSectionCard key={section.id} section={section} />
        ))}
      </div>
    </Panel>
  );
}

function EvidenceSectionCard({ section }:Readonly< { section: WikiSourceProfile["dossier_sections"][number] }>) {
  return (
    <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {section.title}
      </div>
      {section.items.length > 0 ? (
        <div className="mt-3 space-y-3">
          {section.items.slice(0, 6).map((item, index) => (
            <div key={`${section.id}-${index}`}>
              <div className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">{item.label || "Record"}</div>
              <div className="mt-1 text-sm leading-6 text-foreground/90">{item.value}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground font-mono text-[10px] tracking-widest uppercase">No public record found.</p>
      )}
    </div>
  );
}

function OrganizationPanel({
  organization,
  ownershipChain,
}:Readonly< {
  organization: NonNullable<WikiSourceProfile["organization"]>;
  ownershipChain: WikiSourceProfile["ownership_chain"];
}>) {
  return (
    <Panel title="Organization" eyebrow="Ownership and funding record">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="font-serif text-lg">{organization.name}</span>
          </div>
          <div className="grid gap-2 text-sm">
            {organization.org_type && <SidebarFact label="Type" value={organization.org_type} />}
            {organization.funding_type && <SidebarFact label="Funding" value={organization.funding_type} />}
            {organization.factual_reporting && (
              <SidebarFact label="Factual reporting" value={organization.factual_reporting} />
            )}
            {organization.media_bias_rating && (
              <SidebarFact label="Bias rating" value={organization.media_bias_rating} />
            )}
            {organization.annual_revenue != null && (
              <SidebarFact
                label="Annual revenue"
                value={`$${organization.annual_revenue.toLocaleString()}`}
              />
            )}
          </div>
        </div>
        <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Ownership chain
          </div>
          {ownershipChain.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {ownershipChain.map((org) => (
                <div key={org.name} className="rounded-xl bg-black/20 border border-white/10 px-3 py-2 text-sm transition-all hover:bg-white/[0.03]">
                  {org.name}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground font-mono text-[10px] tracking-widest uppercase">No ownership chain recorded.</p>
          )}
          <Link
            href="/wiki/ownership"
            className="mt-4 inline-flex items-center gap-2 text-sm text-[#b8d7ff] hover:text-white group transition-colors"
          >
            <span className="font-mono text-[10px] tracking-widest uppercase">Open ownership explorer</span>
            <ExternalLink className="h-3.5 w-3.5 group-hover:opacity-100" />
          </Link>
        </div>
      </div>
    </Panel>
  );
}

function ReportersPanel({ data }:Readonly< { data: WikiSourceProfile }>) {
  return (
    <Panel title="Reporters" eyebrow="People attached to this source in the local corpus">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.reporters.map((reporter) => (
          <ReporterCard key={reporter.id} reporter={reporter} />
        ))}
      </div>
    </Panel>
  );
}

function ReporterCard({ reporter }:Readonly< { reporter: WikiSourceProfile["reporters"][number] }>) {
  return (
    <Link
      href={`/wiki/reporter/${reporter.id}`}
      className="group rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4 relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 to-primary/5 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />

      <div className="font-serif text-base relative z-10">{reporter.name}</div>
      {reporter.topics?.length ? (
        <div className="mt-2 flex flex-wrap gap-1 relative z-10">
          {reporter.topics.slice(0, 3).map((topic) => (
            <Badge key={topic} variant="outline" className="font-mono text-[10px] tracking-widest">
              {topic}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground relative z-10">
        <span className="font-mono text-[10px] tracking-widest uppercase">{reporter.political_leaning || "unknown"}</span>
        <span className="font-mono text-[10px] tracking-widest uppercase">{reporter.article_count} articles</span>
      </div>
    </Link>
  );
}

function StoredAnalysisPanel({ axes }:Readonly< { axes: WikiAnalysisAxis[] }>) {
  return (
    <Panel title="Stored Analysis" eyebrow="Existing score records already attached to this source">
      <div className="space-y-3">
        {ANALYSIS_ORDER.map((axisName) => {
          const axis = axes.find((item) => item.axis_name === axisName);
          return axis ? <AnalysisAxisCard key={axis.axis_name} score={axis} /> : null;
        })}
      </div>
    </Panel>
  );
}

function CitationsPanel({ citations }:Readonly< { citations: WikiSourceProfile["citations"] }>) {
  return (
    <Panel title="Citations" eyebrow="Public references used for this page">
      <div className="space-y-2 rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5 text-sm">
        {citations.map((citation, index) => (
          <CitationRow key={`${citation.label}-${index}`} citation={citation} />
        ))}
      </div>
    </Panel>
  );
}

function CitationRow({ citation }:Readonly< { citation: WikiSourceProfile["citations"][number] }>) {
  return (
    <div>
      {citation.url ? (
        <a href={citation.url} target="_blank" rel="noreferrer" className="text-[#b8d7ff] transition-colors hover:text-white group">
          <span className="group-hover:opacity-100">{citation.label}</span>
        </a>
      ) : (
        <span>{citation.label}</span>
      )}
      {citation.note ? <span className="text-muted-foreground font-mono text-[10px] tracking-widest ml-2">· {citation.note}</span> : null}
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  children,
}:Readonly< {
  title: string;
  eyebrow: string;
  children: ReactNode;
}>) {
  return (
    <section>
      <div className="mb-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{eyebrow}</div>
        <h2 className="mt-1 font-serif text-2xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SidebarCard({
  title,
  children,
}:Readonly< {
  title: string;
  children: ReactNode;
}>) {
  return (
    <div className="mt-4 rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function SidebarFact({ label, value }:Readonly< { label: string; value: string }>) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-right">{value}</span>
    </div>
  );
}

function SidebarLink({ href, label }:Readonly< { href: string; label: string }>) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[#b8d7ff] hover:text-white transition-colors group">
      <ExternalLink className="h-3.5 w-3.5 group-hover:opacity-100" />
      <span className="font-mono text-[10px] tracking-widest uppercase">{label}</span>
    </a>
  );
}

function formatLedgerValue(value: number, unit: string): string {
  if (unit === "share") {
    return `${Math.round(value * 100)}%`;
  }
  return `${value} ${unit}`;
}

function LedgerFact({ label, value }:Readonly< { label: string; value: string }>) {
  return (
    <div className="rounded-2xl bg-black/20 border border-white/5 p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 font-mono text-sm">{value}</div>
    </div>
  );
}

function scoreColor(score: number): string {
  return `hsl(${(5 - score) * 24}, 70%, 55%)`;
}

function AnalysisAxisCard({ score }:Readonly< { score: WikiAnalysisAxis }>) {
  const meta = ANALYSIS_META[score.axis_name] || {
    description: "Stored score data.",
    label: score.axis_name,
  };

  return (
    <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest">{meta.label}</div>
          <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
        </div>
        <div className="text-right">
          <div className="font-serif text-xl font-semibold" style={{ color: scoreColor(score.score) }}>
            {score.score}/5
          </div>
          {score.confidence ? <div className="font-mono text-[10px] tracking-widest text-muted-foreground mt-1">{score.confidence}</div> : null}
        </div>
      </div>
      {score.prose_explanation ? (
        <p className="mt-4 text-sm leading-6 text-foreground/90">{score.prose_explanation}</p>
      ) : null}
      {score.empirical_basis ? (
        <div className="mt-3 rounded-xl bg-black/20 border border-white/10 p-3 text-xs leading-6 text-muted-foreground font-mono tracking-wide">
          {score.empirical_basis}
        </div>
      ) : null}
      {score.citations?.length ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {score.citations.map((citation, index) =>
            citation.url ? (
              <a key={`${citation.title || citation.url}-${index}`} href={citation.url} target="_blank" rel="noreferrer" className="text-[#b8d7ff] transition-colors hover:text-white group">
                <span className="group-hover:opacity-100">{citation.title || citation.url}</span>
              </a>
            ) : null
          )}
        </div>
      ) : null}
    </div>
  );
}
