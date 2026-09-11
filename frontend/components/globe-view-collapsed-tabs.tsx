import { AlertCircle, Globe2, Newspaper, Radio, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CountryListItem, NewsArticle } from "@/lib/api";
import type { LensViewMode } from "@/components/globe-ui-state";
import { useCallback } from "react";
import { articleRenderKey, hasCountrySelection } from "@/lib/globe-workspace";
import {
  BriefingArticleCard,
  EMPTY_COUNT,
  FIRST_INDEX,
  ICON_SIZE,
  percentageStyle,
  positiveValueOrFallback,
} from "./globe-view-shared";
import type { CountrySelection } from "@/lib/globe-workspace";
import type { GlobeLensResponse } from "./globe-view-shared";
import { CollapsedLensBrief, CollapsedSpotlightImage } from "./globe-view-collapsed-cards";

interface CollapsedBriefingTabProps {
  readonly viewMode: LensViewMode;
  readonly onViewModeChange: (value: LensViewMode) => void;
  readonly selectedCountry: CountrySelection;
  readonly localLensData: GlobeLensResponse | undefined;
  readonly loading: boolean;
  readonly lensArticles: readonly NewsArticle[];
  readonly selectedCountryMeta: Readonly<CountryListItem> | undefined;
  readonly onArticleSelect: (article: NewsArticle) => void;
  readonly onLoadMore: () => void;
}

const normalizeLensViewMode = (value: string): LensViewMode => {
  if (value === "external") {
    return "external";
  }
  return "internal";
};

const CollapsedBriefingTabList = () => (
  <TabsList className="h-10 w-full rounded-full border border-white/10 bg-black/20 p-1">
    <TabsTrigger
      value="internal"
      className="h-full flex-1 rounded-full text-[10px] sm:text-xs uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all"
    >
      Local Lens
    </TabsTrigger>
    <TabsTrigger
      value="external"
      className="h-full flex-1 rounded-full text-[10px] sm:text-xs uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary transition-all"
    >
      World Lens
    </TabsTrigger>
  </TabsList>
);

const CollapsedBriefingViewTabs = (
  props: Readonly<Pick<CollapsedBriefingTabProps, "viewMode" | "onViewModeChange">>,
) => {
  const { onViewModeChange, viewMode } = props;
  const handleValueChange = useCallback(
    (value: string) => {
      onViewModeChange(normalizeLensViewMode(value));
    },
    [onViewModeChange],
  );
  return (
    <div className="border-b border-white/10 bg-[var(--news-bg-primary)]/30 px-4 py-3">
      <Tabs value={viewMode} onValueChange={handleValueChange} className="w-full">
        <CollapsedBriefingTabList />
      </Tabs>
    </div>
  );
};

const CollapsedBriefingHowToHeader = () => (
  <div className="mb-2 flex items-center gap-2">
    <Globe2 size={ICON_SIZE} className="text-primary" />
    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      How to use it
    </span>
  </div>
);

const CollapsedBriefingHowTo = () => (
  <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-4">
    <CollapsedBriefingHowToHeader />
    <p className="text-sm leading-relaxed text-muted-foreground">
      Pick a country to see two lenses: what its own outlets publish, and how foreign outlets frame
      the same place.
    </p>
  </div>
);

const CollapsedBriefingLoading = () => (
  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
    <Radio className="mb-3 h-8 w-8 animate-pulse opacity-20" />
    <p className="text-xs uppercase tracking-widest">Loading country lens</p>
  </div>
);

const CollapsedNoArticles = () => (
  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
    <Radio className="mb-3 h-8 w-8 opacity-20" />
    <p className="text-xs uppercase tracking-widest">No articles found</p>
  </div>
);

const CollapsedBriefingArticles = (
  props: Readonly<Pick<CollapsedBriefingTabProps, "lensArticles" | "onArticleSelect">>,
) => {
  if (props.lensArticles.length === EMPTY_COUNT) {
    return <CollapsedNoArticles />;
  }
  return (
    <>
      {props.lensArticles.map((article, index) => (
        <BriefingArticleCard
          key={articleRenderKey(article, index)}
          article={article}
          onSelect={props.onArticleSelect}
        />
      ))}
    </>
  );
};

type CollapsedBriefingLoadedProps = Readonly<
  Pick<
    CollapsedBriefingTabProps,
    | "lensArticles"
    | "localLensData"
    | "onArticleSelect"
    | "onLoadMore"
    | "selectedCountry"
    | "selectedCountryMeta"
  >
>;

