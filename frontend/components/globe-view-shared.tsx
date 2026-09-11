"use client";

import { Lamp, X } from "lucide-react";
import type { NewsArticle } from "@/lib/api";
import type { CountrySelection, ReadonlyCountryArticleCounts } from "@/lib/globe-workspace";
import { briefingDescriptionFor, hasCountrySelection, sourceLabel } from "@/lib/globe-workspace";
import type { LightingMode } from "@/components/globe-ui-state";
import { Badge } from "@/components/ui/badge";
import { SafeImage } from "@/components/safe-image";
import { formatArticleDateTime } from "@/lib/date-formatters";
import { isUsableImage } from "@/lib/article-image";
import { cn } from "@/lib/utils";
import { useCallback } from "react";

interface GlobeLensResponse {
  readonly country_code: string;
  readonly country_name?: string;
  readonly view: "internal" | "external";
  readonly view_description: string;
  readonly matching_strategy?: string;
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly has_more: boolean;
  readonly source_count?: number;
  readonly window_hours?: number | null;
  readonly geo_signal?: Readonly<{ readonly id: string; readonly label: string }>;
  readonly articles: readonly NewsArticle[];
}

const ARTICLE_CARD_IMAGE_SIZE = 64;
const ARTICLE_COUNTRY_LIMIT = 4;
const COVERAGE_LIMIT = 6;
const EMPTY_COUNT = 0;
const FIRST_INDEX = 0;
const ICON_SIZE = 14;
const MAX_PERCENT = 100;
const MIN_COVERAGE_BAR = 12;
const TOP_SOURCE_LIMIT = 5;

interface PercentageStyle {
  readonly width: string;
}

const COVERAGE_SEGMENTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const INTENSITY_SEGMENTS = [1, 2, 3, 4, 5] as const;
const percentageStyle = (percentage: number): PercentageStyle => ({
  width: `${percentage}%`,
});

const activeSegmentClassName = (isActive: boolean): string => {
  if (isActive) {
    return "bg-primary";
  }
  return "bg-white/10";
};

const positiveValueOrFallback = (value: number, fallback: number): number => {
  if (value > EMPTY_COUNT) {
    return value;
  }
  return fallback;
};

const coverageSegmentCount = (
  selectedCoverage: number,
  metrics: ReadonlyCountryArticleCounts,
): number => {
  const maximumCoverage = Math.max(...Object.values(metrics.counts), 1);
  return Math.min(
    COVERAGE_SEGMENTS.length,
    Math.ceil((selectedCoverage / maximumCoverage) * COVERAGE_SEGMENTS.length),
  );
};

interface FloatingHeaderProps {
  readonly articleCount: number;
  readonly focusLabel: string;
  readonly globalArticleCount: number;
  readonly isFocusExpanded: boolean;
  readonly localLensData: GlobeLensResponse | undefined;
  readonly onResetFocus: () => void;
  readonly selectedCountry: CountrySelection;
}

const floatingHeaderVisibility = (
  isFocusExpanded: boolean,
  selectedCountry: CountrySelection,
): string => {
  if (isFocusExpanded) {
    return "opacity-0";
  }
  if (hasCountrySelection(selectedCountry)) {
    return "opacity-0 lg:opacity-100";
  }
  return "opacity-100";
};

const floatingHeaderScale = (selectedCountry: CountrySelection): string => {
  if (hasCountrySelection(selectedCountry)) {
    return "scale-95 lg:scale-100";
  }
  return "scale-100";
};

const FloatingHeaderMeta = (
  props: Readonly<
    Pick<FloatingHeaderProps, "articleCount" | "globalArticleCount" | "selectedCountry">
  >,
) => {
  const { articleCount, globalArticleCount, selectedCountry } = props;
  let countLabel = `${globalArticleCount} live articles`;
  if (hasCountrySelection(selectedCountry)) {
    countLabel = `${articleCount} lens articles`;
  }
  return (
    <div className="flex items-center gap-2 lg:gap-3">
      <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-primary">
        Global Desk
      </span>
      <span className="font-mono text-[9px] lg:text-[10px] uppercase tracking-widest text-muted-foreground">
        {countLabel}
      </span>
    </div>
  );
};

const FloatingHeaderReset = (props: Readonly<Pick<FloatingHeaderProps, "onResetFocus">>) => (
  <button
    type="button"
    onClick={props.onResetFocus}
    className="group mt-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground transition-colors hover:text-primary"
  >
    <X size={ICON_SIZE - 2} className="transition-transform group-hover:rotate-90" />
    Reset Focus
  </button>
);

