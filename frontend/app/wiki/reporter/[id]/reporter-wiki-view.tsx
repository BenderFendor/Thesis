"use client";

import type { ReactNode } from 'react';
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
import { fetchWikiReporter, parseReporterCareerTimeline } from '@/lib/api';
import type { WikiReporterDossier } from '@/lib/api';
import { GlobalNavigation } from "@/components/global-navigation";
import { CareerTimeline } from "./career-timeline";

type ReporterActivity = NonNullable<WikiReporterDossier["activity_summary"]>;

function ReporterLoadingState() {
  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      <GlobalNavigation />
      <div className="flex-1 flex min-h-screen items-center justify-center relative z-10 custom-scrollbar">
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}

function ReporterNotFoundState({ message }:Readonly< { message: string }>) {
  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      <GlobalNavigation />
      <div className="flex-1 p-6 relative z-10 custom-scrollbar">
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
        <Link href="/wiki/reporters" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" />
          Back to reporter wiki
        </Link>
        <div className="mt-16 text-center text-red-400 font-mono text-sm">{message}</div>
      </div>
    </div>
  );
}

function ReporterDossierHeader({
  data,
  primaryOutlet,
}:Readonly< {
  data: WikiReporterDossier;
  primaryOutlet?: string;
}>) {
  return (
    <header className="mx-auto max-w-[1500px] px-4 pt-6">
      <Link href="/wiki/reporters" className="inline-flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="h-3 w-3" />
        Reporter wiki
      </Link>
      <div className="mt-4 border-l-2 border-primary/60 pl-5">
        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
          Reporter dossier
        </div>
        <h1 className="mt-1 font-serif text-4xl leading-tight sm:text-5xl">{data.canonical_name || data.name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          {primaryOutlet ? <span className="font-serif text-foreground/90">{primaryOutlet}</span> : null}
          {data.research_confidence ? (
            <>
              {primaryOutlet ? <span aria-hidden="true">·</span> : null}
              <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">{data.research_confidence} confidence</Badge>
            </>
          ) : null}
          {data.match_status ? <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">{data.match_status}</Badge> : null}
          {data.political_leaning ? <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">{data.political_leaning}</Badge> : null}
        </div>
      </div>
    </header>
  );
}

function QuickFactsCard({
  data,
  activity,
}:Readonly< {
  data: WikiReporterDossier;
  activity?: ReporterActivity;
}>) {
  return (
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
  );
}

function OutletsCard({ outlets }:Readonly< { outlets?: ReporterActivity["outlets"] }>) {
  return (
    <SidebarCard title="Outlets In Corpus">
      {outlets?.length ? (
        <div className="space-y-2">
          {outlets.map((outlet) => (
            <Link
              key={outlet.name}
              href={`/wiki/source/${encodeURIComponent(outlet.name)}`}
              className="group flex items-center justify-between rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg hover:border-white/10"
            >
              <span className="truncate font-serif group-hover:text-white transition-colors">{outlet.name}</span>
              <span className="text-[10px] font-mono tracking-widest text-muted-foreground transition-opacity group-hover:opacity-100">{outlet.article_count}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">No outlet activity captured in the local corpus.</p>
      )}
    </SidebarCard>
  );
}

function AuthorPagesCard({ authorPages }:Readonly< { authorPages?: ReporterActivity["author_pages"] }>) {
  return (
    <SidebarCard title="Author Pages">
      {authorPages?.length ? (
        <div className="space-y-2 text-sm">
          {authorPages.map((page, index) => (
            <a
              key={`${page.url}-${index}`}
              href={page.url}
              target="_blank"
              rel="noreferrer"
              className="group block rounded-xl border border-white/5 bg-black/20 px-3 py-2 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg hover:border-white/10"
            >
              <div className="font-serif group-hover:text-white transition-colors">{page.domain || "author page"}</div>
              <div className="mt-1 truncate text-[10px] font-mono tracking-widest text-muted-foreground transition-opacity group-hover:opacity-100">{page.url}</div>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">No official author pages extracted from recent articles yet.</p>
      )}
    </SidebarCard>
  );
}

function ExternalProfilesCard({
  externalProfiles,
  wikidataUrl,
  wikipediaUrl,
}:Readonly< {
  externalProfiles?: ReporterActivity["external_profiles"];
  wikidataUrl?: string;
  wikipediaUrl?: string;
}>) {
  return (
    <SidebarCard title="External Profiles">
      <div className="space-y-2 text-sm">
        {externalProfiles?.map((profile, index) => (
          <a key={`${profile.url}-${index}`} href={profile.url} target="_blank" rel="noreferrer" className="group flex items-center gap-2 text-muted-foreground transition-colors hover:text-white">
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="truncate font-serif">{profile.domain || profile.url}</span>
          </a>
        ))}
        {wikidataUrl && (
          <a href={wikidataUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-2 text-muted-foreground transition-colors hover:text-white">
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="font-serif">Wikidata</span>
          </a>
        )}
        {wikipediaUrl && (
          <a href={wikipediaUrl} target="_blank" rel="noreferrer" className="group flex items-center gap-2 text-muted-foreground transition-colors hover:text-white">
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="font-serif">Wikipedia fallback</span>
          </a>
        )}
      </div>
    </SidebarCard>
  );
}

function BeatsCard({ categories }:Readonly< { categories: ReporterActivity["categories"] }>) {
  return (
    <SidebarCard title="Beats In Corpus">
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <Badge key={category.name} variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
            {category.name} {category.article_count}
          </Badge>
        ))}
      </div>
    </SidebarCard>
  );
}

function OverviewPanel({ data }:Readonly< { data: WikiReporterDossier }>) {
  return (
    <Panel title="Overview" eyebrow="Deterministic identity and corpus view">
      <div className="rounded-2xl border border-white/10 bg-black/25 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
        <p className="text-base leading-8 text-foreground/90">
          {data.overview || data.bio || "No verified overview available yet."}
        </p>
        <div className="mt-4 border-t border-white/5 pt-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Match method
          </div>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            {data.match_explanation || "Matched from public identity records and local article evidence."}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function PublicRecordPanel({ sections }:Readonly< { sections: WikiReporterDossier["dossier_sections"] }>) {
  return (
    <Panel title="Public Record" eyebrow="Identity and external reference evidence">
      <div className="space-y-2">
        {sections.map((section) =>
          section.items.length > 0 ? (
            <div key={section.id} className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                {section.title}
              </div>
              <div className="mt-3 space-y-3">
                {section.items.slice(0, 6).map((item, index) => (
                  <div key={`${section.id}-${index}`}>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{item.label || "Record"}</div>
                    <div className="mt-1 text-sm leading-6 text-foreground/90">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p key={section.id} className="px-1 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
              {section.title}: no public record found.
            </p>
          ),
        )}
      </div>
    </Panel>
  );
}

function BackgroundPanel({ data }:Readonly< { data: WikiReporterDossier }>) {
  return (
    <Panel title="Background" eyebrow="Stored employment and education records">
      <div className="grid gap-4 lg:grid-cols-2">
        {data.career_history?.length ? (
          <div className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium font-serif">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              Career history
            </div>
            <div className="space-y-3">
              {data.career_history.map((entry, index) => (
                <div key={`${entry.organization || "career"}-${index}`} className="border-l border-white/10 pl-3">
                  <div className="text-sm font-serif">{entry.role || "Reporter"}</div>
                  {entry.organization ? <div className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground mt-1">{entry.organization}</div> : null}
                  {entry.source ? <div className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground mt-0.5">Source: {entry.source}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 px-1 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" /> No career entries stored.
          </p>
        )}

        {data.education?.length ? (
          <div className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium font-serif">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Education
            </div>
            <div className="space-y-3">
              {data.education.map((entry, index) => (
                <div key={`education-${index}`} className="text-sm text-foreground/90">
                  {Object.values(entry).filter(Boolean).join(" · ")}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 px-1 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> No education entries stored.
          </p>
        )}
      </div>
    </Panel>
  );
}

function CorpusActivityPanel({ activity }:Readonly< { activity: ReporterActivity }>) {
  return (
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
  );
}

function RecentArticlesPanel({ articles }:Readonly< { articles: WikiReporterDossier["recent_articles"] }>) {
  return (
    <Panel title="Recent Articles" eyebrow="Latest work in the local corpus">
      <div className="space-y-3">
        {articles.map((article, index) => (
          <a
            key={`${article.id || article.url}-${index}`}
            href={article.url || "#"}
            target="_blank"
            rel="noreferrer"
            className="group flex items-start justify-between gap-3 rounded-2xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg hover:border-white/10"
          >
            <div className="min-w-0">
              <div className="text-base font-serif group-hover:text-primary transition-colors">{article.title}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
                {article.source ? <span className="group-hover:opacity-100 transition-opacity">{article.source}</span> : null}
                {article.category ? <span className="group-hover:opacity-100 transition-opacity">{article.category}</span> : null}
                {article.published_at ? (
                  <span className="group-hover:opacity-100 transition-opacity">{new Date(article.published_at).toLocaleDateString()}</span>
                ) : null}
              </div>
            </div>
            <Newspaper className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
          </a>
        ))}
      </div>
    </Panel>
  );
}

function CitationsPanel({ citations }:Readonly< { citations: WikiReporterDossier["citations"] }>) {
  return (
    <Panel title="Citations" eyebrow="Public references used for this page">
      <div className="space-y-2 rounded-2xl border border-white/5 bg-black/20 p-5 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
        {citations.map((citation, index) => (
          <div key={`${citation.label}-${index}`}>
            {citation.url ? (
              <a href={citation.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-white transition-colors">
                {citation.label}
              </a>
            ) : (
              <span className="text-muted-foreground">{citation.label}</span>
            )}
            {citation.note ? <span className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground ml-2">{citation.note}</span> : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ReporterDossierSidebar({
  data,
  activity,
}: Readonly<{ data: WikiReporterDossier; activity?: ReporterActivity }>) {
  return (
    <aside className="rounded-2xl border bg-black/40 backdrop-blur-2xl border-white/10 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] ring-1 ring-white/5 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto custom-scrollbar">
      <QuickFactsCard data={data} activity={activity} />
      <OutletsCard outlets={activity?.outlets} />
      <AuthorPagesCard authorPages={activity?.author_pages} />
      <ExternalProfilesCard
        externalProfiles={activity?.external_profiles}
        wikidataUrl={data.wikidata_url}
        wikipediaUrl={data.wikipedia_url}
      />
      {activity?.categories?.length ? <BeatsCard categories={activity.categories} /> : null}
    </aside>
  );
}

function ReporterDossierPanels({
  data,
  activity,
  careerTimeline,
}: Readonly<{
  data: WikiReporterDossier;
  activity?: ReporterActivity;
  careerTimeline: ReturnType<typeof parseReporterCareerTimeline>;
}>) {
  return (
    <section className="space-y-5">
      <OverviewPanel data={data} />
      <PublicRecordPanel sections={data.dossier_sections} />
      {data.career_history?.length || data.education?.length ? <BackgroundPanel data={data} /> : null}
      {careerTimeline && careerTimeline.timeline.length > 0 ? (
        <Panel title="Career Timeline" eyebrow="Bylines and affiliations, merged chronologically">
          <CareerTimeline data={careerTimeline} />
        </Panel>
      ) : null}
      {activity ? <CorpusActivityPanel activity={activity} /> : null}
      {data.recent_articles.length > 0 ? (
        <RecentArticlesPanel articles={data.recent_articles} />
      ) : null}
      {data.citations.length > 0 ? <CitationsPanel citations={data.citations} /> : null}
    </section>
  );
}

export function ReporterWikiView({ reporterId }:Readonly< { reporterId: number }>) {
  const { data, isLoading, error } = useQuery<WikiReporterDossier>({
    enabled: Number.isFinite(reporterId),
    queryFn: () => fetchWikiReporter(reporterId),
    queryKey: ["wiki-reporter", reporterId],
    retry: 1,
  });

  if (isLoading) {
    return <ReporterLoadingState />;
  }

  if (error || !data) {
    const message = error instanceof Error ? error.message : "Reporter not found";
    return <ReporterNotFoundState message={message} />;
  }

  const activity = data.activity_summary,
   careerTimeline = parseReporterCareerTimeline(data.career_timeline),
   primaryOutlet = activity?.outlets?.[0]?.name;

  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      <GlobalNavigation />
      <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar">
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />

        <ReporterDossierHeader data={data} primaryOutlet={primaryOutlet} />

        <main className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <ReporterDossierSidebar data={data} activity={activity} />
          <ReporterDossierPanels
            data={data}
            activity={activity}
            careerTimeline={careerTimeline}
          />
        </main>
      </div>
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
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{eyebrow}</div>
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
    <div className="mt-4 rounded-2xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg">
      <div className="mb-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function SidebarFact({ label, value }:Readonly< { label: string; value: string }>) {
  return (
    <div className="flex items-start justify-between gap-3 text-[10px] font-mono tracking-widest uppercase mt-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function ActivityList({ title, items }:Readonly< { title: string; items: string[] }>) {
  return (
    <div className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
      <div className="mb-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{title}</div>
      {items.length > 0 ? (
        <div className="space-y-2 text-[10px] font-mono tracking-widest uppercase">
          {items.map((item) => (
            <div key={item} className="rounded-xl border border-white/5 bg-black/20 px-3 py-2 transition-colors hover:bg-white/5 hover:border-white/10">
              {item}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">No activity recorded.</p>
      )}
    </div>
  );
}
