"use client";

import { ArrowRightLeft, Loader2, Newspaper } from "lucide-react";
import type { RefObject } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ClusterArticle } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { ArticleTab } from "./cluster-detail-modal-article";
import { ComparisonTab } from "./cluster-detail-modal-comparison";
import { KeywordsFooter } from "./cluster-detail-modal-footer";
import { ClusterHeader, GdeltContextStrip } from "./cluster-detail-modal-header";
import type {
  ClusterDetailViewProps,
  ComparisonTabProps,
  GdeltContextStripProps,
} from "./cluster-detail-modal-types";

const EMPTY_CLUSTER_ARTICLES: readonly ClusterArticle[] = [];

const getClusterPanelSize = (isExpanded: boolean): string => {
  if (isExpanded) {
    return "w-full h-full max-w-none max-h-none";
  }
  return "max-w-5xl w-full max-h-[90vh]";
};

interface ClusterTabNavigationProps {
  readonly articles: readonly ClusterArticle[];
  readonly onOpenComparison: () => void;
}

const ClusterTabTrigger = ({ article }: Readonly<{ article: ClusterArticle }>) => (
  <TabsTrigger
    value={article.id.toString()}
    className="data-[state=active]:bg-[var(--news-bg-secondary)] data-[state=active]:border-primary/40 border border-transparent px-4 py-2 text-xs font-medium"
  >
    <Newspaper className="w-3 h-3 mr-2" />
    {article.source}
  </TabsTrigger>
);

const ClusterCompareTabTrigger = ({
  onOpenComparison,
}: Readonly<{ onOpenComparison: () => void }>) => (
  <TabsTrigger
    value="compare"
    className="data-[state=active]:bg-[var(--news-bg-secondary)] data-[state=active]:border-primary/40 border border-transparent px-4 py-2 text-xs font-medium"
    onClick={onOpenComparison}
  >
    <ArrowRightLeft className="w-3 h-3 mr-2" />
    Compare Sources
  </TabsTrigger>
);

const ClusterTabList = ({ articles, onOpenComparison }: ClusterTabNavigationProps) => (
  <TabsList className="h-auto p-1 bg-transparent gap-1">
    {articles.map((article) => (
      <ClusterTabTrigger key={`${article.id}-${article.url}`} article={article} />
    ))}
    <ClusterCompareTabTrigger onOpenComparison={onOpenComparison} />
  </TabsList>
);

const ClusterTabNavigation = ({ articles, onOpenComparison }: ClusterTabNavigationProps) => (
  <div className="border-b border-border/60 px-4 flex-shrink-0 overflow-x-auto">
    <ClusterTabList articles={articles} onOpenComparison={onOpenComparison} />
  </div>
);

interface ClusterArticleTabsProps {
  readonly articles: readonly ClusterArticle[];
  readonly activeArticleId: string | null;
  readonly activeContent: string | null | undefined;
  readonly loadingArticle: number | null;
  readonly likedIds: ReadonlySet<number>;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly contentRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly onLike: (articleId: number) => void;
  readonly onQueueToggle: (article: ClusterArticle) => void;
  readonly onClose: () => void;
  readonly onTabChange: (value: string) => void;
  readonly onOpenComparison: () => void;
  readonly comparison: Readonly<ComparisonTabProps>;
}

const ClusterArticleTabs = ({
  articles,
  activeArticleId,
  activeContent,
  loadingArticle,
  likedIds,
  isArticleInQueue,
  contentRef,
  onLike,
  onQueueToggle,
  onClose,
  onTabChange,
  onOpenComparison,
  comparison: { onSourceChange, ...comparison },
}: Readonly<ClusterArticleTabsProps>) => (
  <Tabs
    value={activeArticleId ?? ""}
    onValueChange={onTabChange}
    className="flex-1 flex flex-col overflow-hidden"
  >
    <ClusterTabNavigation articles={articles} onOpenComparison={onOpenComparison} />
    {articles.map((article) => (
      <ArticleTab
        key={`${article.id}-${article.url}`}
        article={article}
        activeContent={activeContent}
        loadingArticleId={loadingArticle}
        likedIds={likedIds}
        isArticleInQueue={isArticleInQueue}
        contentRef={contentRef}
        onLike={onLike}
        onQueueToggle={onQueueToggle}
        onClose={onClose}
      />
    ))}
    <ComparisonTab
      comparisonMode={comparison.comparisonMode}
      comparisonSourceOptions={comparison.comparisonSourceOptions}
      comparisonArticles={comparison.comparisonArticles}
      comparisonError={comparison.comparisonError}
      comparisonData={comparison.comparisonData}
      comparisonLoading={comparison.comparisonLoading}
      articleContents={comparison.articleContents}
      loadingArticle={comparison.loadingArticle}
      detailArticleCount={comparison.detailArticleCount}
      onSourceChange={onSourceChange}
    />
  </Tabs>
);

