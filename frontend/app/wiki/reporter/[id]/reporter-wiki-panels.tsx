"use client";

import { hasText } from "@/lib/utils";
import { FileText, Newspaper, UserRound } from "lucide-react";
import { Panel } from "@/features/wiki/ui/wiki-primitives";
import { CareerTimeline } from "./career-timeline";
import { WikiCitationPanel } from "@/features/wiki/ui/wiki-citation-panel";
import { formatArticleDate } from "@/lib/date-formatters";
import type { parseReporterCareerTimeline } from "@/lib/api";
import type {
  CareerEntry,
  CountedActivity,
  EducationEntry,
  PublicRecordSection,
  RecentArticle,
  ReadonlyReporterDossier,
  ReporterActivity,
} from "./reporter-wiki-types";

const OverviewMatchMethod = ({ data }: Readonly<{ data: ReadonlyReporterDossier }>) => (
  <div className="mt-4 border-t border-white/5 pt-4">
    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      Match method
    </div>
    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
      {data.match_explanation ?? "Matched from public identity records and local article evidence."}
    </p>
  </div>
);

const OverviewCard = ({ data }: Readonly<{ data: ReadonlyReporterDossier }>) => (
  <div className="rounded-2xl border border-white/10 bg-black/25 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
    <p className="text-base leading-8 text-foreground/90">
      {data.overview ?? data.bio ?? "No verified overview available yet."}
    </p>
    <OverviewMatchMethod data={data} />
  </div>
);

const OverviewPanel = ({ data }: Readonly<{ data: ReadonlyReporterDossier }>) => (
  <Panel title="Overview" eyebrow="Deterministic identity and corpus view">
    <OverviewCard data={data} />
  </Panel>
);

const PublicRecordItem = ({
  label,
  value,
}: Readonly<{ label?: string | null; value?: string | null }>) => (
  <div>
    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      {label ?? "Record"}
    </div>
    <div className="mt-1 text-sm leading-6 text-foreground/90">{value}</div>
  </div>
);

const PublicRecordItems = ({ section }: Readonly<{ section: PublicRecordSection }>) => (
  <div className="mt-3 space-y-3">
    {section.items.slice(0, 6).map((item) => (
      <PublicRecordItem
        key={`${section.id}-${item.label ?? "record"}-${item.value ?? ""}`}
        label={item.label}
        value={item.value}
      />
    ))}
  </div>
);

const PublicRecordSectionView = ({ section }: Readonly<{ section: PublicRecordSection }>) => {
  if (section.items.length === 0) {
    return (
      <p className="px-1 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
        {section.title}: no public record found.
      </p>
    );
  }
  return (
    <div className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {section.title}
      </div>
      <PublicRecordItems section={section} />
    </div>
  );
};

const PublicRecordSections = ({
  sections,
}: Readonly<{ sections: ReadonlyReporterDossier["dossier_sections"] }>) => (
  <div className="space-y-2">
    {sections.map((section) => (
      <PublicRecordSectionView key={section.id} section={section} />
    ))}
  </div>
);

const PublicRecordPanel = ({
  sections,
}: Readonly<{ sections: ReadonlyReporterDossier["dossier_sections"] }>) => (
  <Panel title="Public Record" eyebrow="Identity and external reference evidence">
    <PublicRecordSections sections={sections} />
  </Panel>
);

const CareerEntryFacts = ({ entry }: Readonly<{ entry: CareerEntry }>) => (
  <>
    {hasText(entry.organization) && (
      <div className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground mt-1">
        {entry.organization}
      </div>
    )}
    {hasText(entry.source) && (
      <div className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground mt-0.5">
        Source: {entry.source}
      </div>
    )}
  </>
);

const CareerEntryView = ({ entry }: Readonly<{ entry: CareerEntry }>) => (
  <div className="border-l border-white/10 pl-3">
    <div className="text-sm font-serif">{entry.role ?? "Reporter"}</div>
    <CareerEntryFacts entry={entry} />
  </div>
);

const CareerEntries = ({ entries }: Readonly<{ entries: readonly CareerEntry[] }>) => (
  <div className="space-y-3">
    {entries.map((entry) => (
      <CareerEntryView
        key={`${entry.organization ?? "career"}-${entry.role ?? "reporter"}-${entry.source ?? ""}`}
        entry={entry}
      />
    ))}
  </div>
);

const CareerHeading = () => (
  <div className="mb-3 flex items-center gap-2 text-sm font-medium font-serif">
    <UserRound className="h-4 w-4 text-muted-foreground" />
    Career history
  </div>
);

const NoCareerEntries = () => (
  <p className="flex items-center gap-2 px-1 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
    <UserRound className="h-3.5 w-3.5" /> No career entries stored.
  </p>
);

const CareerSection = ({ entries }: Readonly<{ entries: readonly CareerEntry[] | undefined }>) => {
  if (entries === undefined || entries.length === 0) {
    return <NoCareerEntries />;
  }
  return (
    <div className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
      <CareerHeading />
      <CareerEntries entries={entries} />
    </div>
  );
};

const EducationHeading = () => (
  <div className="mb-3 flex items-center gap-2 text-sm font-medium font-serif">
    <FileText className="h-4 w-4 text-muted-foreground" />
    Education
  </div>
);

const NoEducationEntries = () => (
  <p className="flex items-center gap-2 px-1 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
    <FileText className="h-3.5 w-3.5" /> No education entries stored.
  </p>
);

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