const FloatingHeaderCard = (
  props: Readonly<
    Pick<
      FloatingHeaderProps,
      | "articleCount"
      | "focusLabel"
      | "globalArticleCount"
      | "localLensData"
      | "onResetFocus"
      | "selectedCountry"
    >
  >,
) => {
  const {
    articleCount,
    focusLabel,
    globalArticleCount,
    localLensData,
    onResetFocus,
    selectedCountry,
  } = props;
  return (
    <div
      className={cn(
        "pointer-events-auto max-w-full space-y-2 rounded-2xl border border-white/10 bg-black/40 p-4 shadow-2xl backdrop-blur-xl transition-transform duration-500 lg:max-w-[31rem] lg:space-y-3 lg:p-6",
        floatingHeaderScale(selectedCountry),
      )}
    >
      <FloatingHeaderMeta
        articleCount={articleCount}
        globalArticleCount={globalArticleCount}
        selectedCountry={selectedCountry}
      />
      <h2 className="font-serif text-3xl font-semibold tracking-tight text-foreground drop-shadow-md lg:text-5xl">
        {focusLabel}
      </h2>
      <p className="max-w-[20rem] text-xs leading-relaxed text-foreground/75 lg:max-w-md lg:text-sm">
        {briefingDescriptionFor(selectedCountry, localLensData)}
      </p>
      {hasCountrySelection(selectedCountry) && <FloatingHeaderReset onResetFocus={onResetFocus} />}
    </div>
  );
};

const FloatingHeader = (props: Readonly<FloatingHeaderProps>) => (
  <div
    className={cn(
      "pointer-events-none absolute left-3 right-3 top-3 z-10 hidden transition-all duration-500 lg:left-8 lg:right-auto lg:top-8 lg:block",
      floatingHeaderVisibility(props.isFocusExpanded, props.selectedCountry),
    )}
  >
    <FloatingHeaderCard
      articleCount={props.articleCount}
      focusLabel={props.focusLabel}
      globalArticleCount={props.globalArticleCount}
      localLensData={props.localLensData}
      onResetFocus={props.onResetFocus}
      selectedCountry={props.selectedCountry}
    />
  </div>
);

interface IntensityPanelProps {
  readonly heatLabel: string;
  readonly isFocusExpanded: boolean;
  readonly lightingMode: LightingMode;
  readonly onLightingChange: (mode: LightingMode) => void;
}

const IntensitySegments = () => (
  <div className="flex gap-1">
    <div className="h-1.5 w-3 rounded-sm bg-primary/20" />
    <div className="h-1.5 w-3 rounded-sm bg-primary/40" />
    <div className="h-1.5 w-3 rounded-sm bg-primary/60" />
    <div className="h-1.5 w-3 rounded-sm bg-primary/80" />
    <div className="h-1.5 w-3 rounded-sm bg-primary" />
  </div>
);

const IntensityLegend = (props: Readonly<Pick<IntensityPanelProps, "heatLabel">>) => (
  <div className="flex items-center gap-6">
    <div className="flex items-center gap-2">
      <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground/80">
        {props.heatLabel}
      </span>
    </div>
    <div className="h-4 w-px bg-white/10" />
    <div className="flex items-center gap-3">
      <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
        Intensity
      </span>
      <IntensitySegments />
    </div>
  </div>
);

interface LightingButtonsProps {
  readonly lightingMode: LightingMode;
  readonly onAllLit: () => void;
  readonly onDayNight: () => void;
}

const lightingButtonClassName = (active: boolean): string => {
  if (active) {
    return "bg-white/10 text-foreground";
  }
  return "text-muted-foreground hover:text-foreground";
};

const LightingButtons = (props: Readonly<LightingButtonsProps>) => (
  <div className="inline-flex rounded-full border border-white/10 bg-black/20 p-1">
    <button
      type="button"
      onClick={props.onAllLit}
      className={cn(
        "rounded-full px-3 py-1 text-[9px] font-mono uppercase tracking-[0.18em] transition-colors",
        lightingButtonClassName(props.lightingMode === "all-lit"),
      )}
    >
      All Lit
    </button>
    <button
      type="button"
      onClick={props.onDayNight}
      className={cn(
        "rounded-full px-3 py-1 text-[9px] font-mono uppercase tracking-[0.18em] transition-colors",
        lightingButtonClassName(props.lightingMode === "day-night"),
      )}
    >
      Day/Night
    </button>
  </div>
);

const LightingControls = (
  props: Readonly<Pick<IntensityPanelProps, "lightingMode" | "onLightingChange">>,
) => {
  const { lightingMode, onLightingChange } = props;
  const handleAllLit = useCallback(() => {
    onLightingChange("all-lit");
  }, [onLightingChange]);
  const handleDayNight = useCallback(() => {
    onLightingChange("day-night");
  }, [onLightingChange]);
  return (
    <div className="flex items-center gap-2">
      <Lamp className="h-3.5 w-3.5 text-foreground/55" />
      <LightingButtons
        lightingMode={lightingMode}
        onAllLit={handleAllLit}
        onDayNight={handleDayNight}
      />
    </div>
  );
};

const intensityPanelVisibility = (isFocusExpanded: boolean): string => {
  if (isFocusExpanded) {
    return "opacity-0";
  }
  return "opacity-100";
};

