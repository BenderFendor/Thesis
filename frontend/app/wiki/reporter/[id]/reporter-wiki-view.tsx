"use client";
import { hasText } from "@/lib/utils";

import { ChevronLeft, ExternalLink, FileText, Loader2, Newspaper, UserRound } from "lucide-react";
import { Panel, SidebarCard, SidebarFact } from "@/features/wiki/ui/wiki-primitives";
import { fetchWikiReporter, parseReporterCareerTimeline } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { CareerTimeline } from "./career-timeline";
import { GlobalNavigation } from "@/components/global-navigation";
import Link from "next/link";
import { WikiCitationPanel } from "@/features/wiki/ui/wiki-citation-panel";
import type { WikiReporterDossier } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { formatArticleDate } from "@/lib/date-formatters";
import { useQuery } from "@tanstack/react-query";

type ReadonlyReporterDossier = DeepReadonly<WikiReporterDossier>;
type ReporterActivity = DeepReadonly<NonNullable<WikiReporterDossier["activity_summary"]>>;
type EducationEntry = NonNullable<ReadonlyReporterDossier["education"]>[number];
type CountedActivity = ReporterActivity["outlets"][number] | ReporterActivity["categories"][number];

const ReporterLoadingState = () => (
  <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
    <GlobalNavigation />
    <div className="flex-1 flex min-h-screen items-center justify-center relative z-10 custom-scrollbar">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  </div>
);

const ReporterNotFoundState = ({ message }: Readonly<{ message: string }>) => (
  <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
    <GlobalNavigation />
    <div className="flex-1 p-6 relative z-10 custom-scrollbar">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
      <Link
        href="/wiki/reporters"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to reporter wiki
      </Link>
      <div className="mt-16 text-center text-red-400 font-mono text-sm">{message}</div>
    </div>
  </div>
);

const ReporterDossierHeader = ({
  data,
  primaryOutlet,
}: Readonly<{
  data: ReadonlyReporterDossier;
  primaryOutlet?: string;
}>) => {
  const researchConfidence = data.research_confidence;
  const matchStatus = data.match_status;
  const politicalLeaning = data.political_leaning;

  return (
    <header className="mx-auto max-w-[1500px] px-4 pt-6">
    <Link
      href="/wiki/reporters"
      className="inline-flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
    >
      <ChevronLeft className="h-3 w-3" />
      Reporter wiki
    </Link>
    <div className="mt-4 border-l-2 border-primary/60 pl-5">
      <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
        Reporter dossier
      </div>
      <h1 className="mt-1 font-serif text-4xl leading-tight sm:text-5xl">
        {data.canonical_name ?? data.name}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
        {primaryOutlet !== undefined && primaryOutlet !== "" && <span className="font-serif text-foreground/90">{primaryOutlet}</span>}
        {researchConfidence !== undefined && researchConfidence !== null && researchConfidence !== "" && <>
            {(() => {
  if (hasText(primaryOutlet)) {
    return <span aria-hidden="true">·</span>;
  }
  return null;
})()}
            <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
              {researchConfidence} confidence
            </Badge>
          </>}
        {matchStatus !== undefined && matchStatus !== null && <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
            {matchStatus}
          </Badge>}
        {politicalLeaning !== undefined && politicalLeaning !== null && politicalLeaning !== "" && <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
            {politicalLeaning}
          </Badge>}
      </div>
    </div>
    </header>
  );
};

const QuickFactsCard = ({
  data,
  activity,
}: Readonly<{
  data: ReadonlyReporterDossier;
  activity?: ReporterActivity;
}>) => (
  <SidebarCard title="Quick Facts">
    <SidebarFact label="Articles" value={String(data.article_count)} />
    {activity !== undefined && activity.source_count !== undefined && activity.source_count !== null && activity.source_count !== 0 && <SidebarFact label="Outlets" value={String(activity.source_count)} />}
    {activity !== undefined && activity.latest_article_at !== undefined && activity.latest_article_at !== null && activity.latest_article_at !== "" && <SidebarFact label="Latest article" value={formatArticleDate(activity.latest_article_at)} />}
    {activity !== undefined && activity.active_since !== undefined && activity.active_since !== null && activity.active_since !== "" && <SidebarFact label="Active in corpus since" value={formatArticleDate(activity.active_since)} />}
  </SidebarCard>
);

