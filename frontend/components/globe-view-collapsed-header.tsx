import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, X } from "lucide-react";
import type { CountryListItem } from "@/lib/api";
import type { CountrySelection, SourceSummaryEntry } from "@/lib/globe-workspace";
import type { LightingMode, PanelPointerHandler } from "@/components/globe-ui-state";
import { formatArticleDateTime } from "@/lib/date-formatters";
import { hasCountrySelection, hasText } from "@/lib/globe-workspace";
import { cn } from "@/lib/utils";
import { EMPTY_COUNT, getSheetToggleLabel } from "./globe-view-shared";

interface CollapsedPanelHeaderProps {
  readonly selectedCountry: CountrySelection;
  readonly focusLabel: string;
  readonly articleCount: number;
  readonly sourceCount: number;
  readonly selectedCountryCoverage: number;
  readonly selectedCountryMeta: Readonly<CountryListItem> | undefined;
  readonly isMobileSheetExpanded: boolean;
  readonly onToggleMobileSheet: () => void;
  readonly onResetFocus: () => void;
  readonly onExpandFocus: () => void;
  readonly onHandleClick: () => void;
  readonly onHandlePointerDown: PanelPointerHandler;
  readonly onHandlePointerMove: PanelPointerHandler;
  readonly onHandlePointerUp: PanelPointerHandler;
  readonly onHandlePointerCancel: PanelPointerHandler;
  readonly topSources: readonly SourceSummaryEntry[];
  readonly sidebarTab: string;
  readonly onSidebarTabChange: (value: string) => void;
  readonly lightingMode: LightingMode;
  readonly onSetAllLit: () => void;
  readonly onSetDayNight: () => void;
}

type CollapsedPanelHeaderPartProps = Readonly<{
  readonly header: CollapsedPanelHeaderProps;
}>;

const CollapsedPanelDragHandle = ({ header }: Readonly<CollapsedPanelHeaderPartProps>) => {
  const {
    isMobileSheetExpanded,
    onHandleClick,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel,
  } = header;
  return (
    <button
      type="button"
      onClick={onHandleClick}
      onPointerDown={onHandlePointerDown}
      onPointerMove={onHandlePointerMove}
      onPointerUp={onHandlePointerUp}
      onPointerCancel={onHandlePointerCancel}
      className="group mx-auto -my-1 flex h-8 w-24 touch-none items-center justify-center lg:hidden"
      aria-label={getSheetToggleLabel(isMobileSheetExpanded)}
    >
      <span className="h-1 w-12 rounded-full bg-white/35 transition-all duration-200 group-hover:w-16 group-hover:bg-white/60 group-active:w-20 group-active:bg-primary/80" />
    </button>
  );
};

type CollapsedPanelCoverageHeatProps = Readonly<{
  readonly selectedCountryCoverage: number;
}>;

const CollapsedPanelCoverageHeat = (props: Readonly<CollapsedPanelCoverageHeatProps>) => (
  <span
    className="flex cursor-help items-center gap-1"
    title="Combined global attention signal for this country in the active global window."
  >
    <span className="font-medium text-foreground/80">{props.selectedCountryCoverage}</span>
    coverage heat
  </span>
);

const CollapsedPanelCoverageIndicator = ({
  selectedCountryCoverage,
}: CollapsedPanelCoverageHeatProps) => (
  <>
    <span className="text-white/20">•</span>
    <CollapsedPanelCoverageHeat selectedCountryCoverage={selectedCountryCoverage} />
  </>
);

type CollapsedPanelLatestArticleProps = Readonly<{
  latestArticle: string | null | undefined;
  visible: boolean;
}>;

const CollapsedPanelLatestArticle = (props: Readonly<CollapsedPanelLatestArticleProps>) => {
  if (!props.visible || !hasText(props.latestArticle)) {
    return null;
  }
  return (
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
      Latest: {formatArticleDateTime(props.latestArticle)}
    </div>
  );
};

