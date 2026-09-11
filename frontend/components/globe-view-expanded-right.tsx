import { Badge } from "@/components/ui/badge";
import { Globe2,MapPin } from "lucide-react";
import { useCallback } from "react";
import type { RefObject } from "react";
import type { LightingMode } from "@/components/globe-ui-state";
import type { ReadonlyCountryArticleCounts,SourceSummaryEntry } from "@/lib/globe-workspace";
import { cn } from "@/lib/utils";
import {
activeSegmentClassName,
coverageSegmentCount,
COVERAGE_SEGMENTS,
INTENSITY_SEGMENTS,
TOP_SOURCE_LIMIT,
} from "./globe-view-shared";

interface ExpandedRightSidebarProps {
  readonly focusLabel: string;
  readonly articleCount: number;
  readonly sourceCount: number;
  readonly selectedCountryCoverage: number;
  readonly topSources: readonly SourceSummaryEntry[];
  readonly viewMode: "internal" | "external";
  readonly onViewModeChange: (value: "internal" | "external") => void;
  readonly lightingMode: LightingMode;
  readonly onLightingChange: (mode: LightingMode) => void;
  readonly intensityScore: number;
  readonly countryMetrics: ReadonlyCountryArticleCounts;
  readonly onScrollTo: (ref: Readonly<RefObject<HTMLDivElement | null>>) => void;
  readonly lensBriefRef: Readonly<RefObject<HTMLDivElement | null>>;
}

const expandedLensButtonClassName = (isActive: boolean): string => {
  if (isActive) {
    return "min-w-0 rounded-xl px-3 py-2.5 text-[9px] uppercase tracking-[0.1em] leading-none text-center whitespace-nowrap transition-colors bg-[rgba(186,137,63,0.18)] text-[#e5c27a]";
  }
  return "min-w-0 rounded-xl px-3 py-2.5 text-[9px] uppercase tracking-[0.1em] leading-none text-center whitespace-nowrap transition-colors text-muted-foreground hover:bg-white/5 hover:text-foreground";
};

const expandedLightingButtonClassName = (isActive: boolean, hasBorder: boolean): string => {
  let borderClass = "";
  if (hasBorder) {
    borderClass = " border-r border-white/10";
  }
  let stateClass = " text-muted-foreground hover:bg-white/5 hover:text-foreground";
  if (isActive) {
    stateClass = " bg-primary/10 text-primary";
  }
  return `px-2 py-3 text-[9px] uppercase tracking-[0.18em] whitespace-nowrap transition-colors${borderClass}${stateClass}`;
};

type ExpandedTopSourcesProps = Readonly<
  Pick<ExpandedRightSidebarProps, "sourceCount" | "topSources">
>;

const ExpandedTopSources = (props: ExpandedTopSourcesProps) => (
  <div className="mb-6 max-h-[72px] overflow-y-auto pr-1 custom-scrollbar flex flex-wrap gap-1.5">
    {props.topSources.map((source) => (
      <Badge
        variant="outline"
        key={source.name}
        className="text-[9px] uppercase tracking-wider rounded-full border-primary/20 bg-primary/10 text-primary px-2 py-0.5"
      >
        {source.name} · {source.count}
      </Badge>
    ))}
    {props.sourceCount > TOP_SOURCE_LIMIT && (
      <Badge
        variant="outline"
        className="text-[9px] uppercase tracking-wider rounded-full border-white/10 bg-white/5 text-muted-foreground px-2 py-0.5"
      >
        + {props.sourceCount - TOP_SOURCE_LIMIT} More
      </Badge>
    )}
  </div>
);

const ExpandedGuideCard = () => (
  <div className="p-5 rounded-2xl border border-white/10 bg-black/30 mb-5 flex items-start gap-3">
    <MapPin size={16} className="mt-0.5 text-primary shrink-0" />
    <p className="text-xs text-muted-foreground">
      Use the globe as the country navigator. Hover to inspect coverage heat, then click a country
      to open its local and world lens.
    </p>
  </div>
);