const OutletsCard = ({ outlets }: Readonly<{ outlets?: ReporterActivity["outlets"] }>) => (
  <SidebarCard title="Outlets In Corpus">
    {(() => {
  if ((outlets?.length ?? 0) > 0) {
    return <div className="space-y-2">
        {outlets?.map(outlet => <Link key={outlet.name} href={`/wiki/source/${encodeURIComponent(outlet.name)}`} className="group flex items-center justify-between rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg hover:border-white/10">
            <span className="truncate font-serif group-hover:text-white transition-colors">
              {outlet.name}
            </span>
            <span className="text-[10px] font-mono tracking-widest text-muted-foreground transition-opacity group-hover:opacity-100">
              {outlet.article_count}
            </span>
          </Link>)}
      </div>;
  }
  return <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        No outlet activity captured in the local corpus.
      </p>;
})()}
  </SidebarCard>
);

const AuthorPagesCard = ({
  authorPages,
}: Readonly<{ authorPages?: ReporterActivity["author_pages"] }>) => (
  <SidebarCard title="Author Pages">
    {(() => {
  if ((authorPages?.length ?? 0) > 0) {
    return <div className="space-y-2 text-sm">
        {authorPages?.map(page => <a key={`${page.domain ?? "author"}-${page.url}`} href={page.url} target="_blank" rel="noreferrer" className="group block rounded-xl border border-white/5 bg-black/20 px-3 py-2 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg hover:border-white/10">
            <div className="font-serif group-hover:text-white transition-colors">
              {page.domain ?? "author page"}
            </div>
            <div className="mt-1 truncate text-[10px] font-mono tracking-widest text-muted-foreground transition-opacity group-hover:opacity-100">
              {page.url}
            </div>
          </a>)}
      </div>;
  }
  return <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        No official author pages extracted from recent articles yet.
      </p>;
})()}
  </SidebarCard>
);

const ExternalProfilesCard = ({
  externalProfiles,
  wikidataUrl,
  wikipediaUrl,
}: Readonly<{
  externalProfiles?: ReporterActivity["external_profiles"];
  wikidataUrl?: string;
  wikipediaUrl?: string;
}>) => (
  <SidebarCard title="External Profiles">
    <div className="space-y-2 text-sm">
      {externalProfiles?.map((profile) => (
        <a
          key={`${profile.domain ?? "profile"}-${profile.url}`}
          href={profile.url}
          target="_blank"
          rel="noreferrer"
          className="group flex items-center gap-2 text-muted-foreground transition-colors hover:text-white"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="truncate font-serif">{profile.domain ?? profile.url}</span>
        </a>
      ))}
      {hasText(wikidataUrl) && (
        <a
          href={wikidataUrl}
          target="_blank"
          rel="noreferrer"
          className="group flex items-center gap-2 text-muted-foreground transition-colors hover:text-white"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="font-serif">Wikidata</span>
        </a>
      )}
      {hasText(wikipediaUrl) && (
        <a
          href={wikipediaUrl}
          target="_blank"
          rel="noreferrer"
          className="group flex items-center gap-2 text-muted-foreground transition-colors hover:text-white"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="font-serif">Wikipedia fallback</span>
        </a>
      )}
    </div>
  </SidebarCard>
);

const BeatsCard = ({ categories }: Readonly<{ categories: ReporterActivity["categories"] }>) => (
  <SidebarCard title="Beats In Corpus">
    <div className="flex flex-wrap gap-2">
      {categories.map((category) => (
        <Badge
          key={category.name}
          variant="outline"
          className="text-[10px] font-mono tracking-widest uppercase"
        >
          {category.name} {category.article_count}
        </Badge>
      ))}
    </div>
  </SidebarCard>
);

const OverviewPanel = ({ data }: Readonly<{ data: ReadonlyReporterDossier }>) => (
  <Panel title="Overview" eyebrow="Deterministic identity and corpus view">
    <div className="rounded-2xl border border-white/10 bg-black/25 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
      <p className="text-base leading-8 text-foreground/90">
        {(data.overview ?? data.bio) ?? "No verified overview available yet."}
      </p>
      <div className="mt-4 border-t border-white/5 pt-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Match method
        </div>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          {data.match_explanation ??
            "Matched from public identity records and local article evidence."}
        </p>
      </div>
    </div>
  </Panel>
);