const CollapsedBriefingLoaded = (props: CollapsedBriefingLoadedProps) => (
  <>
    <CollapsedLensBrief
      localLensData={props.localLensData}
      selectedCountry={props.selectedCountry}
      selectedCountryMeta={props.selectedCountryMeta}
    />
    <CollapsedBriefingArticles
      lensArticles={props.lensArticles}
      onArticleSelect={props.onArticleSelect}
    />
    {props.localLensData?.has_more === true && (
      <Button
        variant="outline"
        size="sm"
        onClick={props.onLoadMore}
        className="w-full rounded-xl border-white/10 hover:bg-white/5"
      >
        Show More Articles
      </Button>
    )}
  </>
);

const CollapsedBriefingContent = (props: Readonly<CollapsedBriefingTabProps>) => {
  if (!hasCountrySelection(props.selectedCountry)) {
    return <CollapsedBriefingHowTo />;
  }
  if (props.loading) {
    return <CollapsedBriefingLoading />;
  }
  return (
    <CollapsedBriefingLoaded
      lensArticles={props.lensArticles}
      localLensData={props.localLensData}
      onArticleSelect={props.onArticleSelect}
      onLoadMore={props.onLoadMore}
      selectedCountry={props.selectedCountry}
      selectedCountryMeta={props.selectedCountryMeta}
    />
  );
};

const CollapsedBriefingTab = (props: Readonly<CollapsedBriefingTabProps>) => (
  <div className="flex h-full min-h-0 flex-col">
    <CollapsedBriefingViewTabs
      onViewModeChange={props.onViewModeChange}
      viewMode={props.viewMode}
    />
    <div className="flex min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-20 custom-scrollbar lg:overflow-y-auto">
      <CollapsedBriefingContent
        lensArticles={props.lensArticles}
        loading={props.loading}
        localLensData={props.localLensData}
        onArticleSelect={props.onArticleSelect}
        onLoadMore={props.onLoadMore}
        onViewModeChange={props.onViewModeChange}
        selectedCountry={props.selectedCountry}
        selectedCountryMeta={props.selectedCountryMeta}
        viewMode={props.viewMode}
      />
    </div>
  </div>
);

interface CollapsedIntelligenceTabProps {
  readonly lensArticles: readonly NewsArticle[];
  readonly selectedCountry: CountrySelection;
  readonly focusLabel: string;
  readonly articleCount: number;
  readonly sourceCount: number;
  readonly sourceSummaryLength: number;
  readonly highPct: number;
  readonly originVolume: number;
  readonly sourceVolume: number;
  readonly mentionVolume: number;
  readonly coverage: number;
  readonly onArticleSelect: (article: NewsArticle) => void;
}

const CollapsedIntelligenceHeader = (
  props: Readonly<{ readonly icon: "spotlight" | "verification" }>,
) => {
  let Icon = ShieldCheck;
  let label = "Verification Signal";
  if (props.icon === "spotlight") {
    Icon = Newspaper;
    label = "Spotlight Story";
  }
  let iconClass = "text-foreground/70";
  if (props.icon === "spotlight") {
    iconClass = "text-primary";
  }
  return (
    <div className="flex items-center gap-2 border-b border-white/10 bg-[var(--news-bg-primary)]/40 p-3">
      <Icon size={ICON_SIZE} className={iconClass} />
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </div>
  );
};

interface CollapsedSpotlightStoryProps {
  readonly article: NewsArticle;
  readonly onSelect: (article: NewsArticle) => void;
}

const CollapsedSpotlightStory = (props: Readonly<CollapsedSpotlightStoryProps>) => {
  const { article, onSelect: selectArticle } = props;
  const handleSelect = useCallback(() => {
    selectArticle(article);
  }, [article, selectArticle]);
  return (
    <button
      type="button"
      className="group w-full cursor-pointer p-4 text-left"
      onClick={handleSelect}
    >
      <CollapsedSpotlightImage article={article} />
      <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
        {article.summary}
      </p>
    </button>
  );
};

const CollapsedSpotlight = (
  props: Readonly<Pick<CollapsedIntelligenceTabProps, "lensArticles" | "onArticleSelect">>,
) => {
  const leadArticle = props.lensArticles[FIRST_INDEX];
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40">
      <CollapsedIntelligenceHeader icon="spotlight" />
      {leadArticle !== undefined && (
        <CollapsedSpotlightStory article={leadArticle} onSelect={props.onArticleSelect} />
      )}
      {leadArticle === undefined && (
        <div className="p-8 text-center text-xs text-muted-foreground">No lead story available</div>
      )}
    </div>
  );
};

const CollapsedVerificationValue = (
  props: Readonly<Pick<CollapsedIntelligenceTabProps, "highPct">>,
) => (
  <div className="flex items-end justify-between">
    <div className="text-3xl font-bold text-foreground">{props.highPct}%</div>
    <div className="mb-1 text-right text-[10px] text-muted-foreground">
      High Credibility
      <br />
      Sources
    </div>
  </div>
);

