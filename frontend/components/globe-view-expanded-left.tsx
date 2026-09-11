import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Globe2, PanelRight, Radio } from "lucide-react";
import { useCallback } from "react";
import type { CountryListItem } from "@/lib/api";
import type { RefObject } from "react";
import type { LensViewMode } from "@/components/globe-ui-state";
import type { SourceSummaryEntry } from "@/lib/globe-workspace";
import { hasText } from "@/lib/globe-workspace";
import { formatArticleDateTime } from "@/lib/date-formatters";
import { cn } from "@/lib/utils";
import { ICON_SIZE, TOP_SOURCE_LIMIT } from "./globe-view-shared";

interface ExpandedLeftSidebarProps {
  readonly focusLabel: string;
  readonly articleCount: number;
  readonly sourceCount: number;
  readonly selectedCountryCoverage: number;
  readonly selectedCountryMeta: Readonly<CountryListItem> | undefined;
  readonly topSources: readonly SourceSummaryEntry[];
  readonly viewMode: LensViewMode;
  readonly onViewModeChange: (value: LensViewMode) => void;
  readonly sidebarTab: string;
  readonly onNavigate: (
    tab: "briefing" | "intelligence" | "sources",
    ref: Readonly<RefObject<HTMLDivElement | null>>,
  ) => void;
  readonly lensBriefRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly topStoriesRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly trendingTopicsRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly sourceBreakdownRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly coverageMapRef: Readonly<RefObject<HTMLDivElement | null>>;
}

const ExpandedFocusSources = (
  props: Readonly<Pick<ExpandedLeftSidebarProps, "sourceCount" | "topSources">>,
) => (
  <div className="mt-4 flex flex-wrap gap-1.5">
    {props.topSources.map((source) => (
      <Badge
        variant="outline"
        key={source.name}
        className="rounded-full border-primary/25 bg-primary/10 px-2 py-0.5 text-[9px] uppercase tracking-wider text-primary"
      >
        {source.name} · {source.count}
      </Badge>
    ))}
    {props.sourceCount > TOP_SOURCE_LIMIT && (
      <Badge
        variant="outline"
        className="rounded-full border-white/10 bg-white/5 px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
      >
        + {props.sourceCount - TOP_SOURCE_LIMIT} More
      </Badge>
    )}
  </div>
);

const ExpandedFocusSection = (
  props: Readonly<
    Pick<
      ExpandedLeftSidebarProps,
      | "articleCount"
      | "focusLabel"
      | "selectedCountryCoverage"
      | "selectedCountryMeta"
      | "sourceCount"
      | "topSources"
    >
  >,
) => (
  <div className="border-b border-white/10 p-6">
    <h3 className="mb-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Focus
    </h3>
    <h2 className="mb-2 font-serif text-3xl text-foreground">{props.focusLabel}</h2>
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>{props.articleCount} articles</span>
      <span>·</span>
      <span>{props.sourceCount} sources</span>
      <span>·</span>
      <span>{props.selectedCountryCoverage} coverage heat</span>
    </div>
    {hasText(props.selectedCountryMeta?.latest_article) && (
      <div className="mt-3 text-[9px] uppercase tracking-widest text-muted-foreground/60">
        Latest: {formatArticleDateTime(props.selectedCountryMeta.latest_article)}
      </div>
    )}
    <ExpandedFocusSources sourceCount={props.sourceCount} topSources={props.topSources} />
  </div>
);

const expandedViewClassName = (active: boolean): string => {
  if (active) {
    return "bg-primary/10 text-primary";
  }
  return "text-muted-foreground hover:bg-white/5 hover:text-foreground";
};

const expandedLensIconClassName = (active: boolean): string | undefined => {
  if (active) {
    return "text-primary";
  }
  return void 0;
};

const ExpandedViewButtons = (
  props: Readonly<Pick<ExpandedLeftSidebarProps, "onViewModeChange" | "viewMode">>,
) => {
  const { onViewModeChange, viewMode } = props;
  const onExternal = useCallback(() => {
      onViewModeChange("external");
    }, [onViewModeChange]),
    onInternal = useCallback(() => {
      onViewModeChange("internal");
    }, [onViewModeChange]);
  return (
    <div className="flex flex-col gap-0 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
      <button
        type="button"
        onClick={onInternal}
        className={cn(
          "flex w-full items-center gap-2.5 whitespace-nowrap border-b border-white/10 px-3 py-3 text-left text-[9px] uppercase tracking-[0.14em] transition-colors",
          expandedViewClassName(viewMode === "internal"),
        )}
      >
        <Radio size={ICON_SIZE} className={expandedLensIconClassName(viewMode === "internal")} />{" "}
        Local Lens
      </button>
      <button
        type="button"
        onClick={onExternal}
        className={cn(
          "flex w-full items-center gap-2.5 whitespace-nowrap px-3 py-3 text-left text-[9px] uppercase tracking-[0.14em] transition-colors",
          expandedViewClassName(viewMode === "external"),
        )}
      >
        <Globe2 size={ICON_SIZE} className={expandedLensIconClassName(viewMode === "external")} />{" "}
        World Lens
      </button>
    </div>
  );
};