const IntensityPanel = (props: Readonly<IntensityPanelProps>) => (
  <div
    className={cn(
      "absolute bottom-8 left-8 z-10 hidden transition-opacity duration-500 lg:block",
      intensityPanelVisibility(props.isFocusExpanded),
    )}
  >
    <div className="flex items-center gap-6 rounded-2xl border border-white/10 bg-black/40 px-5 py-3.5 shadow-2xl backdrop-blur-xl">
      <IntensityLegend heatLabel={props.heatLabel} />
      <LightingControls
        lightingMode={props.lightingMode}
        onLightingChange={props.onLightingChange}
      />
    </div>
  </div>
);

interface BriefingArticleCardProps {
  readonly article: NewsArticle;
  readonly onSelect: (article: NewsArticle) => void;
}

const BriefingArticleMeta = (props: Readonly<{ readonly article: NewsArticle }>) => (
  <div className="mb-2 flex items-center gap-2">
    <Badge
      variant="outline"
      className="h-4 rounded-full border-white/10 py-0 text-[8px] uppercase tracking-wider text-muted-foreground group-hover:border-white/40 group-hover:text-foreground"
    >
      {sourceLabel(props.article)}
    </Badge>
    <span className="text-[9px] text-muted-foreground">
      {formatArticleDateTime(props.article.publishedAt)}
    </span>
  </div>
);

const BriefingArticleTags = (props: Readonly<{ readonly article: NewsArticle }>) => {
  const { article } = props;
  const hasGeoSignal = article.geo_signal !== undefined;
  const hasMentionedCountries =
    article.mentioned_countries !== undefined && article.mentioned_countries.length > EMPTY_COUNT;
  if (!hasGeoSignal && !hasMentionedCountries) {
    return null;
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {hasGeoSignal && (
        <Badge
          variant="outline"
          className="rounded-full border-white/10 bg-white/5 text-[9px] uppercase tracking-wider text-muted-foreground"
        >
          {article.geo_signal?.label}
        </Badge>
      )}
      {hasMentionedCountries &&
        article.mentioned_countries?.slice(0, ARTICLE_COUNTRY_LIMIT).map((countryCode) => (
          <Badge
            key={`${article.id}-${countryCode}`}
            variant="outline"
            className="rounded-full border-white/10 bg-white/5 text-[9px] uppercase tracking-wider text-muted-foreground"
          >
            {countryCode}
          </Badge>
        ))}
    </div>
  );
};

const BriefingArticleCopy = (props: Readonly<BriefingArticleCardProps>) => (
  <div className="min-w-0 flex-1">
    <BriefingArticleMeta article={props.article} />
    <h4 className="font-serif text-sm font-medium leading-snug transition-colors group-hover:text-foreground">
      {props.article.title}
    </h4>
    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
      {props.article.summary}
    </p>
    <BriefingArticleTags article={props.article} />
  </div>
);

const BriefingArticleImage = (props: Readonly<{ readonly article: NewsArticle }>) => {
  if (!isUsableImage(props.article.image)) {
    return null;
  }
  return (
    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[var(--news-bg-primary)]/40">
      <SafeImage
        src={props.article.image}
        alt=""
        width={ARTICLE_CARD_IMAGE_SIZE}
        height={ARTICLE_CARD_IMAGE_SIZE}
        className="h-full w-full object-cover opacity-70 transition-opacity group-hover:opacity-100"
      />
    </div>
  );
};

const BriefingArticleCard = (props: Readonly<BriefingArticleCardProps>) => {
  const { article, onSelect: selectArticle } = props;
  const handleSelect = useCallback(() => {
    selectArticle(article);
  }, [article, selectArticle]);
  return (
    <button
      type="button"
      onClick={handleSelect}
      className="group w-full cursor-pointer rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-4 text-left transition-all hover:scale-[1.02] hover:border-white/40 hover:bg-[var(--news-bg-primary)]"
    >
      <div className="flex items-start justify-between gap-3">
        <BriefingArticleCopy article={article} onSelect={selectArticle} />
        <BriefingArticleImage article={article} />
      </div>
    </button>
  );
};

const getSheetToggleLabel = (isExpanded: boolean): string => {
  if (isExpanded) {
    return "Collapse globe briefing";
  }
  return "Expand globe briefing";
};

export {
  BriefingArticleCard,
  FloatingHeader,
  IntensityPanel,
  activeSegmentClassName,
  coverageSegmentCount,
  getSheetToggleLabel,
  percentageStyle,
  positiveValueOrFallback,
  COVERAGE_LIMIT,
  COVERAGE_SEGMENTS,
  EMPTY_COUNT,
  FIRST_INDEX,
  ICON_SIZE,
  INTENSITY_SEGMENTS,
  MAX_PERCENT,
  MIN_COVERAGE_BAR,
  TOP_SOURCE_LIMIT,
};
export type { FloatingHeaderProps, GlobeLensResponse, IntensityPanelProps };
