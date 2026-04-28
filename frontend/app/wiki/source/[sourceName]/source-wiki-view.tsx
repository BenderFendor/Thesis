"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
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
import { GlobalNavigation } from "@/components/global-navigation";
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
  const [embedded, setEmbedded] = useState(false);
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

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setEmbedded(params.get("embedded") === "1");
    }
  }, []);

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
      <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
        {!embedded && <GlobalNavigation />}
        <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar flex items-center justify-center">
          <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    const message = error instanceof Error ? error.message : "Source not found";
    return (
      <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
        {!embedded && <GlobalNavigation />}
        <div className={`flex-1 overflow-y-auto relative z-10 custom-scrollbar ${embedded ? "p-4" : "p-6"}`}>
          <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
          {!embedded && (
            <Link href="/wiki" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
              <span className="font-mono text-[10px] tracking-widest uppercase">Back to source wiki</span>
            </Link>
          )}
          <div className="mt-16 text-center text-red-400 font-mono">{message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      {!embedded && <GlobalNavigation />}
      <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar">
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
        <main className={`mx-auto grid gap-5 p-4 ${embedded ? "max-w-none lg:grid-cols-[280px_minmax(0,1fr)]" : "max-w-[1500px] lg:grid-cols-[300px_minmax(0,1fr)]"}`}>
          <aside className={`rounded-2xl bg-black/40 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] ring-1 ring-white/5 p-4 ${embedded ? "lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto" : "lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto"}`}>
            {!embedded && (
              <Link href="/wiki" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <ChevronLeft className="h-4 w-4" />
                <span className="font-mono text-[10px] tracking-widest uppercase">Source wiki</span>
              </Link>
            )}

            <div className="mt-5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Source
              </div>
              <h1 className="mt-1 font-serif text-3xl">{data.name}</h1>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {data.country && <Badge variant="outline" className="font-mono text-[10px] tracking-widest">{data.country}</Badge>}
                {data.bias_rating && <Badge variant="outline" className="font-mono text-[10px] tracking-widest">{data.bias_rating}</Badge>}
                {data.funding_type && <Badge variant="outline" className="font-mono text-[10px] tracking-widest">{data.funding_type}</Badge>}
                {data.is_state_media && <Badge variant="outline" className="font-mono text-[10px] tracking-widest">State media</Badge>}
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
                      className="block rounded-xl bg-black/20 border border-white/5 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg group relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 to-primary/5 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />
                      <div className="capitalize font-serif relative z-10">{page.label}</div>
                      <div className="mt-1 line-clamp-3 text-xs text-muted-foreground relative z-10">{page.summary}</div>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground font-mono text-[10px] tracking-widest uppercase">No official pages extracted yet.</p>
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
                        <Link
                          key={reporter.id}
                          href={`/wiki/reporter/${reporter.id}`}
                          className="flex items-center justify-between rounded-xl bg-black/20 border border-white/5 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg group relative overflow-hidden"
                        >
                          <div className="absolute inset-0 bg-gradient-to-tr from-primary/0 to-primary/5 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" />
                          <span className="truncate font-serif relative z-10">{reporter.name}</span>
                          <span className="font-mono text-[10px] tracking-widest text-muted-foreground relative z-10">{reporter.article_count}</span>
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
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10 disabled:opacity-50 font-mono text-[10px] tracking-widest uppercase"
              >
                <RefreshCw className={`h-4 w-4 ${indexing ? "animate-spin" : ""}`} />
                {indexing ? "Indexing..." : "Index source"}
              </button>
            )}
          </aside>

          <section className="space-y-5">
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

            <Panel title="Public Evidence" eyebrow="Official pages and public records">
              <div className="space-y-3">
                {data.dossier_sections.map((section) => (
                  <div key={section.id} className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4">
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
                ))}
              </div>
            </Panel>

            {data.organization && (
              <Panel title="Organization" eyebrow="Ownership and funding record">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-serif text-lg">{data.organization.name}</span>
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
                  <div className="rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Ownership chain
                    </div>
                    {data.ownership_chain.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {data.ownership_chain.map((org) => (
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
            )}

            {data.reporters.length > 0 && (
              <Panel title="Reporters" eyebrow="People attached to this source in the local corpus">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {data.reporters.map((reporter) => (
                    <Link
                      key={reporter.id}
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
                <div className="space-y-2 rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5 text-sm">
                  {data.citations.map((citation, index) => (
                    <div key={`${citation.label}-${index}`}>
                      {citation.url ? (
                        <a href={citation.url} target="_blank" rel="noreferrer" className="text-[#b8d7ff] transition-colors hover:text-white group">
                          <span className="group-hover:opacity-100">{citation.label}</span>
                        </a>
                      ) : (
                        <span>{citation.label}</span>
                      )}
                      {citation.note ? <span className="text-muted-foreground font-mono text-[10px] tracking-widest ml-2">· {citation.note}</span> : null}
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </section>
        </main>
      </div>
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
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-4 rounded-2xl bg-black/20 border border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function SidebarFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="font-mono text-[10px] tracking-widest uppercase text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-right">{value}</span>
    </div>
  );
}

function SidebarLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[#b8d7ff] hover:text-white transition-colors group">
      <ExternalLink className="h-3.5 w-3.5 group-hover:opacity-100" />
      <span className="font-mono text-[10px] tracking-widest uppercase">{label}</span>
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
