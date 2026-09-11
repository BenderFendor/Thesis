import { Badge } from "@/components/ui/badge";
import { Signal } from "lucide-react";
import { useCallback } from "react";
import type { NewsArticle } from "@/lib/api";
import type { CountrySelection, WorkspaceSource } from "@/lib/globe-workspace";
import { hasCountrySelection } from "@/lib/globe-workspace";
import { EMPTY_COUNT, ICON_SIZE } from "./globe-view-shared";
import { COLLAPSED_SOURCE_LIMIT, GLOBAL_COLLAPSED_SOURCE_LIMIT } from "./globe-view-collapsed-tabs";

interface CollapsedSourcesTabProps {
  readonly selectedCountry: CountrySelection;
  readonly focusLabel: string;
  readonly sourceCount: number;
  readonly sourceWorkspace: readonly WorkspaceSource[];
  readonly sourceSummaryLength: number;
  readonly onArticleSelect: (article: NewsArticle) => void;
}

const collapsedSourceLimit = (selectedCountry: CountrySelection): number => {
  if (hasCountrySelection(selectedCountry)) {
    return COLLAPSED_SOURCE_LIMIT;
  }
  return GLOBAL_COLLAPSED_SOURCE_LIMIT;
};

const collapsedSourceModeLabel = (selectedCountry: CountrySelection): string => {
  if (hasCountrySelection(selectedCountry)) {
    return "Lens source";
  }
  return "Live source";
};

const collapsedSourceWorkspaceTitle = (
  selectedCountry: CountrySelection,
  focusLabel: string,
): string => {
  if (hasCountrySelection(selectedCountry)) {
    return `Active outlets in ${focusLabel}`;
  }
  return "Top live outlets in the current globe feed";
};

const CollapsedSourcesHeader = (
  props: Readonly<Pick<CollapsedSourcesTabProps, "focusLabel" | "selectedCountry" | "sourceCount">>,
) => (
  <div className="mb-4 flex items-center justify-between gap-3">
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        Source Workspace
      </div>
      <div className="mt-1 text-sm text-foreground">
        {collapsedSourceWorkspaceTitle(props.selectedCountry, props.focusLabel)}
      </div>
    </div>
    <Badge
      variant="outline"
      className="rounded-full border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-primary"
    >
      {props.sourceCount} sources
    </Badge>
  </div>
);

const CollapsedSourcesGuidance = () => (
  <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-muted-foreground">
    Pick a country to turn this into a local source workspace. Until then, this tab shows the
    strongest live sources across the global feed.
  </div>
);

const CollapsedSourceIdentityText = (
  props: Readonly<Pick<WorkspaceSource, "name"> & { readonly selectedCountry: CountrySelection }>,
) => (
  <div className="min-w-0">
    <div className="truncate text-sm font-medium text-foreground">{props.name}</div>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
      {collapsedSourceModeLabel(props.selectedCountry)}
    </div>
  </div>
);

const CollapsedSourceIdentity = (
  props: Readonly<Pick<WorkspaceSource, "name"> & { readonly selectedCountry: CountrySelection }>,
) => (
  <div className="flex min-w-0 items-center gap-3">
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-foreground">
      <Signal size={ICON_SIZE} />
    </div>
    <CollapsedSourceIdentityText name={props.name} selectedCountry={props.selectedCountry} />
  </div>
);

const CollapsedSourceRow = (
  props: Readonly<
    Pick<CollapsedSourcesTabProps, "onArticleSelect" | "selectedCountry"> & {
      readonly source: WorkspaceSource;
    }
  >,
) => {
  const { onArticleSelect, selectedCountry, source } = props;
  const handleClick = useCallback((): void => {
    if (source.latestArticle !== undefined) {
      onArticleSelect(source.latestArticle);
    }
  }, [onArticleSelect, source]);
  return (
    <button
      key={source.name}
      type="button"
      onClick={handleClick}
      className="w-full rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-left transition-colors hover:border-white/40"
    >
      <div className="flex items-center justify-between gap-3">
        <CollapsedSourceIdentity name={source.name} selectedCountry={selectedCountry} />
        <Badge
          variant="outline"
          className="shrink-0 rounded-full border-white/10 bg-white/5 text-muted-foreground"
        >
          {source.count}
        </Badge>
      </div>
    </button>
  );
};

const CollapsedSourcesEmpty = () => (
  <div className="py-12 text-center text-xs uppercase tracking-widest text-muted-foreground">
    No sources available
  </div>
);

const CollapsedSourceList = (
  props: Readonly<
    Pick<CollapsedSourcesTabProps, "onArticleSelect" | "selectedCountry" | "sourceWorkspace">
  >,
) => (
  <div className="space-y-2">
    {props.sourceWorkspace.slice(0, collapsedSourceLimit(props.selectedCountry)).map((source) => (
      <CollapsedSourceRow
        key={source.name}
        onArticleSelect={props.onArticleSelect}
        selectedCountry={props.selectedCountry}
        source={source}
      />
    ))}
    {props.sourceWorkspace.length === EMPTY_COUNT && <CollapsedSourcesEmpty />}
  </div>
);

const CollapsedSourcesFooter = (
  props: Readonly<Pick<CollapsedSourcesTabProps, "selectedCountry" | "sourceSummaryLength">>,
) => {
  const limit = collapsedSourceLimit(props.selectedCountry);
  if (props.sourceSummaryLength <= limit) {
    return null;
  }
  return (
    <div className="mt-4 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Showing top {limit} of {props.sourceSummaryLength} sources
    </div>
  );
};

const CollapsedSourcesCard = (props: Readonly<CollapsedSourcesTabProps>) => (
  <div className="rounded-2xl border border-white/10 bg-[var(--news-bg-primary)]/30 p-4">
    <CollapsedSourcesHeader
      focusLabel={props.focusLabel}
      selectedCountry={props.selectedCountry}
      sourceCount={props.sourceCount}
    />
    {!hasCountrySelection(props.selectedCountry) && <CollapsedSourcesGuidance />}
    <CollapsedSourceList
      onArticleSelect={props.onArticleSelect}
      selectedCountry={props.selectedCountry}
      sourceWorkspace={props.sourceWorkspace}
    />
    <CollapsedSourcesFooter
      selectedCountry={props.selectedCountry}
      sourceSummaryLength={props.sourceSummaryLength}
    />
  </div>
);

const CollapsedSourcesTab = (props: Readonly<CollapsedSourcesTabProps>) => (
  <div className="flex min-h-0 flex-1 overflow-y-auto p-4 pb-20 custom-scrollbar lg:overflow-y-auto">
    <CollapsedSourcesCard
      focusLabel={props.focusLabel}
      onArticleSelect={props.onArticleSelect}
      selectedCountry={props.selectedCountry}
      sourceCount={props.sourceCount}
      sourceSummaryLength={props.sourceSummaryLength}
      sourceWorkspace={props.sourceWorkspace}
    />
  </div>
);

export { CollapsedSourcesTab };