const ClusterLoadingState = () => (
  <div className="flex-1 flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
    <span className="ml-3 text-muted-foreground">Loading sources...</span>
  </div>
);

const ClusterEmptyState = ({ loadError }: Readonly<{ loadError: string | null }>) => (
  <div className="flex-1 flex items-center justify-center text-muted-foreground">
    {loadError ?? "No articles found for this cluster."}
  </div>
);

const ClusterContextMetrics = ({
  context,
}: Readonly<{ context: GdeltContextStripProps | null }>) => {
  if (context === null) {
    return null;
  }
  return (
    <GdeltContextStrip
      context={context.context}
      cameoSummary={context.cameoSummary}
      toneAvg={context.toneAvg}
      toneDelta={context.toneDelta}
    />
  );
};

interface ClusterDetailBodyProps extends ClusterArticleTabsProps {
  readonly loading: boolean;
  readonly loadError: string | null;
}

const ClusterArticleTabsContainer = ({ model }: Readonly<{ model: ClusterArticleTabsProps }>) => {
  const { onClose, onLike, onOpenComparison, onQueueToggle, onTabChange } = model;
  return (
    <ClusterArticleTabs
      articles={model.articles}
      activeArticleId={model.activeArticleId}
      activeContent={model.activeContent}
      loadingArticle={model.loadingArticle}
      likedIds={model.likedIds}
      isArticleInQueue={model.isArticleInQueue}
      contentRef={model.contentRef}
      onLike={onLike}
      onQueueToggle={onQueueToggle}
      onClose={onClose}
      onTabChange={onTabChange}
      onOpenComparison={onOpenComparison}
      comparison={model.comparison}
    />
  );
};

const ClusterDetailBody = (props: Readonly<ClusterDetailBodyProps>) => {
  if (props.loading) {
    return <ClusterLoadingState />;
  }
  if (props.articles.length === 0) {
    return <ClusterEmptyState loadError={props.loadError} />;
  }
  return <ClusterArticleTabsContainer model={props} />;
};

interface ClusterDetailPanelContentProps {
  readonly model: DeepReadonly<ClusterDetailViewProps>;
}

const ClusterDetailPanelContent = ({ model }: ClusterDetailPanelContentProps) => {
  const { onClose, onLike, onOpenComparison, onQueueToggle, onTabChange } = model;
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <ClusterContextMetrics context={model.context} />
      <ClusterDetailBody
        loading={model.loading}
        articles={model.clusterDetail?.articles ?? EMPTY_CLUSTER_ARTICLES}
        loadError={model.loadError}
        activeArticleId={model.resolvedActiveArticleId}
        activeContent={model.activeContent}
        loadingArticle={model.loadingArticle}
        likedIds={model.likedIds}
        isArticleInQueue={model.isArticleInQueue}
        contentRef={model.contentRef}
        onLike={onLike}
        onQueueToggle={onQueueToggle}
        onClose={onClose}
        onTabChange={onTabChange}
        onOpenComparison={onOpenComparison}
        comparison={model.comparison}
      />
    </div>
  );
};

interface ClusterDetailPanelProps {
  readonly model: DeepReadonly<ClusterDetailViewProps>;
}

const ClusterDetailPanel = ({ model }: ClusterDetailPanelProps) => {
  const { onClose, onToggleExpand } = model;
  return (
    <div
      className={`bg-[var(--news-bg-primary)] border border-border/60 rounded-xl shadow-2xl shadow-black/40 transition-all duration-300 animate-in zoom-in-95 fade-in-0 duration-200 flex flex-col ${getClusterPanelSize(model.isExpanded)}`}
    >
      <ClusterHeader
        isBreaking={model.isBreaking}
        label={model.label}
        cluster={model.cluster}
        isExpanded={model.isExpanded}
        onToggleExpand={onToggleExpand}
        onClose={onClose}
      />
      <ClusterDetailPanelContent model={model} />
      <KeywordsFooter keywords={model.cluster.keywords} />
    </div>
  );
};

interface ClusterDetailViewContainerProps {
  readonly model: DeepReadonly<ClusterDetailViewProps>;
}

const ClusterDetailView = ({ model }: ClusterDetailViewContainerProps) => (
  <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in-0 duration-200">
    <ClusterDetailPanel model={model} />
  </div>
);

export { ClusterDetailView };
