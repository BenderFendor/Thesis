"use client";
import { hasText } from "@/lib/utils";

import { ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { checkSourceProfileCache, researchSourceProfile } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { SourceResearchProfile } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface SourceResearchPanelProps {
  readonly sourceName: string;
  readonly website?: string;
  readonly autoRun?: boolean;
}

type ReadonlySourceResearchProfile = DeepReadonly<SourceResearchProfile>;

const statusBadgeClass = {
  ambiguous: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  matched: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  none: "border-white/10 bg-muted/20 text-muted-foreground",
} as const satisfies Record<"ambiguous" | "matched" | "none", string>;

const selectSourceResearchData = function selectSourceResearchData(
  cachedData?: ReadonlySourceResearchProfile | null,
  researchData?: ReadonlySourceResearchProfile | null,
): ReadonlySourceResearchProfile | null | undefined {
  return researchData ?? cachedData;
};

const getSourceResearchUrls = (sourceName: string) => ({
  sourceSearchUrl: `https://duckduckgo.com/?q=${encodeURIComponent(`${sourceName} media outlet`)}`,
  sourceWikiHref: `/wiki/source/${encodeURIComponent(sourceName)}`,
});

const useSourceResearchCacheQuery = (
  sourceName: string,
  website: string | undefined,
  runFullResearch: boolean,
) =>
  useQuery({
    enabled: sourceName.length > 0 && !runFullResearch,
    queryFn: () => checkSourceProfileCache(sourceName, website),
    queryKey: ["source-research-cache-check", sourceName],
    retry: false,
    staleTime: 1000 * 60 * 60,
  });

const useSourceResearchQuery = (
  sourceName: string,
  website: string | undefined,
  runFullResearch: boolean,
  refreshCounter: number,
) =>
  useQuery({
    enabled: runFullResearch && sourceName.length > 0,
    queryFn: () => researchSourceProfile(sourceName, website, refreshCounter > 0),
    queryKey: ["source-research", sourceName, refreshCounter],
    retry: 1,
    staleTime: 1000 * 60 * 60,
  });

const useSourceResearchController = ({
  sourceName,
  website,
  autoRun,
}: Readonly<SourceResearchPanelProps>) => {
  const [runFullResearch, setRunFullResearch] = useState(autoRun ?? false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const { sourceSearchUrl, sourceWikiHref } = getSourceResearchUrls(sourceName);
  const cacheQuery = useSourceResearchCacheQuery(sourceName, website, runFullResearch);
  const researchQuery = useSourceResearchQuery(
    sourceName,
    website,
    runFullResearch,
    refreshCounter,
  );
  const data = selectSourceResearchData(cacheQuery.data, researchQuery.data);
  const handleRun = () => {
    setRunFullResearch(true);
  };
  const handleRefresh = () => {
    setRunFullResearch(true);
    setRefreshCounter((count) => count + 1);
  };

  return {
    data,
    error: researchQuery.error,
    handleRefresh,
    handleRun,
    hasData: Boolean(data),
    isFetching: cacheQuery.isFetching || researchQuery.isFetching,
    sourceSearchUrl,
    sourceWikiHref,
  };
};

const SourceResearchPanel = ({
  sourceName,
  website,
  autoRun = false,
}: Readonly<SourceResearchPanelProps>) => {
  const {
    data,
    error,
    hasData,
    isFetching,
    handleRefresh,
    handleRun,
    sourceSearchUrl,
    sourceWikiHref,
  } = useSourceResearchController({ autoRun, sourceName, website });

  return (
    <div className="flex h-full flex-col">
      <SourceResearchPanelHeader
        hasData={hasData}
        isFetching={isFetching}
        onRefresh={handleRefresh}
        onRun={handleRun}
        sourceWikiHref={sourceWikiHref}
      />

      <SourceResearchPanelContent
        data={data}
        error={error}
        hasData={hasData}
        isFetching={isFetching}
        sourceSearchUrl={sourceSearchUrl}
      />
    </div>
  );
};

interface SourceResearchPanelHeaderProps {
  readonly hasData: boolean;
  readonly isFetching: boolean;
  readonly onRefresh: () => void;
  readonly onRun: () => void;
  readonly sourceWikiHref: string;
}

const getResearchAction = (
  hasData: boolean,
  onRefresh: () => void,
  onRun: () => void,
): (() => void) => {
  if (hasData) {
    return onRefresh;
  }
  return onRun;
};

const getResearchActionLabel = (hasData: boolean): string => {
  if (hasData) {
    return "Refresh";
  }
  return "Run";
};

const SourceResearchPanelHeaderCopy = () => (
  <div>
    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
      Source Wiki Preview
    </p>
    <p className="mt-1 text-[11px] text-muted-foreground">
      Deterministic public-source facts and record links.
    </p>
  </div>
);

const SourceResearchPanelWikiButton = ({ href }: Readonly<{ href: string }>) => (
  <Button
    variant="outline"
    size="sm"
    asChild
    className="border-white/10 bg-transparent hover:bg-white/5 text-[9px] font-mono uppercase h-6 px-2"
  >
    <Link href={href}>
      <ExternalLink className="mr-1 h-3 w-3" />
      Full wiki
    </Link>
  </Button>
);

const SourceResearchActionContent = ({
  hasData,
  isFetching,
}: Readonly<{ hasData: boolean; isFetching: boolean }>) => {
  if (isFetching) {
    return <Loader2 className="h-3 w-3 animate-spin" />;
  }
  return (
    <>
      <RefreshCw className="mr-1 h-3 w-3" />
      {getResearchActionLabel(hasData)}
    </>
  );
};

const SourceResearchActionButton = ({
  hasData,
  isFetching,
  onRefresh,
  onRun,
}: Readonly<
  Pick<SourceResearchPanelHeaderProps, "hasData" | "isFetching" | "onRefresh" | "onRun">
>) => (
  <Button
    variant="outline"
    size="sm"
    onClick={getResearchAction(hasData, onRefresh, onRun)}
    className="border-white/10 bg-transparent hover:bg-white/5 text-[9px] font-mono uppercase h-6 px-2"
  >
    <SourceResearchActionContent hasData={hasData} isFetching={isFetching} />
  </Button>
);

const SourceResearchPanelActions = (props: Readonly<SourceResearchPanelHeaderProps>) => (
  <div className="flex items-center gap-2">
    <SourceResearchPanelWikiButton href={props.sourceWikiHref} />
    <SourceResearchActionButton
      hasData={props.hasData}
      isFetching={props.isFetching}
      onRefresh={props.onRefresh}
      onRun={props.onRun}
    />
  </div>
);

const SourceResearchPanelHeader = (props: Readonly<SourceResearchPanelHeaderProps>) => (
  <div className="border-b border-white/10 p-4 shrink-0">
    <div className="flex items-start justify-between gap-3">
      <SourceResearchPanelHeaderCopy />
      <SourceResearchPanelActions
        hasData={props.hasData}
        isFetching={props.isFetching}
        onRefresh={props.onRefresh}
        onRun={props.onRun}
        sourceWikiHref={props.sourceWikiHref}
      />
    </div>
  </div>
);

interface SourceResearchPanelContentProps {
  readonly data: ReadonlySourceResearchProfile | null | undefined;
  readonly error: Readonly<Error> | null;
  readonly hasData: boolean;
  readonly isFetching: boolean;
  readonly sourceSearchUrl: string;
}

const SourceResearchPanelContent = ({
  data,
  error,
  hasData,
  isFetching,
  sourceSearchUrl,
}: Readonly<SourceResearchPanelContentProps>) => (
  <div className="flex-1 overflow-y-auto p-4">
    <SourceResearchEmptyState visible={!hasData && !isFetching && error === null} />
    <SourceResearchLoadingState visible={isFetching && !hasData} />
    <SourceResearchErrorState visible={error !== null} />
    <SourceResearchProfileState data={data} sourceSearchUrl={sourceSearchUrl} />
  </div>
);

interface SourceResearchVisibilityProps {
  readonly visible: boolean;
}

const SourceResearchEmptyState = ({ visible }: Readonly<SourceResearchVisibilityProps>) => {
  if (!visible) {
    return null;
  }
  return (
    <p className="border-l-2 border-primary/30 pl-2 text-[11px] text-muted-foreground">
      Run research to fetch verified ownership, funding, and public records.
    </p>
  );
};

const SourceResearchLoadingState = ({ visible }: Readonly<SourceResearchVisibilityProps>) => {
  if (!visible) {
    return null;
  }
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-[10px] font-mono text-muted-foreground animate-pulse">
      Running source dossier lookup...
    </div>
  );
};

const SourceResearchErrorState = ({ visible }: Readonly<SourceResearchVisibilityProps>) => {
  if (!visible) {
    return null;
  }
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[10px] font-mono text-red-400">
      Research failed. Retry.
    </div>
  );
};

