"use client";

import { Loader2 } from "lucide-react";
import { useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { ComparisonArticleColumn } from "./cluster-detail-modal-comparison-articles";
import {
  ComparisonSummary,
  EntitiesBlock,
  KeywordsBlock,
} from "./cluster-detail-modal-comparison-analysis";
import type { ComparisonSourceOption } from "@/lib/cluster-comparison";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type {
  ComparisonArticle,
  ComparisonData,
  ComparisonTabProps,
} from "./cluster-detail-modal-types";

const comparisonArticleSourceId = (article: ComparisonArticle): string =>
  article.source_id ?? article.source.trim().toLowerCase().replaceAll(/\s+/gu, "-");

interface ComparisonSourceSelectProps {
  readonly selectedArticleId: string | undefined;
  readonly sourceOption: ComparisonSourceOption<ComparisonArticle>;
  readonly onSourceChange: (sourceId: string, articleId: string) => void;
}

const ComparisonSourceSelect = ({
  selectedArticleId,
  sourceOption,
  onSourceChange,
}: DeepReadonly<ComparisonSourceSelectProps>) => {
  const handleValueChange = useCallback(
    (value: string) => {
      onSourceChange(sourceOption.sourceId, value);
    },
    [onSourceChange, sourceOption.sourceId],
  );
  return (
    <Select value={selectedArticleId} onValueChange={handleValueChange}>
      <ComparisonSelectTrigger />
      <ComparisonSelectContent articles={sourceOption.articles} />
    </Select>
  );
};

const ComparisonSelectTrigger = () => (
  <SelectTrigger className="w-full border-border/60 bg-[var(--news-bg-primary)] text-left text-xs">
    <SelectValue placeholder="Choose article" />
  </SelectTrigger>
);

const ComparisonSelectContent = ({
  articles,
}: Readonly<{ articles: readonly ComparisonArticle[] }>) => (
  <SelectContent>
    {articles.map((article) => (
      <SelectItem key={`${article.id}-${article.url}`} value={article.id.toString()}>
        {article.title}
      </SelectItem>
    ))}
  </SelectContent>
);

const ComparisonSourceOptionCard = ({
  sourceOption,
  selectedArticleId,
  onSourceChange,
}: Readonly<{
  readonly sourceOption: ComparisonSourceOption<ComparisonArticle>;
  readonly selectedArticleId: string | undefined;
  readonly onSourceChange: (sourceId: string, articleId: string) => void;
}>) => (
  <div className="space-y-2">
    <div className="text-xs font-mono uppercase tracking-[0.24em] text-muted-foreground">
      Outlet
    </div>
    <div className="text-sm font-medium text-foreground">{sourceOption.sourceName}</div>
    <ComparisonSourceSelect
      selectedArticleId={selectedArticleId}
      sourceOption={sourceOption}
      onSourceChange={onSourceChange}
    />
  </div>
);

const ComparisonSourcePicker = ({
  articles,
  options,
  onSourceChange,
}: Readonly<{
  readonly articles: readonly ComparisonArticle[];
  readonly options: readonly ComparisonSourceOption<ComparisonArticle>[];
  readonly onSourceChange: (sourceId: string, articleId: string) => void;
}>) => (
  <div className="grid gap-4 border border-border/50 bg-[var(--news-bg-secondary)]/70 p-4 md:grid-cols-2">
    {options.slice(0, 2).map((sourceOption) => {
      const selectedArticleId = articles
        .find((article) => comparisonArticleSourceId(article) === sourceOption.sourceId)
        ?.id?.toString();
      return (
        <ComparisonSourceOptionCard
          key={sourceOption.sourceId}
          sourceOption={sourceOption}
          selectedArticleId={selectedArticleId}
          onSourceChange={onSourceChange}
        />
      );
    })}
  </div>
);

const ComparisonPairHeader = ({
  comparisonData,
  primaryArticle,
  secondaryArticle,
}: Readonly<{
  comparisonData: ComparisonData | null;
  primaryArticle: ComparisonArticle;
  secondaryArticle: ComparisonArticle;
}>) => (
  <div className="mb-6 text-center">
    <h3 className="mb-2 font-serif text-2xl font-bold">
      Compare: {primaryArticle.source} vs {secondaryArticle.source}
    </h3>
    <p className="text-sm text-muted-foreground">How different sources report the same story</p>
    {comparisonData !== null && (
      <ComparisonSimilarityBadge value={comparisonData.similarity.overall_match_percent} />
    )}
  </div>
);

const ComparisonSimilarityBadge = ({ value }: Readonly<{ value: number }>) => {
  const color = (() => {
    if (value > 70) {
      return "text-green-400";
    }
    return (() => {
      if (value > 40) {
        return "text-yellow-400";
      }
      return "text-red-400";
    })();
  })();
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--news-bg-secondary)] px-3 py-1 text-xs">
      <span>Content Similarity:</span>
      <span className={`font-bold ${color}`}>{value}%</span>
    </div>
  );
};