const CollapsedPanelFocusMetrics = (props: Readonly<CollapsedPanelHeaderPartProps>) => {
  const { header } = props;
  const showCoverageHeat = hasCountrySelection(header.selectedCountry);
  const showLatestArticle = showCoverageHeat && header.isMobileSheetExpanded;
  const latestArticle = header.selectedCountryMeta?.latest_article;
  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground/80">{header.articleCount}</span> articles
        <span className="text-white/20">•</span>
        <span className="font-medium text-foreground/80">{header.sourceCount}</span> sources
        {showCoverageHeat && (
          <CollapsedPanelCoverageIndicator
            selectedCountryCoverage={header.selectedCountryCoverage}
          />
        )}
      </div>
      <CollapsedPanelLatestArticle latestArticle={latestArticle} visible={showLatestArticle} />
    </div>
  );
};

const CollapsedPanelFocusSummary = (props: Readonly<CollapsedPanelHeaderPartProps>) => (
  <div>
    <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">Focus</p>
    <h3 className="mt-1 mb-1 font-serif text-2xl text-foreground lg:text-3xl xl:text-4xl">
      {props.header.focusLabel}
    </h3>
    <CollapsedPanelFocusMetrics header={props.header} />
  </div>
);

const CollapsedPanelActions = (props: Readonly<CollapsedPanelHeaderPartProps>) => {
  const { header } = props;
  const {
    onExpandFocus: handleExpandFocus,
    onResetFocus: handleResetFocus,
    onToggleMobileSheet: handleToggleMobileSheet,
  } = header;
  const sheetToggleLabel = getSheetToggleLabel(header.isMobileSheetExpanded);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleToggleMobileSheet}
        className="h-8 w-8 rounded-full border-white/10 bg-transparent p-0 hover:bg-white/5 lg:hidden"
        aria-label={sheetToggleLabel}
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            header.isMobileSheetExpanded && "rotate-180",
          )}
        />
      </Button>
      {hasCountrySelection(header.selectedCountry) && (
        <CollapsedPanelCountryActions
          onExpandFocus={handleExpandFocus}
          onResetFocus={handleResetFocus}
        />
      )}
    </>
  );
};

type CollapsedPanelCountryActionsProps = Readonly<{
  readonly onResetFocus: () => void;
  readonly onExpandFocus: () => void;
}>;

const CollapsedPanelCountryActions = (props: Readonly<CollapsedPanelCountryActionsProps>) => (
  <div className="flex flex-col items-end gap-2">
    <Button
      variant="outline"
      size="sm"
      onClick={props.onExpandFocus}
      className="hidden rounded-full border-white/10 bg-transparent px-3 text-[10px] hover:bg-white/5 lg:flex h-8"
    >
      <ChevronDown className="mr-1.5 h-3 w-3 rotate-180" />
      Expand Focus
    </Button>
    <Button
      variant="outline"
      size="sm"
      onClick={props.onResetFocus}
      className="rounded-full border-white/10 bg-transparent hover:bg-white/5 h-8 w-8 p-0"
    >
      <X className="h-3 w-3" />
    </Button>
  </div>
);

const CollapsedPanelHeaderBody = (props: Readonly<CollapsedPanelHeaderPartProps>) => (
  <div className="flex items-start justify-between">
    <CollapsedPanelFocusSummary header={props.header} />
    <CollapsedPanelActions header={props.header} />
  </div>
);

const CollapsedPanelGuidance = (props: Readonly<CollapsedPanelHeaderPartProps>) => (
  <>
    {!hasCountrySelection(props.header.selectedCountry) && (
      <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-xs leading-relaxed text-muted-foreground mt-2 lg:p-4 lg:mt-4">
        The map shows recent coverage volume. Click a country to view local and foreign reporting.
      </div>
    )}
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/30 p-4 text-xs leading-relaxed text-muted-foreground",
        hasCountrySelection(props.header.selectedCountry) && "hidden",
        !props.header.isMobileSheetExpanded && "hidden lg:block",
      )}
    >
      Use the globe as the country navigator. Hover to inspect coverage heat, then click a country
      to open its local and world lens.
    </div>
  </>
);

