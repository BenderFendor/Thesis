"use client";

import { type ReactNode, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ChevronLeft,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  fetchWikiSource,
  triggerWikiIndex,
  type WikiAnalysisAxis,
  type WikiSourceProfile,
} from "@/lib/api";

const ANALYSIS_META: Record<string, { label: string; description: string }> = {
  funding: { label: "Funding", description: "Funding and structural dependency." },
  source_network: { label: "Source Network", description: "Who the outlet relies on." },
  political_bias: { label: "Political Bias", description: "Observed ideological tilt." },
  credibility: { label: "Credibility", description: "Correction and reliability track record." },
  framing_omission: { label: "Framing / Omission", description: "Loaded framing and omissions." },
};

const ANALYSIS_ORDER = [
  "funding",
  "source_network",
  "political_bias",
  "credibility",
  "framing_omission",
] as const;

export function SourceWikiView({ sourceName }: { sourceName: string }) {
  const [indexing, setIndexing] = useState(false);
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery<WikiSourceProfile>({
    queryKey: ["wiki-source", sourceName],
    queryFn: () => fetchWikiSource(sourceName),
    retry: 1,
  });

  const avgScore = useMemo(() => {
    if (!data?.analysis_axes?.length) return null;
    return (
      data.analysis_axes.reduce((sum, axis) => sum + axis.score, 0) /
      data.analysis_axes.length
    );
  }, [data?.analysis_axes]);

  async function handleTriggerIndex() {
    setIndexing(true);
    try {
      await triggerWikiIndex(sourceName);
      await refetch();
    } finally {
      setIndexing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--news-bg-primary)]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    const message = error instanceof Error ? error.message : "Source not found";
    return (
      <div className="min-h-screen bg-[var(--news-bg-primary)] p-6 text-foreground">
        <Link href="/wiki" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Back to source wiki
        </Link>
        <div className="mt-16 text-center text-red-400">{message}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--news-bg-primary)] text-foreground">
      <main className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-white/10 bg-[#0d1118] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.25)] lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <Link href="/wiki" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Source wiki
          </Link>

          <div className="mt-5">
            <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Source
            </div>
            <h1 className="mt-1 font-serif text-2xl">{data.name}</h1>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.country && <Badge variant="outline">{data.country}</Badge>}
              {data.bias_rating && <Badge variant="outline">{data.bias_rating}</Badge>}
              {data.funding_type && <Badge variant="outline">{data.funding_type}</Badge>}
              {data.is_state_media && <Badge variant="outline">State media</Badge>}
            </div>
          </div>

          <SidebarCard title="Quick Facts">
            <SidebarFact label="Articles" value={String(data.article_count)} />
            <SidebarFact label="Index" value={data.index_status || "unindexed"} />
            {data.source_type && <SidebarFact label="Type" value={data.source_type} />}
            {data.category && <SidebarFact label="Category" value={data.category} />}
            {data.parent_company && <SidebarFact label="Parent" value={data.parent_company} />}
            {data.credibility_score != null && (
              <SidebarFact label="Credibility" value={data.credibility_score.toFixed(1)} />
            )}
            {avgScore != null && <SidebarFact label="Avg stored score" value={avgScore.toFixed(1)} />}
          </SidebarCard>

          <SidebarCard title="Official Pages">
            {data.official_pages?.length ? (
              <div className="space-y-2">
                {data.official_pages.map((page) => (
                  <a
                    key={`${page.label}-${page.url}`}
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-white/10 px-3 py-2 text-sm transition-colors hover:border-white/20 hover:bg-white/5"
                  >
                    <div className="capitalize">{page.label}</div>
                    <div className="mt-1 line-clamp-3 text-xs text-muted-foreground">{page.summary}</div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No official pages extracted yet.</p>
            )}
          </SidebarCard>

          <SidebarCard title="Links">
            <div className="space-y-2 text-sm">
              {data.website && <SidebarLink href={data.website} label="Official site" />}
              {data.wikidata_url && <SidebarLink href={data.wikidata_url} label="Wikidata" />}
              {data.wikipedia_url && <SidebarLink href={data.wikipedia_url} label="Wikipedia fallback" />}
              {data.search_links?.source_search && (
                <SidebarLink href={data.search_links.source_search} label="Search the web" />
              )}
            </div>
          </SidebarCard>

          <SidebarCard title="People And Ownership">
            <div className="space-y-3">
              {data.ownership_chain.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    Ownership
                  </div>
                  <div className="space-y-2">
                    {data.ownership_chain.map((org) => (
                      <div key={org.name} className="rounded-xl border border-white/10 px-3 py-2 text-sm">
                        {org.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {data.reporters.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    Reporters
                  </div>
                  <div className="space-y-2">
                    {data.reporters.slice(0, 8).map((reporter) => (
                      <Link
                        key={reporter.id}
                        href={`/wiki/reporter/${reporter.id}`}
                        className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-sm transition-colors hover:border-white/20 hover:bg-white/5"
                      >
                        <span className="truncate">{reporter.name}</span>
                        <span className="text-[11px] text-muted-foreground">{reporter.article_count}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SidebarCard>

          {data.index_status !== "complete" && (
            <button
              onClick={handleTriggerIndex}
              disabled={indexing}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${indexing ? "animate-spin" : ""}`} />
              {indexing ? "Indexing..." : "Index source"}
            </button>
          )}
        </aside>

        <section className="space-y-5">
          <Panel title="Overview" eyebrow="Deterministic profile">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#0d1118] p-5">
                <p className="text-sm leading-7 text-foreground/90">
                  {data.overview || "No overview extracted from official or public records yet."}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0d1118] p-5">
                <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                  Match method
                </div>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  {data.match_explanation || "Built from official site pages, public records, and linked ownership data."}
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Public Evidence" eyebrow="Official pages and public records">
            <div className="space-y-3">
              {data.dossier_sections.map((section) => (
                <div key={section.id} className="rounded-2xl border border-white/10 bg-[#0d1118] p-4">
                  <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                    {section.title}
                  </div>
                  {section.items.length > 0 ? (
                    <div className="mt-3 space-y-3">
                      {section.items.slice(0, 6).map((item, index) => (
                        <div key={`${section.id}-${index}`}>
                          <div className="text-xs text-muted-foreground">{item.label || "Record"}</div>
                          <div className="mt-1 text-sm leading-6 text-foreground/90">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">No public record found.</p>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          {data.organization && (
            <Panel title="Organization" eyebrow="Ownership and funding record">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-[#0d1118] p-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {data.organization.name}
                  </div>
                  <div className="grid gap-2 text-sm">
                    {data.organization.org_type && <SidebarFact label="Type" value={data.organization.org_type} />}
                    {data.organization.funding_type && <SidebarFact label="Funding" value={data.organization.funding_type} />}
                    {data.organization.factual_reporting && (
                      <SidebarFact label="Factual reporting" value={data.organization.factual_reporting} />
                    )}
                    {data.organization.media_bias_rating && (
                      <SidebarFact label="Bias rating" value={data.organization.media_bias_rating} />
                    )}
                    {data.organization.annual_revenue != null && (
                      <SidebarFact
                        label="Annual revenue"
                        value={`$${data.organization.annual_revenue.toLocaleString()}`}
                      />
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0d1118] p-5">
                  <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    Ownership chain
                  </div>
                  {data.ownership_chain.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {data.ownership_chain.map((org) => (
                        <div key={org.name} className="rounded-xl border border-white/10 px-3 py-2 text-sm">
                          {org.name}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">No ownership chain recorded.</p>
                  )}
                  <Link
                    href="/wiki/ownership"
                    className="mt-4 inline-flex items-center gap-2 text-sm text-[#b8d7ff] hover:text-white"
                  >
                    Open ownership explorer
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </Panel>
          )}

          {data.reporters.length > 0 && (
            <Panel title="Reporters" eyebrow="People attached to this source in the local corpus">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {data.reporters.map((reporter) => (
                  <Link
                    key={reporter.id}
                    href={`/wiki/reporter/${reporter.id}`}
                    className="rounded-2xl border border-white/10 bg-[#0d1118] p-4 transition-colors hover:border-white/20 hover:bg-white/5"
                  >
                    <div className="font-serif text-base">{reporter.name}</div>
                    {reporter.topics?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {reporter.topics.slice(0, 3).map((topic) => (
                          <Badge key={topic} variant="outline" className="text-[10px]">
                            {topic}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{reporter.political_leaning || "unknown"}</span>
                      <span>{reporter.article_count} articles</span>
                    </div>
                  </Link>
                ))}
              </div>
            </Panel>
          )}

          {data.analysis_axes.length > 0 && (
            <Panel title="Stored Analysis" eyebrow="Existing score records already attached to this source">
              <div className="space-y-3">
                {ANALYSIS_ORDER.map((axisName) => {
                  const axis = data.analysis_axes.find((item) => item.axis_name === axisName);
                  return axis ? <AnalysisAxisCard key={axis.axis_name} score={axis} /> : null;
                })}
              </div>
            </Panel>
          )}

          {data.citations.length > 0 && (
            <Panel title="Citations" eyebrow="Public references used for this page">
              <div className="space-y-2 rounded-2xl border border-white/10 bg-[#0d1118] p-5 text-sm">
                {data.citations.map((citation, index) => (
                  <div key={`${citation.label}-${index}`}>
                    {citation.url ? (
                      <a href={citation.url} target="_blank" rel="noreferrer" className="text-[#b8d7ff] hover:text-white">
                        {citation.label}
                      </a>
                    ) : (
                      <span>{citation.label}</span>
                    )}
                    {citation.note ? <span className="text-muted-foreground"> · {citation.note}</span> : null}
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </section>
      </main>
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3">
        <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</div>
        <h2 className="mt-1 font-serif text-2xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SidebarCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function SidebarFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function SidebarLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[#b8d7ff] hover:text-white">
      <ExternalLink className="h-3.5 w-3.5" />
      <span>{label}</span>
    </a>
  );
}

function scoreColor(score: number): string {
  return `hsl(${(5 - score) * 24}, 70%, 55%)`;
}

function AnalysisAxisCard({ score }: { score: WikiAnalysisAxis }) {
  const meta = ANALYSIS_META[score.axis_name] || {
    label: score.axis_name,
    description: "Stored score data.",
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d1118] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm uppercase tracking-[0.15em]">{meta.label}</div>
          <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold" style={{ color: scoreColor(score.score) }}>
            {score.score}/5
          </div>
          {score.confidence ? <div className="text-xs text-muted-foreground">{score.confidence}</div> : null}
        </div>
      </div>
      {score.prose_explanation ? (
        <p className="mt-4 text-sm leading-6 text-foreground/90">{score.prose_explanation}</p>
      ) : null}
      {score.empirical_basis ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-6 text-muted-foreground">
          {score.empirical_basis}
        </div>
      ) : null}
      {score.citations?.length ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {score.citations.map((citation, index) =>
            citation.url ? (
              <a key={`${citation.title || citation.url}-${index}`} href={citation.url} target="_blank" rel="noreferrer" className="text-[#b8d7ff] hover:text-white">
                {citation.title || citation.url}
              </a>
            ) : null
          )}
        </div>
      ) : null}
    </div>
  );
}
