import type { WikiReporterDossier } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";

type ReadonlyReporterDossier = DeepReadonly<WikiReporterDossier>;
type ReporterActivity = DeepReadonly<NonNullable<WikiReporterDossier["activity_summary"]>>;
type EducationEntry = NonNullable<ReadonlyReporterDossier["education"]>[number];
type CareerEntry = NonNullable<ReadonlyReporterDossier["career_history"]>[number];
type RecentArticle = ReadonlyReporterDossier["recent_articles"][number];
type PublicRecordSection = ReadonlyReporterDossier["dossier_sections"][number];
type CountedActivity = ReporterActivity["outlets"][number] | ReporterActivity["categories"][number];

export type {
  CareerEntry,
  CountedActivity,
  EducationEntry,
  PublicRecordSection,
  RecentArticle,
  ReadonlyReporterDossier,
  ReporterActivity,
};
