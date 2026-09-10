import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import type { ViewMode } from "@/components/global-navigation";
import { GridView } from "@/components/grid-view";
import { Skeleton } from "@/components/ui/skeleton";
import type { NewsArticle } from "@/lib/api";

const loadGlobeView = async () => {
  const globeModule = await import("@/components/globe-view");
  return globeModule.GlobeView;
};
const loadFeedView = async () => {
  const feedModule = await import("@/components/feed-view");
  return feedModule.FeedView;
};
const loadBlindspotView = async () => {
  const blindspotModule = await import("@/components/blindspot-view");
  return blindspotModule.BlindspotView;
};
const loadLiveNewsView = async () => {
  const liveNewsModule = await import("@/components/live-news-view");
  return liveNewsModule.LiveNewsView;
};

const DynamicGlobeView = dynamic(loadGlobeView, {
  loading: () => <Skeleton className="h-[400px] w-full" />,
  ssr: false,
});
const DynamicFeedView = dynamic(loadFeedView, {
  loading: () => <Skeleton className="h-[400px] w-full" />,
  ssr: false,
});
const DynamicBlindspotView = dynamic(loadBlindspotView, {
  loading: () => <Skeleton className="h-[400px] w-full" />,
  ssr: false,
});
const DynamicLiveNewsView = dynamic(loadLiveNewsView, {
  loading: () => <Skeleton className="h-[400px] w-full" />,
  ssr: false,
});

type ReadonlyNewsArticleList = readonly Readonly<NewsArticle>[];

interface ActiveViewProps {
  readonly currentView: ViewMode;
  readonly categoryId: string;
  readonly activeCategory: string;
  readonly articles: ReadonlyNewsArticleList;
  readonly loading: boolean;
  readonly totalCount: number;
  readonly topicSortMode: "sources" | "articles" | "recent";
  readonly gridMode: "source" | "topic";
  readonly onGridModeChange: (mode: "source" | "topic") => void;
  readonly debugMode: boolean;
  readonly selectedSourceIds: readonly string[];
}

const GlobeActiveView = (
  props: Readonly<Pick<ActiveViewProps, "categoryId" | "articles" | "loading">>,
) => (
  <DynamicGlobeView
    key={`${props.categoryId}-globe`}
    articles={props.articles}
    loading={props.loading}
  />
);

const GridActiveView = (
  props: Readonly<
    Pick<
      ActiveViewProps,
      "articles" | "loading" | "topicSortMode" | "gridMode" | "onGridModeChange" | "totalCount"
    >
  >,
) => (
  <GridView
    articles={props.articles}
    loading={props.loading}
    showTrending
    topicSortMode={props.topicSortMode}
    viewMode={props.gridMode}
    onViewModeChange={props.onGridModeChange}
    isScrollMode={false}
    totalCount={props.totalCount}
  />
);

const ScrollActiveView = (
  props: Readonly<
    Pick<ActiveViewProps, "categoryId" | "articles" | "loading" | "totalCount" | "debugMode">
  >,
) => (
  <DynamicFeedView
    key={`${props.categoryId}-scroll`}
    articles={props.articles}
    loading={props.loading}
    totalCount={props.totalCount}
    debugMode={props.debugMode}
  />
);

const BlindspotActiveView = (
  props: Readonly<Pick<ActiveViewProps, "categoryId" | "activeCategory" | "selectedSourceIds">>,
) => (
  <DynamicBlindspotView
    key={`${props.categoryId}-blindspot`}
    category={props.activeCategory}
    sources={props.selectedSourceIds}
  />
);

const LiveNewsActiveView = (
  props: Readonly<Pick<ActiveViewProps, "categoryId" | "articles" | "loading">>,
) => (
  <DynamicLiveNewsView
    key={`${props.categoryId}-live-news`}
    articles={props.articles}
    loading={props.loading}
  />
);

type ActiveViewRenderer = (props: Readonly<ActiveViewProps>) => ReactNode;

const ACTIVE_VIEW_RENDERERS = {
  blindspot: (props) => (
    <BlindspotActiveView
      activeCategory={props.activeCategory}
      categoryId={props.categoryId}
      selectedSourceIds={props.selectedSourceIds}
    />
  ),
  globe: (props) => (
    <GlobeActiveView
      articles={props.articles}
      categoryId={props.categoryId}
      loading={props.loading}
    />
  ),
  grid: (props) => {
    const handleGridModeChange = props.onGridModeChange;
    return (
      <GridActiveView
        articles={props.articles}
        gridMode={props.gridMode}
        loading={props.loading}
        onGridModeChange={handleGridModeChange}
        topicSortMode={props.topicSortMode}
        totalCount={props.totalCount}
      />
    );
  },
  "live-news": (props) => (
    <LiveNewsActiveView
      articles={props.articles}
      categoryId={props.categoryId}
      loading={props.loading}
    />
  ),
  scroll: (props) => (
    <ScrollActiveView
      articles={props.articles}
      categoryId={props.categoryId}
      debugMode={props.debugMode}
      loading={props.loading}
      totalCount={props.totalCount}
    />
  ),
} satisfies Record<ViewMode, ActiveViewRenderer>;

const ActiveView = (props: Readonly<ActiveViewProps>) =>
  ACTIVE_VIEW_RENDERERS[props.currentView](props);

export {
  ActiveView,
  type ActiveViewProps,
  loadBlindspotView,
  loadFeedView,
  loadGlobeView,
  loadLiveNewsView,
};