interface SourceResearchProfileStateProps {
  readonly data: ReadonlySourceResearchProfile | null | undefined;
  readonly sourceSearchUrl: string;
}

const SourceResearchProfileState = ({
  data,
  sourceSearchUrl,
}: Readonly<SourceResearchProfileStateProps>) => {
  if (data === undefined || data === null) {
    return null;
  }
  return <ResearchProfileContent data={data} sourceSearchUrl={sourceSearchUrl} />;
};

type ResearchSection = NonNullable<ReadonlySourceResearchProfile["dossier_sections"]>[number];

const ResearchProfileContent = ({
  data,
  sourceSearchUrl,
}: Readonly<{ data: ReadonlySourceResearchProfile; sourceSearchUrl: string }>) => (
  <div className="space-y-4">
    <div className="flex items-center gap-2">
      <ResearchStatusBadge status={data.match_status} />
      <Badge
        variant="outline"
        className="border-white/10 text-[9px] font-mono uppercase text-muted-foreground rounded-sm px-1.5 py-0"
      >
        {(() => {
          if (data.cached === true) {
            return "Cached";
          }
          return "Live";
        })()}
      </Badge>
    </div>

    {hasText(data.overview) && <ResearchOverviewBlock overview={data.overview} />}
    {hasText(data.match_explanation) && (
      <ResearchMethodBlock matchExplanation={data.match_explanation} />
    )}

    {(data.dossier_sections ?? []).map((section) => (
      <DossierSectionCard key={section.id} section={section} />
    ))}

    {data.citations && data.citations.length > 0 && (
      <ResearchCitationsBlock citations={data.citations} />
    )}

    {data.match_status !== "matched" && <NoVerifiedOverviewBlock />}

    <ResearchLinksRow data={data} sourceSearchUrl={sourceSearchUrl} />
  </div>
);