const CollapsedVerificationBar = (
  props: Readonly<Pick<CollapsedIntelligenceTabProps, "highPct">>,
) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
    <div className="h-full rounded-full bg-white/40" style={percentageStyle(props.highPct)} />
  </div>
);

const CollapsedVerification = (
  props: Readonly<
    Pick<CollapsedIntelligenceTabProps, "highPct" | "lensArticles" | "sourceSummaryLength">
  >,
) => (
  <div className="overflow-hidden rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40">
    <CollapsedIntelligenceHeader icon="verification" />
    <div className="space-y-4 p-4">
      <CollapsedVerificationValue highPct={props.highPct} />
      <CollapsedVerificationBar highPct={props.highPct} />
      <div className="text-xs leading-relaxed text-muted-foreground">
        Based on {props.lensArticles.length} articles from {props.sourceSummaryLength} active
        sources in this lens.
      </div>
    </div>
  </div>
);

interface CollapsedIntelligenceStatProps {
  readonly label: string;
  readonly value: number;
}

const CollapsedIntelligenceStat = (props: Readonly<CollapsedIntelligenceStatProps>) => (
  <div className="rounded-xl border border-white/10 bg-[var(--news-bg-primary)]/40 p-3 text-center">
    <div className="text-xl font-bold">{props.value}</div>
    <div className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">
      {props.label}
    </div>
  </div>
);

const CollapsedIntelligenceStats = (
  props: Readonly<Pick<CollapsedIntelligenceTabProps, "articleCount" | "sourceCount">>,
) => (
  <div className="grid grid-cols-2 gap-3">
    <CollapsedIntelligenceStat label="Total Briefs" value={props.articleCount} />
    <CollapsedIntelligenceStat label="Active Feeds" value={props.sourceCount} />
  </div>
);

const CollapsedReadingAngleHeader = () => (
  <div className="flex items-center gap-2">
    <AlertCircle size={ICON_SIZE} className="text-primary" />
    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      Reading angle
    </span>
  </div>
);
interface CollapsedReadingAngleCardProps {
  readonly label: string;
  readonly value: number;
  readonly suffix: string;
}

const CollapsedReadingAngleCard = (props: Readonly<CollapsedReadingAngleCardProps>) => (
  <div className="rounded-xl border border-white/10 bg-black/40 p-3 backdrop-blur-md">
    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{props.label}</div>
    <div className="mt-2 text-sm text-foreground">
      {props.value} {props.suffix}
    </div>
  </div>
);

type CollapsedReadingAngleProps = Readonly<
  Pick<
    CollapsedIntelligenceTabProps,
    "coverage" | "focusLabel" | "mentionVolume" | "originVolume" | "sourceVolume"
  >
>;

const CollapsedReadingAngle = (props: CollapsedReadingAngleProps) => {
  const localVolume = positiveValueOrFallback(props.originVolume, props.sourceVolume);
  const worldVolume = positiveValueOrFallback(props.mentionVolume, props.coverage);
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md">
      <CollapsedReadingAngleHeader />
      <p className="text-sm leading-relaxed text-muted-foreground">
        Local Lens shows coverage from inside {props.focusLabel}. World Lens keeps the country fixed
        but swaps the narrators to outside sources.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <CollapsedReadingAngleCard
          label="Local lens"
          suffix="source-origin signals"
          value={localVolume}
        />
        <CollapsedReadingAngleCard
          label="World lens"
          suffix="article mentions in window"
          value={worldVolume}
        />
      </div>
    </div>
  );
};

const CollapsedIntelligenceTab = (props: Readonly<CollapsedIntelligenceTabProps>) => (
  <div className="flex-1 space-y-6 p-4 pb-20 custom-scrollbar lg:overflow-y-auto">
    <CollapsedSpotlight lensArticles={props.lensArticles} onArticleSelect={props.onArticleSelect} />
    <CollapsedVerification
      highPct={props.highPct}
      lensArticles={props.lensArticles}
      sourceSummaryLength={props.sourceSummaryLength}
    />
    <CollapsedIntelligenceStats articleCount={props.articleCount} sourceCount={props.sourceCount} />
    {hasCountrySelection(props.selectedCountry) && (
      <CollapsedReadingAngle
        coverage={props.coverage}
        focusLabel={props.focusLabel}
        mentionVolume={props.mentionVolume}
        originVolume={props.originVolume}
        sourceVolume={props.sourceVolume}
      />
    )}
  </div>
);

const COLLAPSED_SOURCE_LIMIT = 10;
const GLOBAL_COLLAPSED_SOURCE_LIMIT = 8;

export {
  CollapsedBriefingTab,
  CollapsedIntelligenceTab,
  COLLAPSED_SOURCE_LIMIT,
  GLOBAL_COLLAPSED_SOURCE_LIMIT,
};