const PublicRecordPanel = ({
  sections,
}: Readonly<{ sections: ReadonlyReporterDossier["dossier_sections"] }>) => (
  <Panel title="Public Record" eyebrow="Identity and external reference evidence">
    <div className="space-y-2">
      {sections.map((section) =>
        (() => {
  if (section.items.length > 0) {
    return <div key={section.id} className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              {section.title}
            </div>
            <div className="mt-3 space-y-3">
              {section.items.slice(0, 6).map(item => <div key={`${section.id}-${item.label ?? "record"}-${item.value ?? ""}`}>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    {item.label ?? "Record"}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-foreground/90">{item.value}</div>
                </div>)}
            </div>
          </div>;
  }
  return <p key={section.id} className="px-1 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
            {section.title}: no public record found.
          </p>;
})(),
      )}
    </div>
  </Panel>
);

const BackgroundPanel = ({ data }: Readonly<{ data: ReadonlyReporterDossier }>) => (
  <Panel title="Background" eyebrow="Stored employment and education records">
    <div className="grid gap-4 lg:grid-cols-2">
      {(() => {
  if ((data.career_history?.length ?? 0) > 0) {
    return <div className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium font-serif">
            <UserRound className="h-4 w-4 text-muted-foreground" />
            Career history
          </div>
          <div className="space-y-3">
            {data.career_history?.map(entry => <div key={`${entry.organization ?? "career"}-${entry.role ?? "reporter"}-${entry.source ?? ""}`} className="border-l border-white/10 pl-3">
                <div className="text-sm font-serif">{entry.role ?? "Reporter"}</div>
                {(() => {
            if (hasText(entry.organization)) {
              return <div className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground mt-1">
                    {entry.organization}
                  </div>;
            }
            return null;
          })()}
                {(() => {
            if (hasText(entry.source)) {
              return <div className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground mt-0.5">
                    Source: {entry.source}
                  </div>;
            }
            return null;
          })()}
              </div>)}
          </div>
        </div>;
  }
  return <p className="flex items-center gap-2 px-1 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" /> No career entries stored.
        </p>;
})()}

      {(() => {
  if ((data.education?.length ?? 0) > 0) {
    return <div className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium font-serif">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Education
          </div>
          <div className="space-y-3">
            {data.education?.map(entry => <div key={JSON.stringify(entry) ?? "education"} className="text-sm text-foreground/90">
                {formatEducationEntry(entry)}
              </div>)}
          </div>
        </div>;
  }
  return <p className="flex items-center gap-2 px-1 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
          <FileText className="h-3.5 w-3.5" /> No education entries stored.
        </p>;
})()}
    </div>
  </Panel>
);

const CorpusActivityPanel = ({ activity }: Readonly<{ activity: ReporterActivity }>) => (
  <Panel title="Corpus Activity" eyebrow="Signals derived from your own article database">
    <div className="grid gap-4 lg:grid-cols-3">
      <ActivityList
        title="Outlets"
        items={formatCountedActivity(activity.outlets)}
      />
      <ActivityList
        title="Categories"
        items={formatCountedActivity(activity.categories)}
      />
      <ActivityList
        title="Domains"
        items={formatDomainActivity(activity.domains)}
      />
    </div>
  </Panel>
);