type ExpandedRightSidebarContentProps = Readonly<{
  readonly sidebar: ExpandedRightSidebarProps;
  readonly coverageCount: number;
  readonly onAllLit: () => void;
  readonly onDayNight: () => void;
  readonly onExternalLens: () => void;
  readonly onGuideClick: () => void;
  readonly onInternalLens: () => void;
}>;

type ExpandedRightSidebarFocusProps = Readonly<
  Pick<ExpandedRightSidebarProps, "articleCount" | "focusLabel" | "selectedCountryCoverage" | "sourceCount">
>;

const ExpandedRightSidebarFocus = (props: ExpandedRightSidebarFocusProps) => (
  <>
    <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3">
      Focus
    </h3>
    <h2 className="font-serif text-2xl mb-2 text-foreground">{props.focusLabel}</h2>
    <div className="text-[10px] text-muted-foreground mb-5">
      {props.articleCount} articles · {props.sourceCount} sources · {props.selectedCountryCoverage} coverage heat
    </div>
    <div className="p-5 rounded-2xl border border-white/10 bg-black/30 text-sm text-muted-foreground leading-relaxed mb-5">
      This lens shows how news sources based in {props.focusLabel} report on their own country.
    </div>
  </>
);

type ExpandedLensControlsProps = Readonly<{
  readonly onExternalLens: () => void;
  readonly onInternalLens: () => void;
  readonly viewMode: "internal" | "external";
}>;

const ExpandedLensControls = (props: ExpandedLensControlsProps) => {
  const {
    onExternalLens: handleExternalLens,
    onInternalLens: handleInternalLens,
  } = props;
  return (
    <>
      <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3">
        Lens Controls
      </h3>
      <div className="grid grid-cols-2 gap-0 rounded-2xl border border-white/10 overflow-hidden mb-8 bg-black/30 p-1">
        <button
          onClick={handleInternalLens}
          className={expandedLensButtonClassName(props.viewMode === "internal")}
        >
          Local Lens
        </button>
        <button
          onClick={handleExternalLens}
          className={expandedLensButtonClassName(props.viewMode === "external")}
        >
          World Lens
        </button>
      </div>
    </>
  );
};

type ExpandedGuideLinkProps = Readonly<{
  readonly onGuideClick: () => void;
}>;

const ExpandedGuideLink = (props: ExpandedGuideLinkProps) => {
  const { onGuideClick: handleGuideClick } = props;
  return (
    <>
      <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2">
        <Globe2 size={12} /> How to use it
      </h3>
      <p className="text-xs text-muted-foreground leading-relaxed mb-2">
        Pick a country to see two lenses: what its own outlets publish, and how foreign outlets frame
        the same place.
      </p>
      <button
        onClick={handleGuideClick}
        className="text-primary border-b border-primary/60 text-[10px] uppercase tracking-widest mb-6 inline-block pb-0.5 hover:opacity-80 w-max"
      >
        View guide →
      </button>
    </>
  );
};

type ExpandedCoverageMeterProps = Readonly<{
  readonly coverageCount: number;
  readonly selectedCountryCoverage: number;
}>;

const ExpandedCoverageMeter = (props: ExpandedCoverageMeterProps) => (
  <>
    <div className="flex justify-between items-end mb-3">
      <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        Coverage Heat
      </h3>
      <span className="text-sm font-mono text-foreground">{props.selectedCountryCoverage}</span>
    </div>
    <div className="flex gap-1 mb-2">
      {COVERAGE_SEGMENTS.map((segment) => (
        <div
          key={segment}
          className={cn("h-1.5 flex-1 rounded-full", activeSegmentClassName(segment <= props.coverageCount))}
        />
      ))}
    </div>
    <div className="flex justify-between text-[8px] uppercase tracking-widest text-muted-foreground mb-6">
      <span>Low</span>
      <span>High</span>
    </div>
  </>
);