interface ComparisonRenderedSectionsProps {
  readonly comparisonData: ComparisonData;
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly loadingArticle: number | null;
  readonly primarySource: string;
  readonly secondarySource: string;
}

const ComparisonRenderedSections = ({
  comparisonData,
  articleContents,
  comparisonArticles,
  loadingArticle,
  primarySource,
  secondarySource,
}: Readonly<ComparisonRenderedSectionsProps>) => (
  <>
    <EntitiesBlock
      comparisonData={comparisonData}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
    <KeywordsBlock
      comparisonData={comparisonData}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {comparisonArticles.map((article, index) => (
        <ComparisonArticleColumn
          key={`${article.id}-${article.url}`}
          article={article}
          isFirst={index === 0}
          content={articleContents.get(article.id)}
          loading={loadingArticle === article.id}
          comparisonData={comparisonData}
        />
      ))}
    </div>
    <ComparisonSummary
      comparisonData={comparisonData}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
  </>
);

const ComparisonResults = ({
  comparisonData,
  comparisonError,
  comparisonLoading,
  articleContents,
  comparisonArticles,
  loadingArticle,
  primarySource,
  secondarySource,
}: Readonly<{
  readonly comparisonData: ComparisonData | null;
  readonly comparisonError: string | null;
  readonly comparisonLoading: boolean;
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly loadingArticle: number | null;
  readonly primarySource: string;
  readonly secondarySource: string;
}>) => {
  if (comparisonLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Analyzing articles...</span>
      </div>
    );
  }
  if (!comparisonData) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {comparisonError ?? "Failed to load comparison data. Please try again."}
      </div>
    );
  }
  return (
    <ComparisonRenderedSections
      comparisonData={comparisonData}
      articleContents={articleContents}
      comparisonArticles={comparisonArticles}
      loadingArticle={loadingArticle}
      primarySource={primarySource}
      secondarySource={secondarySource}
    />
  );
};

interface ComparisonPairContentProps {
  readonly comparisonData: ComparisonData | null;
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly comparisonError: string | null;
  readonly comparisonLoading: boolean;
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly loadingArticle: number | null;
}

const ComparisonPairContent = ({
  comparisonData,
  comparisonArticles,
  comparisonError,
  comparisonLoading,
  articleContents,
  loadingArticle,
}: Readonly<ComparisonPairContentProps>) => {
  const primaryArticle = comparisonArticles[0];
  const secondaryArticle = comparisonArticles[1];
  if (primaryArticle === undefined || secondaryArticle === undefined) {
    return null;
  }
  return (
    <>
      <ComparisonPairHeader
        comparisonData={comparisonData}
        primaryArticle={primaryArticle}
        secondaryArticle={secondaryArticle}
      />
      <ComparisonResults
        comparisonData={comparisonData}
        comparisonError={comparisonError}
        comparisonLoading={comparisonLoading}
        articleContents={articleContents}
        comparisonArticles={comparisonArticles}
        loadingArticle={loadingArticle}
        primarySource={primaryArticle.source}
        secondarySource={secondaryArticle.source}
      />
    </>
  );
};

