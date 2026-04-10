"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ExternalLink,
  FileText,
  Loader2,
  Newspaper,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchWikiReporter, type WikiReporterDossier } from "@/lib/api";

export function ReporterWikiView({ reporterId }: { reporterId: number }) {
  const { data, isLoading, error } = useQuery<WikiReporterDossier>({
    queryKey: ["wiki-reporter", reporterId],
    queryFn: () => fetchWikiReporter(reporterId),
    enabled: Number.isFinite(reporterId),
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--news-bg-primary)]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    const message = error instanceof Error ? error.message : "Reporter not found";
    return (
      <div className="min-h-screen bg-[var(--news-bg-primary)] p-6 text-foreground">
        <Link href="/wiki/reporters" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Back to reporter wiki
        </Link>
        <div className="mt-16 text-center text-red-400">{message}</div>
      </div>
    );
  }

  const activity = data.activity_summary;

  return (
    <div className="min-h-screen bg-[var(--news-bg-primary)] text-foreground">
      <main className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-white/10 bg-[#0d1118] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.25)] lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <Link href="/wiki/reporters" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Reporter wiki
          </Link>

          <div className="mt-5">
            <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Reporter
            </div>
            <h1 className="mt-1 font-serif text-2xl">{data.canonical_name || data.name}</h1>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.match_status && <Badge variant="outline">{data.match_status}</Badge>}
              {data.political_leaning && <Badge variant="outline">{data.political_leaning}</Badge>}
              {data.research_confidence && <Badge variant="outline">{data.research_confidence}</Badge>}
            </div>
          </div>

          <SidebarCard title="Quick Facts">
            <SidebarFact label="Articles" value={String(data.article_count)} />
            {activity?.source_count ? <SidebarFact label="Outlets" value={String(activity.source_count)} /> : null}
            {activity?.latest_article_at ? (
              <SidebarFact
                label="Latest article"
                value={new Date(activity.latest_article_at).toLocaleDateString()}
              />
            ) : null}
            {activity?.active_since ? (
              <SidebarFact
                label="Active in corpus since"
                value={new Date(activity.active_since).toLocaleDateString()}
              />
            ) : null}
          </SidebarCard>

          <SidebarCard title="Outlets In Corpus">
            {activity?.outlets?.length ? (
              <div className="space-y-2">
                {activity.outlets.map((outlet) => (
                  <Link
                    key={outlet.name}
                    href={`/wiki/source/${encodeURIComponent(outlet.name)}`}
                    className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-sm transition-colors hover:border-white/20 hover:bg-white/5"
                  >
                    <span className="truncate">{outlet.name}</span>
                    <span className="text-[11px] text-muted-foreground">{outlet.article_count}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No outlet activity captured in the local corpus.</p>
            )}
          </SidebarCard>

          <SidebarCard title="Author Pages">
            {activity?.author_pages?.length ? (
              <div className="space-y-2 text-sm">
                {activity.author_pages.map((page) => (
                  <a
                    key={page.url}
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border border-white/10 px-3 py-2 transition-colors hover:border-white/20 hover:bg-white/5"
                  >
                    <div>{page.domain || "author page"}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{page.url}</div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No official author pages extracted from recent articles yet.</p>
            )}
          </SidebarCard>

          <SidebarCard title="External Profiles">
            <div className="space-y-2 text-sm">
              {activity?.external_profiles?.map((profile) => (
                <a key={profile.url} href={profile.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[#b8d7ff] hover:text-white">
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="truncate">{profile.domain || profile.url}</span>
                </a>
              ))}
              {data.wikidata_url && (
                <a href={data.wikidata_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[#b8d7ff] hover:text-white">
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Wikidata</span>
                </a>
              )}
              {data.wikipedia_url && (
                <a href={data.wikipedia_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[#b8d7ff] hover:text-white">
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Wikipedia fallback</span>
                </a>
              )}
            </div>
          </SidebarCard>

          {activity?.categories?.length ? (
            <SidebarCard title="Beats In Corpus">
              <div className="flex flex-wrap gap-2">
                {activity.categories.map((category) => (
                  <Badge key={category.name} variant="outline">
                    {category.name} {category.article_count}
                  </Badge>
                ))}
              </div>
            </SidebarCard>
          ) : null}
        </aside>

        <section className="space-y-5">
          <Panel title="Overview" eyebrow="Deterministic identity and corpus view">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#0d1118] p-5">
                <p className="text-sm leading-7 text-foreground/90">
                  {data.overview || data.bio || "No verified overview available yet."}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0d1118] p-5">
                <div className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                  Match method
                </div>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  {data.match_explanation || "Matched from public identity records and local article evidence."}
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Public Record" eyebrow="Identity and external reference evidence">
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

          {(data.career_history?.length || data.education?.length) && (
            <Panel title="Background" eyebrow="Stored employment and education records">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-[#0d1118] p-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <UserRound className="h-4 w-4 text-muted-foreground" />
                    Career history
                  </div>
                  {data.career_history?.length ? (
                    <div className="space-y-3">
                      {data.career_history.map((entry, index) => (
                        <div key={`${entry.organization || "career"}-${index}`} className="border-l border-white/10 pl-3">
                          <div className="text-sm">{entry.role || "Reporter"}</div>
                          {entry.organization ? <div className="text-xs text-muted-foreground">{entry.organization}</div> : null}
                          {entry.source ? <div className="text-[11px] text-muted-foreground">Source: {entry.source}</div> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No career entries stored.</p>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#0d1118] p-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    Education
                  </div>
                  {data.education?.length ? (
                    <div className="space-y-3">
                      {data.education.map((entry, index) => (
                        <div key={`education-${index}`} className="text-sm text-foreground/90">
                          {Object.values(entry).filter(Boolean).join(" · ")}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No education entries stored.</p>
                  )}
                </div>
              </div>
            </Panel>
          )}

          {activity && (
            <Panel title="Corpus Activity" eyebrow="Signals derived from your own article database">
              <div className="grid gap-4 lg:grid-cols-3">
                <ActivityList
                  title="Outlets"
                  items={activity.outlets.map((item) => `${item.name} · ${item.article_count}`)}
                />
                <ActivityList
                  title="Categories"
                  items={activity.categories.map((item) => `${item.name} · ${item.article_count}`)}
                />
                <ActivityList
                  title="Domains"
                  items={activity.domains.map((item) => `${item.domain} · ${item.article_count}`)}
                />
              </div>
            </Panel>
          )}

          {data.recent_articles.length > 0 && (
            <Panel title="Recent Articles" eyebrow="Latest work in the local corpus">
              <div className="space-y-3">
                {data.recent_articles.map((article, index) => (
                  <a
                    key={`${article.id || article.url}-${index}`}
                    href={article.url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-[#0d1118] p-4 transition-colors hover:border-white/20 hover:bg-white/5"
                  >
                    <div className="min-w-0">
                      <div className="text-base">{article.title}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {article.source ? <span>{article.source}</span> : null}
                        {article.category ? <span>{article.category}</span> : null}
                        {article.published_at ? (
                          <span>{new Date(article.published_at).toLocaleDateString()}</span>
                        ) : null}
                      </div>
                    </div>
                    <Newspaper className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
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

function ActivityList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d1118] p-5">
      <div className="mb-3 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      {items.length ? (
        <div className="space-y-2 text-sm">
          {items.map((item) => (
            <div key={item} className="rounded-xl border border-white/10 px-3 py-2">
              {item}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No activity recorded.</p>
      )}
    </div>
  );
}