const ExpandedIntensityMeter = (props: Readonly<{ readonly intensityScore: number }>) => (
  <>
    <div className="flex justify-between items-end mb-3">
      <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
        Intensity
      </h3>
      <span className="text-sm font-mono text-foreground">{props.intensityScore}/5</span>
    </div>
    <div className="flex gap-1 mb-6">
      {INTENSITY_SEGMENTS.map((segment) => (
        <div
          key={segment}
          className={cn("h-1.5 flex-1 rounded-full", activeSegmentClassName(segment <= props.intensityScore))}
        />
      ))}
    </div>
  </>
);

type ExpandedLightingControlsProps = Readonly<{
  readonly lightingMode: LightingMode;
  readonly onAllLit: () => void;
  readonly onDayNight: () => void;
}>;

const ExpandedLightingControls = (props: ExpandedLightingControlsProps) => {
  const {
    onAllLit: handleAllLit,
    onDayNight: handleDayNight,
  } = props;
  return (
    <div className="grid grid-cols-2 gap-0 rounded-2xl border border-white/10 overflow-hidden mt-auto bg-black/30">
      <button
        onClick={handleAllLit}
        className={expandedLightingButtonClassName(props.lightingMode === "all-lit", true)}
      >
        All Lit
      </button>
      <button
        onClick={handleDayNight}
        className={expandedLightingButtonClassName(props.lightingMode === "day-night", false)}
      >
        Day / Night
      </button>
    </div>
  );
};

const ExpandedRightSidebarContent = (props: ExpandedRightSidebarContentProps) => {
  const {
    onAllLit: handleAllLit,
    onDayNight: handleDayNight,
    onExternalLens: handleExternalLens,
    onGuideClick: handleGuideClick,
    onInternalLens: handleInternalLens,
  } = props;
  const { articleCount, focusLabel, intensityScore, lightingMode, selectedCountryCoverage, sourceCount, topSources, viewMode } = props.sidebar;
  return (
    <div className="w-[320px] border-l border-white/10 p-5 flex flex-col overflow-y-auto custom-scrollbar bg-black/35 backdrop-blur-xl">
    <ExpandedRightSidebarFocus
      articleCount={articleCount}
      focusLabel={focusLabel}
      selectedCountryCoverage={selectedCountryCoverage}
      sourceCount={sourceCount}
    />
    <ExpandedGuideCard />
    <ExpandedTopSources sourceCount={sourceCount} topSources={topSources} />
    <ExpandedLensControls
      onExternalLens={handleExternalLens}
      onInternalLens={handleInternalLens}
      viewMode={viewMode}
    />
    <ExpandedGuideLink onGuideClick={handleGuideClick} />
    <ExpandedCoverageMeter
      coverageCount={props.coverageCount}
      selectedCountryCoverage={selectedCountryCoverage}
    />
    <ExpandedIntensityMeter intensityScore={intensityScore} />
    <ExpandedLightingControls
      lightingMode={lightingMode}
      onAllLit={handleAllLit}
      onDayNight={handleDayNight}
    />
    </div>
  );
};

const ExpandedRightSidebar = (props: Readonly<ExpandedRightSidebarProps>) => {
  const { countryMetrics, lensBriefRef, onLightingChange, onScrollTo, onViewModeChange } = props;
  const coverageCount = coverageSegmentCount(props.selectedCountryCoverage, countryMetrics);
  const handleInternalLens = useCallback(() => {
    onViewModeChange("internal");
  }, [onViewModeChange]);
  const handleExternalLens = useCallback(() => {
    onViewModeChange("external");
  }, [onViewModeChange]);
  const handleGuideClick = useCallback(() => {
    onScrollTo(lensBriefRef);
  }, [lensBriefRef, onScrollTo]);
  const handleAllLit = useCallback(() => {
    onLightingChange("all-lit");
  }, [onLightingChange]);
  const handleDayNight = useCallback(() => {
    onLightingChange("day-night");
  }, [onLightingChange]);
  return (
    <ExpandedRightSidebarContent
      coverageCount={coverageCount}
      onAllLit={handleAllLit}
      onDayNight={handleDayNight}
      onExternalLens={handleExternalLens}
      onGuideClick={handleGuideClick}
      onInternalLens={handleInternalLens}
      sidebar={props}
    />
  );
};

export { ExpandedRightSidebar };