interface ComparisonViewBodyProps {
  readonly comparisonData: ComparisonData | null;
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly comparisonError: string | null;
  readonly comparisonLoading: boolean;
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly loadingArticle: number | null;
}

const ComparisonViewBody = ({
  comparisonData,
  comparisonArticles,
  comparisonError,
  comparisonLoading,
  articleContents,
  loadingArticle,
}: Readonly<ComparisonViewBodyProps>) => {
  if (comparisonArticles.length >= 2) {
    return (
      <ComparisonPairContent
        comparisonData={comparisonData}
        comparisonArticles={comparisonArticles}
        comparisonError={comparisonError}
        comparisonLoading={comparisonLoading}
        articleContents={articleContents}
        loadingArticle={loadingArticle}
      />
    );
  }
  return (
    <div className="rounded-lg border border-border/60 bg-[var(--news-bg-secondary)] px-4 py-3 text-sm text-muted-foreground">
      Select one article from each outlet to compare the coverage.
    </div>
  );
};

const ComparisonView = ({
  comparisonSourceOptions,
  comparisonArticles,
  comparisonError,
  comparisonData,
  comparisonLoading,
  articleContents,
  loadingArticle,
  onSourceChange,
}: Omit<ComparisonTabProps, "comparisonMode" | "detailArticleCount">) => (
  <div className="space-y-6 p-6">
    <ComparisonSourcePicker
      articles={comparisonArticles}
      options={comparisonSourceOptions}
      onSourceChange={onSourceChange}
    />
    {Boolean(comparisonError) && (
      <div className="rounded-lg border border-border/60 bg-destructive/5 px-4 py-3 text-sm text-muted-foreground">
        {comparisonError}
      </div>
    )}
    <ComparisonViewBody
      comparisonData={comparisonData}
      comparisonArticles={comparisonArticles}
      comparisonError={comparisonError}
      comparisonLoading={comparisonLoading}
      articleContents={articleContents}
      loadingArticle={loadingArticle}
    />
  </div>
);

const ComparisonUnavailable = ({
  detailArticleCount,
}: Readonly<{ detailArticleCount: number | null }>) => (
  <div className="flex flex-1 items-center justify-center text-muted-foreground">
    {(() => {
      if (detailArticleCount === null || detailArticleCount === 0 || detailArticleCount < 2) {
        return "Need at least 2 articles to compare";
      }
      return "Compare Sources needs coverage from at least two outlets.";
    })()}
  </div>
);

const ComparisonTab = ({
  comparisonMode,
  comparisonSourceOptions,
  comparisonArticles,
  comparisonError,
  comparisonData,
  comparisonLoading,
  articleContents,
  loadingArticle,
  detailArticleCount,
  onSourceChange,
}: ComparisonTabProps) => {
  const hasDistinctComparisonSources = comparisonSourceOptions.length >= 2;

  return (
    <TabsContent value="compare" className="flex-1 overflow-y-auto m-0 p-0">
      {(() => {
        if (comparisonMode && hasDistinctComparisonSources) {
          return (
            <ComparisonView
              comparisonSourceOptions={comparisonSourceOptions}
              comparisonArticles={comparisonArticles}
              comparisonError={comparisonError}
              comparisonData={comparisonData}
              comparisonLoading={comparisonLoading}
              articleContents={articleContents}
              loadingArticle={loadingArticle}
              onSourceChange={onSourceChange}
            />
          );
        }
        return <ComparisonUnavailable detailArticleCount={detailArticleCount} />;
      })()}
    </TabsContent>
  );
};

export { ComparisonTab, comparisonArticleSourceId };
