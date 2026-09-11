"use client";

import { GlobalNavigation } from "@/components/global-navigation";
import { fetchWikiReporter, parseReporterCareerTimeline } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  ReporterDossierHeader,
  ReporterDossierSidebar,
  ReporterLoadingState,
  ReporterNotFoundState,
  ReporterBackground,
} from "./reporter-wiki-shell";
import { ReporterDossierPanels } from "./reporter-wiki-panels";
import type { ReadonlyReporterDossier } from "./reporter-wiki-types";

const ReporterDossierContent = ({
  data,
  activity,
  careerTimeline,
  primaryOutlet,
}: Readonly<{
  data: ReadonlyReporterDossier;
  activity: ReadonlyReporterDossier["activity_summary"];
  careerTimeline: ReturnType<typeof parseReporterCareerTimeline>;
  primaryOutlet?: string;
}>) => (
  <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar">
    <ReporterBackground />
    <ReporterDossierHeader data={data} primaryOutlet={primaryOutlet} />
    <main className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <ReporterDossierSidebar data={data} activity={activity ?? undefined} />
      <ReporterDossierPanels
        data={data}
        activity={activity ?? undefined}
        careerTimeline={careerTimeline}
      />
    </main>
  </div>
);

const getReporterErrorMessage = (error: Error | null | undefined): string =>
  error?.message ?? "Reporter not found";

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
    return <ReporterNotFoundState message={getReporterErrorMessage(error)} />;
  }

  const activity = data.activity_summary;
  const careerTimeline = parseReporterCareerTimeline(data.career_timeline ?? null);
  const primaryOutlet = activity?.outlets?.[0]?.name;

  return (
    <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
      <GlobalNavigation />
      <ReporterDossierContent
        data={data}
        activity={activity}
        careerTimeline={careerTimeline}
        primaryOutlet={primaryOutlet}
      />
    </div>
  );
};

export { ReporterWikiView };