const ExpandedViewsSection = (
  props: Readonly<Pick<ExpandedLeftSidebarProps, "onViewModeChange" | "viewMode">>,
) => (
  <div className="border-b border-white/10 p-6">
    <h3 className="mb-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Views
    </h3>
    <ExpandedViewButtons onViewModeChange={props.onViewModeChange} viewMode={props.viewMode} />
  </div>
);

interface ExpandedQuickNavButtonProps {
  readonly active: boolean;
  readonly label: string;
  readonly onNavigate: ExpandedLeftSidebarProps["onNavigate"];
  readonly refTarget: Readonly<RefObject<HTMLDivElement | null>>;
  readonly tab: "briefing" | "intelligence" | "sources";
  readonly withMarker?: boolean;
}

const ExpandedQuickNavButton = (props: Readonly<ExpandedQuickNavButtonProps>) => {
  const { onNavigate, refTarget, tab } = props;
  const handleClick = useCallback(() => {
    onNavigate(tab, refTarget);
  }, [onNavigate, refTarget, tab]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
        expandedViewClassName(props.active),
      )}
    >
      {props.withMarker === true && (
        <span className="mr-3 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
      )}
      {props.label}
    </button>
  );
};

type ExpandedQuickNavProps = Readonly<
  Pick<
    ExpandedLeftSidebarProps,
    | "coverageMapRef"
    | "lensBriefRef"
    | "onNavigate"
    | "sidebarTab"
    | "sourceBreakdownRef"
    | "topStoriesRef"
    | "trendingTopicsRef"
  >
>;

const ExpandedQuickNavItems = (props: ExpandedQuickNavProps) => (
  <div className="flex flex-col gap-1">
    <ExpandedQuickNavButton
      active={props.sidebarTab === "briefing"}
      label="Lens Brief"
      onNavigate={props.onNavigate}
      refTarget={props.lensBriefRef}
      tab="briefing"
      withMarker
    />
    <ExpandedQuickNavButton
      active={props.sidebarTab === "briefing"}
      label="Top Stories"
      onNavigate={props.onNavigate}
      refTarget={props.topStoriesRef}
      tab="briefing"
    />
    <ExpandedQuickNavButton
      active={props.sidebarTab === "intelligence"}
      label="Trending Topics"
      onNavigate={props.onNavigate}
      refTarget={props.trendingTopicsRef}
      tab="intelligence"
    />
    <ExpandedQuickNavButton
      active={props.sidebarTab === "sources"}
      label="Source Breakdown"
      onNavigate={props.onNavigate}
      refTarget={props.sourceBreakdownRef}
      tab="sources"
    />
    <ExpandedQuickNavButton
      active={props.sidebarTab === "sources"}
      label="Coverage Map"
      onNavigate={props.onNavigate}
      refTarget={props.coverageMapRef}
      tab="sources"
    />
  </div>
);

const ExpandedQuickNavSection = (props: ExpandedQuickNavProps) => (
  <div className="border-b border-white/10 p-6">
    <h3 className="mb-3 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
      Quick Nav
    </h3>
    <ExpandedQuickNavItems
      coverageMapRef={props.coverageMapRef}
      lensBriefRef={props.lensBriefRef}
      onNavigate={props.onNavigate}
      sidebarTab={props.sidebarTab}
      sourceBreakdownRef={props.sourceBreakdownRef}
      topStoriesRef={props.topStoriesRef}
      trendingTopicsRef={props.trendingTopicsRef}
    />
  </div>
);

const ExpandedAboutHeader = () => (
  <h3 className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
    <Globe2 size={ICON_SIZE - 2} /> About Globe View
  </h3>
);

const ExpandedAboutSection = (
  props: Readonly<Pick<ExpandedLeftSidebarProps, "coverageMapRef" | "onNavigate">>,
) => {
  const { coverageMapRef, onNavigate } = props;
  const handleLearnMore = useCallback(() => {
    onNavigate("sources", coverageMapRef);
  }, [coverageMapRef, onNavigate]);
  return (
    <div className="mt-auto p-6">
      <ExpandedAboutHeader />
      <p className="text-xs leading-relaxed text-muted-foreground">
        Compare how local outlets report on their own country versus how the world covers it.
      </p>
      <button
        type="button"
        onClick={handleLearnMore}
        className="mt-3 inline-flex items-center border-b border-primary/60 pb-0.5 text-xs text-primary hover:opacity-80"
      >
        Learn more →
      </button>
    </div>
  );
};