const EducationEntries = ({ entries }: Readonly<{ entries: readonly EducationEntry[] }>) => (
  <div className="space-y-3">
    {entries.map((entry) => (
      <div key={JSON.stringify(entry) ?? "education"} className="text-sm text-foreground/90">
        {formatEducationEntry(entry)}
      </div>
    ))}
  </div>
);

const EducationSection = ({
  entries,
}: Readonly<{ entries: readonly EducationEntry[] | undefined }>) => {
  if (entries === undefined || entries.length === 0) {
    return <NoEducationEntries />;
  }
  return (
    <div className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
      <EducationHeading />
      <EducationEntries entries={entries} />
    </div>
  );
};

const BackgroundGrid = ({ data }: Readonly<{ data: ReadonlyReporterDossier }>) => (
  <div className="grid gap-4 lg:grid-cols-2">
    <CareerSection entries={data.career_history} />
    <EducationSection entries={data.education} />
  </div>
);

const BackgroundPanel = ({ data }: Readonly<{ data: ReadonlyReporterDossier }>) => (
  <Panel title="Background" eyebrow="Stored employment and education records">
    <BackgroundGrid data={data} />
  </Panel>
);

const formatCountedActivity = (items: readonly CountedActivity[]): readonly string[] =>
  items.map((item) => `${item.name} · ${item.article_count}`);

const formatDomainActivity = (items: ReporterActivity["domains"]): readonly string[] =>
  items.map((item) => `${item.domain} · ${item.article_count}`);

const ActivityList = ({ title, items }: Readonly<{ title: string; items: readonly string[] }>) => {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
        <div className="mb-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {title}
        </div>
        <p className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
          No activity recorded.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-white/5 bg-black/20 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg p-5">
      <div className="mb-3 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="space-y-2 text-[10px] font-mono tracking-widest uppercase">
        {items.map((item) => (
          <div
            key={item}
            className="rounded-xl border border-white/5 bg-black/20 px-3 py-2 transition-colors hover:bg-white/5 hover:border-white/10"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
};

const ActivityGrid = ({ activity }: Readonly<{ activity: ReporterActivity }>) => (
  <div className="grid gap-4 lg:grid-cols-3">
    <ActivityList title="Outlets" items={formatCountedActivity(activity.outlets)} />
    <ActivityList title="Categories" items={formatCountedActivity(activity.categories)} />
    <ActivityList title="Domains" items={formatDomainActivity(activity.domains)} />
  </div>
);

const CorpusActivityPanel = ({ activity }: Readonly<{ activity: ReporterActivity }>) => (
  <Panel title="Corpus Activity" eyebrow="Signals derived from your own article database">
    <ActivityGrid activity={activity} />
  </Panel>
);

const RecentArticleTitle = ({ article }: Readonly<{ article: RecentArticle }>) => (
  <div className="text-base font-serif group-hover:text-primary transition-colors">
    {article.title}
  </div>
);

const RecentArticleMeta = ({ article }: Readonly<{ article: RecentArticle }>) => (
  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono tracking-widest uppercase text-muted-foreground">
    {hasText(article.source) && (
      <span className="group-hover:opacity-100 transition-opacity">{article.source}</span>
    )}
    {hasText(article.category) && (
      <span className="group-hover:opacity-100 transition-opacity">{article.category}</span>
    )}
    {hasText(article.published_at) && (
      <span className="group-hover:opacity-100 transition-opacity">
        {formatArticleDate(article.published_at)}
      </span>
    )}
  </div>
);

const RecentArticleText = ({ article }: Readonly<{ article: RecentArticle }>) => (
  <div className="min-w-0">
    <RecentArticleTitle article={article} />
    <RecentArticleMeta article={article} />
  </div>
);

const RecentArticleItem = ({ article }: Readonly<{ article: RecentArticle }>) => (
  <a
    href={article.url ?? "#"}
    target="_blank"
    rel="noreferrer"
    className="group flex items-start justify-between gap-3 rounded-2xl border border-white/5 bg-black/20 p-4 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg hover:border-white/10"
  >
    <RecentArticleText article={article} />
    <Newspaper className="mt-1 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
  </a>
);

const RecentArticleList = ({
  articles,
}: Readonly<{ articles: ReadonlyReporterDossier["recent_articles"] }>) => (
  <div className="space-y-3">
    {articles.map((article) => (
      <RecentArticleItem key={article.id ?? article.url} article={article} />
    ))}
  </div>
);

const RecentArticlesPanel = ({
  articles,
}: Readonly<{ articles: ReadonlyReporterDossier["recent_articles"] }>) => (
  <Panel title="Recent Articles" eyebrow="Latest work in the local corpus">
    <RecentArticleList articles={articles} />
  </Panel>
);

const CareerTimelinePanel = ({
  careerTimeline,
}: Readonly<{ careerTimeline: ReturnType<typeof parseReporterCareerTimeline> }>) => {
  if (
    careerTimeline === null ||
    careerTimeline === undefined ||
    careerTimeline.timeline.length === 0
  ) {
    return null;
  }
  return (
    <Panel title="Career Timeline" eyebrow="Bylines and affiliations, merged chronologically">
      <CareerTimeline data={careerTimeline} />
    </Panel>
  );
};

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
    {((data.career_history?.length ?? 0) > 0 || (data.education?.length ?? 0) > 0) && (
      <BackgroundPanel data={data} />
    )}
    <CareerTimelinePanel careerTimeline={careerTimeline} />
    {activity !== undefined && <CorpusActivityPanel activity={activity} />}
    {data.recent_articles.length > 0 && <RecentArticlesPanel articles={data.recent_articles} />}
    {data.citations.length > 0 && <WikiCitationPanel citations={data.citations} />}
  </section>
);

export { ReporterDossierPanels };
