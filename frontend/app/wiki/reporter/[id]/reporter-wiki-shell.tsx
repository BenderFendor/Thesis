"use client";

import { hasText } from "@/lib/utils";
import { ChevronLeft, ExternalLink, Loader2 } from "lucide-react";
import { SidebarCard, SidebarFact } from "@/features/wiki/ui/wiki-primitives";
import { Badge } from "@/components/ui/badge";
import { GlobalNavigation } from "@/components/global-navigation";
import Link from "next/link";
import { formatArticleDate } from "@/lib/date-formatters";
import type { ReadonlyReporterDossier, ReporterActivity } from "./reporter-wiki-types";

const ReporterBackground = () => (
  <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
);

const ReporterLoadingMain = () => (
  <div className="flex-1 flex min-h-screen items-center justify-center relative z-10 custom-scrollbar">
    <ReporterBackground />
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const ReporterLoadingState = () => (
  <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
    <GlobalNavigation />
    <ReporterLoadingMain />
  </div>
);

const ReporterBackLink = ({ className }: Readonly<{ className: string }>) => (
  <Link href="/wiki/reporters" className={className}>
    <ChevronLeft className="h-4 w-4" />
    Back to reporter wiki
  </Link>
);

const ReporterNotFoundMain = ({ message }: Readonly<{ message: string }>) => (
  <div className="flex-1 p-6 relative z-10 custom-scrollbar">
    <ReporterBackground />
    <ReporterBackLink className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors" />
    <div className="mt-16 text-center text-red-400 font-mono text-sm">{message}</div>
  </div>
);

const ReporterNotFoundState = ({ message }: Readonly<{ message: string }>) => (
  <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
    <GlobalNavigation />
    <ReporterNotFoundMain message={message} />
  </div>
);

const ReporterConfidenceBadge = ({
  confidence,
  hasOutlet,
}: Readonly<{ confidence: string; hasOutlet: boolean }>) => (
  <>
    {hasOutlet && <span aria-hidden="true">·</span>}
    <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
      {confidence} confidence
    </Badge>
  </>
);

const ReporterHeaderBadges = ({
  primaryOutlet,
  researchConfidence,
  matchStatus,
  politicalLeaning,
}: Readonly<{
  primaryOutlet?: string;
  researchConfidence?: string | null;
  matchStatus?: string | null;
  politicalLeaning?: string | null;
}>) => (
  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
    {hasText(primaryOutlet) && (
      <span className="font-serif text-foreground/90">{primaryOutlet}</span>
    )}
    {hasText(researchConfidence) && (
      <ReporterConfidenceBadge confidence={researchConfidence} hasOutlet={hasText(primaryOutlet)} />
    )}
    {hasText(matchStatus) && (
      <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
        {matchStatus}
      </Badge>
    )}
    {hasText(politicalLeaning) && (
      <Badge variant="outline" className="text-[10px] font-mono tracking-widest uppercase">
        {politicalLeaning}
      </Badge>
    )}
  </div>
);

const ReporterHeaderContent = ({
  data,
  primaryOutlet,
}: Readonly<{ data: ReadonlyReporterDossier; primaryOutlet?: string }>) => (
  <div className="mt-4 border-l-2 border-primary/60 pl-5">
    <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-muted-foreground">
      Reporter dossier
    </div>
    <h1 className="mt-1 font-serif text-4xl leading-tight sm:text-5xl">
      {data.canonical_name ?? data.name}
    </h1>
    <ReporterHeaderBadges
      primaryOutlet={primaryOutlet}
      researchConfidence={data.research_confidence}
      matchStatus={data.match_status}
      politicalLeaning={data.political_leaning}
    />
  </div>
);

const ReporterDossierHeader = ({
  data,
  primaryOutlet,
}: Readonly<{
  data: ReadonlyReporterDossier;
  primaryOutlet?: string;
}>) => (
  <header className="mx-auto max-w-[1500px] px-4 pt-6">
    <ReporterBackLink className="inline-flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors" />
    <ReporterHeaderContent data={data} primaryOutlet={primaryOutlet} />
  </header>
);

const QuickFactsContent = ({
  data,
  activity,
}: Readonly<{
  data: ReadonlyReporterDossier;
  activity?: ReporterActivity;
}>) => (
  <>
    <SidebarFact label="Articles" value={String(data.article_count)} />
    {activity?.source_count !== undefined &&
      activity.source_count !== null &&
      activity.source_count !== 0 && (
        <SidebarFact label="Outlets" value={String(activity.source_count)} />
      )}
    {hasText(activity?.latest_article_at) && (
      <SidebarFact label="Latest article" value={formatArticleDate(activity.latest_article_at)} />
    )}
    {hasText(activity?.active_since) && (
      <SidebarFact
        label="Active in corpus since"
        value={formatArticleDate(activity.active_since)}
      />
    )}
  </>
);

const QuickFactsCard = ({
  data,
  activity,
}: Readonly<{
  data: ReadonlyReporterDossier;
  activity?: ReporterActivity;
}>) => (
  <SidebarCard title="Quick Facts">
    <QuickFactsContent data={data} activity={activity} />
  </SidebarCard>
);

const ReporterOutletLink = ({
  outlet,
}: Readonly<{ outlet: ReporterActivity["outlets"][number] }>) => (
  <Link
    href={`/wiki/source/${encodeURIComponent(outlet.name)}`}
    className="group flex items-center justify-between rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-sm transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg hover:border-white/10"
  >
    <span className="truncate font-serif group-hover:text-white transition-colors">
      {outlet.name}
    </span>
    <span className="text-[10px] font-mono tracking-widest text-muted-foreground transition-opacity group-hover:opacity-100">
      {outlet.article_count}
    </span>
  </Link>
);

const OutletsContent = ({ outlets }: Readonly<{ outlets?: ReporterActivity["outlets"] }>) => {
  if ((outlets?.length ?? 0) === 0) {
    return (
      <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        No outlet activity captured in the local corpus.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {outlets?.map((outlet) => (
        <ReporterOutletLink key={outlet.name} outlet={outlet} />
      ))}
    </div>
  );
};

const OutletsCard = ({ outlets }: Readonly<{ outlets?: ReporterActivity["outlets"] }>) => (
  <SidebarCard title="Outlets In Corpus">
    <OutletsContent outlets={outlets} />
  </SidebarCard>
);

const AuthorPageLink = ({ page }: Readonly<{ page: ReporterActivity["author_pages"][number] }>) => (
  <a
    href={page.url}
    target="_blank"
    rel="noreferrer"
    className="group block rounded-xl border border-white/5 bg-black/20 px-3 py-2 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg hover:border-white/10"
  >
    <div className="font-serif group-hover:text-white transition-colors">
      {page.domain ?? "author page"}
    </div>
    <div className="mt-1 truncate text-[10px] font-mono tracking-widest text-muted-foreground transition-opacity group-hover:opacity-100">
      {page.url}
    </div>
  </a>
);

const AuthorPagesContent = ({
  authorPages,
}: Readonly<{ authorPages?: ReporterActivity["author_pages"] }>) => {
  if ((authorPages?.length ?? 0) === 0) {
    return (
      <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        No official author pages extracted from recent articles yet.
      </p>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      {authorPages?.map((page) => (
        <AuthorPageLink key={`${page.domain ?? "author"}-${page.url}`} page={page} />
      ))}
    </div>
  );
};

const AuthorPagesCard = ({
  authorPages,
}: Readonly<{ authorPages?: ReporterActivity["author_pages"] }>) => (
  <SidebarCard title="Author Pages">
    <AuthorPagesContent authorPages={authorPages} />
  </SidebarCard>
);

const ExternalProfileLink = ({ href, label }: Readonly<{ href: string; label: string }>) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="group flex items-center gap-2 text-muted-foreground transition-colors hover:text-white"
  >
    <ExternalLink className="h-3.5 w-3.5" />
    <span className="truncate font-serif">{label}</span>
  </a>
);

const ExternalProfilesContent = ({
  externalProfiles,
  wikidataUrl,
  wikipediaUrl,
}: Readonly<{
  externalProfiles?: ReporterActivity["external_profiles"];
  wikidataUrl?: string;
  wikipediaUrl?: string;
}>) => (
  <div className="space-y-2 text-sm">
    {externalProfiles?.map((profile) => (
      <ExternalProfileLink
        key={`${profile.domain ?? "profile"}-${profile.url}`}
        href={profile.url}
        label={profile.domain ?? profile.url}
      />
    ))}
    {hasText(wikidataUrl) && <ExternalProfileLink href={wikidataUrl} label="Wikidata" />}
    {hasText(wikipediaUrl) && (
      <ExternalProfileLink href={wikipediaUrl} label="Wikipedia fallback" />
    )}
  </div>
);

const ExternalProfilesCard = (
  props: Readonly<{
    externalProfiles?: ReporterActivity["external_profiles"];
    wikidataUrl?: string;
    wikipediaUrl?: string;
  }>,
) => (
  <SidebarCard title="External Profiles">
    <ExternalProfilesContent
      externalProfiles={props.externalProfiles}
      wikidataUrl={props.wikidataUrl}
      wikipediaUrl={props.wikipediaUrl}
    />
  </SidebarCard>
);

const BeatsList = ({ categories }: Readonly<{ categories: ReporterActivity["categories"] }>) => (
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
);

const BeatsCard = ({ categories }: Readonly<{ categories: ReporterActivity["categories"] }>) => (
  <SidebarCard title="Beats In Corpus">
    <BeatsList categories={categories} />
  </SidebarCard>
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
    {activity !== undefined && activity.categories.length > 0 && (
      <BeatsCard categories={activity.categories} />
    )}
  </aside>
);

export {
  ReporterBackground,
  ReporterDossierHeader,
  ReporterDossierSidebar,
  ReporterLoadingState,
  ReporterNotFoundState,
};