const CollapsedPanelSourceBadges = (props: Readonly<CollapsedPanelHeaderPartProps>) => {
  if (props.header.topSources.length === EMPTY_COUNT) {
    return null;
  }
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2 mt-2 lg:mt-4",
        !props.header.isMobileSheetExpanded && "hidden lg:flex",
      )}
    >
      {props.header.topSources.map((source) => (
        <Badge
          key={source.name}
          variant="outline"
          className="rounded-full border-white/10 bg-white/5 px-3 py-1 text-[9px] uppercase tracking-wide"
        >
          {source.name} · {source.count}
        </Badge>
      ))}
    </div>
  );
};

const CollapsedPanelTabList = () => (
  <TabsList className="grid w-full grid-cols-3 rounded-full border border-white/10 bg-black/20 p-1 h-auto">
    <TabsTrigger
      value="briefing"
      className="rounded-full text-[9px] sm:text-[10px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
    >
      Briefing
    </TabsTrigger>
    <TabsTrigger
      value="intelligence"
      className="rounded-full text-[9px] sm:text-[10px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
    >
      Intel
    </TabsTrigger>
    <TabsTrigger
      value="sources"
      className="rounded-full text-[9px] sm:text-[10px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
    >
      Sources
    </TabsTrigger>
  </TabsList>
);

const CollapsedPanelTabs = (props: Readonly<CollapsedPanelHeaderPartProps>) => {
  const { header } = props;
  const { onSidebarTabChange: handleSidebarTabChange } = header;
  return (
    <Tabs
      value={header.sidebarTab}
      onValueChange={handleSidebarTabChange}
      className={cn("w-full mt-4", !header.isMobileSheetExpanded && "hidden lg:block")}
    >
      <CollapsedPanelTabList />
    </Tabs>
  );
};

const collapsedLightingClassName = (lightingMode: LightingMode, mode: LightingMode): string => {
  if (lightingMode === mode) {
    return "bg-primary/15 text-primary";
  }
  return "text-muted-foreground";
};

const CollapsedPanelLightingControls = (props: Readonly<CollapsedPanelHeaderPartProps>) => {
  const { header } = props;
  const { onSetAllLit: handleSetAllLit, onSetDayNight: handleSetDayNight } = header;
  return (
    <div
      className={cn("grid grid-cols-2 gap-2 lg:hidden", !header.isMobileSheetExpanded && "hidden")}
    >
      <button
        type="button"
        onClick={handleSetAllLit}
        className={cn(
          "rounded-full border border-white/10 px-3 py-2 text-[9px] font-mono uppercase tracking-[0.16em]",
          collapsedLightingClassName(header.lightingMode, "all-lit"),
        )}
      >
        All Lit
      </button>
      <button
        type="button"
        onClick={handleSetDayNight}
        className={cn(
          "rounded-full border border-white/10 px-3 py-2 text-[9px] font-mono uppercase tracking-[0.16em]",
          collapsedLightingClassName(header.lightingMode, "day-night"),
        )}
      >
        Day/Night
      </button>
    </div>
  );
};

const CollapsedPanelHeader = (props: Readonly<CollapsedPanelHeaderPartProps>) => (
  <div className="space-y-2.5 border-b border-white/10 p-3 shrink-0 lg:space-y-3 lg:p-4">
    <CollapsedPanelDragHandle header={props.header} />
    <CollapsedPanelHeaderBody header={props.header} />
    <CollapsedPanelGuidance header={props.header} />
    <CollapsedPanelSourceBadges header={props.header} />
    <CollapsedPanelTabs header={props.header} />
    <CollapsedPanelLightingControls header={props.header} />
  </div>
);

export { CollapsedPanelHeader };
export type { CollapsedPanelHeaderProps };