const ResearchStatusBadge = ({
  status,
}: Readonly<{ status?: ReadonlySourceResearchProfile["match_status"] }>) => (
  <Badge variant="outline" className={statusBadgeClass[status ?? "none"]}>
    {(() => {
      if (status === "matched") {
        return "verified";
      }
      return (() => {
        if (status === "ambiguous") {
          return "ambiguous";
        }
        return "no match";
      })();
    })()}
  </Badge>
);

const ResearchOverviewBlock = ({ overview }: Readonly<{ overview: string }>) => (
  <div className="rounded-lg border border-white/10 bg-[var(--news-bg-primary)] p-3">
    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Overview
    </p>
    <p className="mt-2 text-sm leading-relaxed text-foreground/90">{overview}</p>
  </div>
);

const ResearchMethodBlock = ({ matchExplanation }: Readonly<{ matchExplanation: string }>) => (
  <div className="rounded-lg border border-white/10 bg-muted/10 px-3 py-2">
    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Method</p>
    <p className="mt-1 text-xs text-muted-foreground">{matchExplanation}</p>
  </div>
);

const getDossierSectionClassName = (hasItems: boolean): string => {
  if (hasItems) {
    return "border-white/10 bg-[var(--news-bg-primary)]";
  }
  return "border-white/10 bg-muted/20 opacity-70 grayscale";
};