const ExpandedLeftSidebar = (props: Readonly<ExpandedLeftSidebarProps>) => (
  <div className="flex w-[280px] flex-col overflow-y-auto border-r border-white/10 bg-black/35 backdrop-blur-xl custom-scrollbar">
    <ExpandedFocusSection
      articleCount={props.articleCount}
      focusLabel={props.focusLabel}
      selectedCountryCoverage={props.selectedCountryCoverage}
      selectedCountryMeta={props.selectedCountryMeta}
      sourceCount={props.sourceCount}
      topSources={props.topSources}
    />
    <ExpandedViewsSection onViewModeChange={props.onViewModeChange} viewMode={props.viewMode} />
    <ExpandedQuickNavSection
      coverageMapRef={props.coverageMapRef}
      lensBriefRef={props.lensBriefRef}
      onNavigate={props.onNavigate}
      sidebarTab={props.sidebarTab}
      sourceBreakdownRef={props.sourceBreakdownRef}
      topStoriesRef={props.topStoriesRef}
      trendingTopicsRef={props.trendingTopicsRef}
    />
    <ExpandedAboutSection coverageMapRef={props.coverageMapRef} onNavigate={props.onNavigate} />
  </div>
);

interface ExpandedTopNavProps {
  readonly sidebarTab: string;
  readonly onNavigate: ExpandedLeftSidebarProps["onNavigate"];
  readonly onClose: () => void;
  readonly lensBriefRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly trendingTopicsRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly sourceBreakdownRef: Readonly<RefObject<HTMLDivElement | null>>;
}

const expandedTopNavClassName = (active: boolean): string => {
  if (active) {
    return "border-primary text-primary";
  }
  return "border-transparent text-muted-foreground hover:text-foreground";
};

interface ExpandedTopNavLinkProps {
  readonly active: boolean;
  readonly label: string;
  readonly onNavigate: ExpandedTopNavProps["onNavigate"];
  readonly refTarget: Readonly<RefObject<HTMLDivElement | null>>;
  readonly tab: "briefing" | "intelligence" | "sources";
}

type ExpandedTopNavLinksProps = Pick<
  ExpandedTopNavProps,
  "lensBriefRef" | "onNavigate" | "sidebarTab" | "sourceBreakdownRef" | "trendingTopicsRef"
>;

const ExpandedTopNavLink = (props: Readonly<ExpandedTopNavLinkProps>) => {
  const { onNavigate, refTarget, tab } = props;
  const handleClick = useCallback(() => {
    onNavigate(tab, refTarget);
  }, [onNavigate, refTarget, tab]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "h-full border-b-2 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors",
        expandedTopNavClassName(props.active),
      )}
    >
      {props.label}
    </button>
  );
};

const ExpandedTopNavLinks = (props: Readonly<ExpandedTopNavLinksProps>) => (
  <div className="flex h-14 gap-8">
    <ExpandedTopNavLink
      active={props.sidebarTab === "briefing"}
      label="Briefing"
      onNavigate={props.onNavigate}
      refTarget={props.lensBriefRef}
      tab="briefing"
    />
    <ExpandedTopNavLink
      active={props.sidebarTab === "intelligence"}
      label="Intel"
      onNavigate={props.onNavigate}
      refTarget={props.trendingTopicsRef}
      tab="intelligence"
    />
    <ExpandedTopNavLink
      active={props.sidebarTab === "sources"}
      label="Sources"
      onNavigate={props.onNavigate}
      refTarget={props.sourceBreakdownRef}
      tab="sources"
    />
  </div>
);

const ExpandedTopNavActions = (props: Readonly<Pick<ExpandedTopNavProps, "onClose">>) => {
  const { onClose: handleClose } = props;
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClose}
        className="h-9 rounded-full border-white/10 bg-black/20 px-4 text-xs text-foreground hover:bg-white/5"
      >
        <Globe2 className="mr-2 h-3.5 w-3.5" /> Show Global
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={handleClose}
        className="h-9 w-9 rounded-full border-white/10 bg-black/20 text-foreground hover:bg-white/5"
      >
        <PanelRight size={ICON_SIZE} />
      </Button>
    </div>
  );
};

const ExpandedTopNav = (props: Readonly<ExpandedTopNavProps>) => {
  const { onClose: handleClose, onNavigate: handleNavigate } = props;
  return (
    <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-8 py-0 backdrop-blur-xl">
      <ExpandedTopNavLinks
        lensBriefRef={props.lensBriefRef}
        onNavigate={handleNavigate}
        sidebarTab={props.sidebarTab}
        sourceBreakdownRef={props.sourceBreakdownRef}
        trendingTopicsRef={props.trendingTopicsRef}
      />
      <ExpandedTopNavActions onClose={handleClose} />
    </div>
  );
};

export { ExpandedLeftSidebar, ExpandedTopNav };