const RecentArticlesPanel = ({
  articles,
}: Readonly<{ articles: ReadonlyReporterDossier["recent_articles"] }>) => (
  <Panel title="Recent Articles" eyebrow="Latest work in the local corpus">
    <div className="space-y-3">
      {articles.map((article) => (
        <a
          key={article.id ?? article.url}
          href={article.url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="group flex items-start justify-between gap-3 rounded-2xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg hover:border-white/10"
        >
          <div className="min-w-0">
            <div className="text-base font-serif group-hover:text-primary transition-colors">
              {article.title}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
              {Boolean(article.source) && <span className="group-hover:opacity-100 transition-opacity">{article.source}</span>}
              {Boolean(article.category) && <span className="group-hover:opacity-100 transition-opacity">
                  {article.category}
                </span>}
              {Boolean(article.published_at) && <span className="group-hover:opacity-100 transition-opacity">
                  {formatArticleDate(article.published_at)}
                </span>}
            </div>
          </div>
          <Newspaper className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
        </a>
      ))}
    </div>
  </Panel>
);

const ReporterDossierSidebar = ({
  data,
  activity,
}: Readonly<{ data: ReadonlyReporterDossier; activity?: ReporterActivity }>) => (
  <aside className="rounded-2xl border bg-black/40 backdrop-blur-2xl border-white/10 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] ring-1 ring-white/5 lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto custom-scrollbar">
    <QuickFactsCard data={data} activity={activity} />
    <OutletsCard outlets={activity?.outlets} />
    <AuthorPagesCard authorPages={activity?.author_pages} />
    <ExternalProfilesCard
      externalProfiles={activity?.external_profiles}
      wikidataUrl={data.wikidata_url}
      wikipediaUrl={data.wikipedia_url}
    />
    {activity !== undefined && activity.categories.length > 0 && <BeatsCard categories={activity.categories} />}
  </aside>
);

const ReporterDossierPanels = ({
  data,
  activity,
  careerTimeline,
}: Readonly<{
  data: ReadonlyReporterDossier;
  activity?: ReporterActivity;
  careerTimeline: ReturnType<typeof parseReporterCareerTimeline>;
}>) => (
  <section className="space-y-5">
    <OverviewPanel data={data} />
    <PublicRecordPanel sections={data.dossier_sections} />
    {((data.career_history?.length ?? 0) > 0 || (data.education?.length ?? 0) > 0) && <BackgroundPanel data={data} />}
    {careerTimeline !== null && careerTimeline !== undefined && careerTimeline.timeline.length > 0 && <Panel title="Career Timeline" eyebrow="Bylines and affiliations, merged chronologically">
        <CareerTimeline data={careerTimeline} />
      </Panel>}
    {activity !== undefined && <CorpusActivityPanel activity={activity} />}
    {data.recent_articles.length > 0 && <RecentArticlesPanel articles={data.recent_articles} />}
    {data.citations.length > 0 && <WikiCitationPanel citations={data.citations} />}
  </section>
);

const ReporterWikiView = ({ reporterId }: Readonly<{ reporterId: number }>) => {
  const { data, isLoading, error } = useQuery<ReadonlyReporterDossier>({
    enabled: Number.isFinite(reporterId),
    queryFn: () => fetchWikiReporter(reporterId),
    queryKey: ["wiki-reporter", reporterId],
    retry: 1,
  });

  if (isLoading) {
    return <ReporterLoadingState />;
  }

  if (error || !data) {
    const message = (() => {
  if (error instanceof Error) {
    return error.message;
  }
  return "Reporter not found";
})();
    return <ReporterNotFoundState message={message} />;
  }

  const activity = data.activity_summary,
    careerTimeline = parseReporterCareerTimeline(data.career_timeline ?? null),
    primaryOutlet = activity?.outlets?.[0]?.name;

  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      <GlobalNavigation />
      <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar">
        <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />

        <ReporterDossierHeader data={data} primaryOutlet={primaryOutlet} />

        <main className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <ReporterDossierSidebar data={data} activity={activity} />
          <ReporterDossierPanels data={data} activity={activity} careerTimeline={careerTimeline} />
        </main>
      </div>
    </div>
  );
};

const isStringValue = (value: EducationEntry[keyof EducationEntry]): value is string =>
  Object.prototype.toString.call(value) === "[object String]";

const formatEducationValue = (value: EducationEntry[keyof EducationEntry]): string => {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (isStringValue(value)) {
    return value;
  }
  return JSON.stringify(value) ?? "";
};

const formatEducationEntry = (entry: EducationEntry): string =>
  Object.values(entry)
    .map((value) => formatEducationValue(value))
    .filter(Boolean)
    .join(" · ");

const formatCountedActivity = (items: readonly CountedActivity[]): readonly string[] =>
  items.map((item) => `${item.name} · ${item.article_count}`);

const formatDomainActivity = (
  items: ReporterActivity["domains"],
): readonly string[] => items.map((item) => `${item.domain} · ${item.article_count}`);

const ActivityList = ({ title, items }: Readonly<{ title: string; items: readonly string[] }>) => (
  <div className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
    <div className="mb-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      {title}
    </div>
    {(() => {
  if (items.length > 0) {
    return <div className="space-y-2 text-[10px] font-mono tracking-widest uppercase">
        {items.map(item => <div key={item} className="rounded-xl border border-white/5 bg-black/20 px-3 py-2 transition-colors hover:bg-white/5 hover:border-white/10">
            {item}
          </div>)}
      </div>;
  }
  return <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        No activity recorded.
      </p>;
})()}
  </div>
);
export { ReporterWikiView };