const DossierSectionItem = ({
  item,
  sectionId,
}: Readonly<{ item: ResearchSection["items"][number]; sectionId: string }>) => (
  <div key={`${sectionId}-${item.label ?? "Fact"}-${item.value ?? ""}`}>
    <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
      {item.label ?? "Fact"}
    </p>
    <p className="mt-1 break-words text-sm text-foreground/90">{item.value}</p>
  </div>
);

const DossierSectionContent = ({ section }: Readonly<{ section: ResearchSection }>) => {
  if (section.items.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">No public record found.</p>;
  }
  return (
    <div className="mt-2 space-y-2">
      {section.items.slice(0, 4).map((item) => (
        <DossierSectionItem
          key={`${section.id}-${item.label ?? "Fact"}-${item.value ?? ""}`}
          item={item}
          sectionId={section.id}
        />
      ))}
    </div>
  );
};

const DossierSectionCard = ({ section }: Readonly<{ section: ResearchSection }>) => (
  <div className={`rounded-lg border p-3 ${getDossierSectionClassName(section.items.length > 0)}`}>
    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      {section.title}
    </p>
    <DossierSectionContent section={section} />
  </div>
);

type ResearchCitation = NonNullable<ReadonlySourceResearchProfile["citations"]>[number];

const ResearchCitationLabel = ({ citation }: Readonly<{ citation: ResearchCitation }>) => {
  if (hasText(citation.url)) {
    return (
      <a href={citation.url} target="_blank" rel="noreferrer" className="hover:text-primary">
        {citation.label}
      </a>
    );
  }
  return citation.label;
};

const getCitationNote = (note?: string | null): string => {
  if (hasText(note)) {
    return ` · ${note}`;
  }
  return "";
};

const ResearchCitationRow = ({ citation }: Readonly<{ citation: ResearchCitation }>) => (
  <div
    key={`${citation.label}-${citation.url ?? ""}-${citation.note ?? ""}`}
    className="text-xs text-muted-foreground"
  >
    <ResearchCitationLabel citation={citation} />
    {getCitationNote(citation.note)}
  </div>
);

const ResearchCitationsBlock = ({
  citations,
}: Readonly<{ citations: NonNullable<ReadonlySourceResearchProfile["citations"]> }>) => (
  <div className="rounded-lg border border-white/10 bg-[var(--news-bg-primary)] p-3">
    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Sources
    </p>
    <div className="mt-2 space-y-1">
      {citations.slice(0, 5).map((citation) => (
        <ResearchCitationRow key={citation.label} citation={citation} />
      ))}
    </div>
  </div>
);

const NoVerifiedOverviewBlock = () => (
  <div className="rounded-lg border border-white/10 bg-muted/20 px-4 py-5 text-center opacity-70 grayscale">
    <p className="text-sm font-medium text-foreground">No verified source overview yet</p>
    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
      We did not find enough structured public data to build a full source wiki.
    </p>
  </div>
);

const ResearchPublicWebButton = ({
  data,
  sourceSearchUrl,
}: Readonly<{ data: ReadonlySourceResearchProfile; sourceSearchUrl: string }>) => (
  <Button variant="outline" size="sm" asChild>
    <a href={data.search_links?.source_search ?? sourceSearchUrl} target="_blank" rel="noreferrer">
      <Search className="mr-2 h-3.5 w-3.5" />
      Search public web
    </a>
  </Button>
);

const ResearchLinksRow = ({
  data,
  sourceSearchUrl,
}: Readonly<{ data: ReadonlySourceResearchProfile; sourceSearchUrl: string }>) => (
  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
    {hasText(data.wikipedia_url) && (
      <a
        href={data.wikipedia_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
      >
        <ExternalLink className="h-4 w-4" />
        Wikipedia
      </a>
    )}
    {hasText(data.wikidata_url) && (
      <a
        href={data.wikidata_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground"
      >
        <ExternalLink className="h-4 w-4" />
        Wikidata
      </a>
    )}
    <ResearchPublicWebButton data={data} sourceSearchUrl={sourceSearchUrl} />
  </div>
);

export { SourceResearchPanel };
