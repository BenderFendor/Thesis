import type { Message, ReadonlyNewsArticle, ReadonlyThinkingStep } from "../model/types";
import type { SourceGroup } from "../state/selectors";
import { VerificationPanel } from "@/components/verification-panel";
import { formatShortDate } from "@/lib/date-formatters";
import { useCallback } from "react";

const RESEARCH_LOG_LIMIT = 6;
const SOURCE_PREVIEW_LIMIT = 5;
interface ResearchSidePanelsProps {
  readonly thinkingSteps: readonly ReadonlyThinkingStep[];
  readonly latestAssistantMessage: Message | undefined;
  readonly latestUserMessage: Message | undefined;
  readonly latestSemanticMessage: Message | undefined;
  readonly groupedSources: readonly {
    readonly sourceId: string;
    readonly sourceName: string;
    readonly articles: readonly ReadonlyNewsArticle[];
  }[];
  readonly expandedSourceIds: ReadonlySet<string>;
  readonly onToggleSource: (sourceId: string) => void;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

interface ResearchLogPanelProps {
  readonly thinkingSteps: readonly ReadonlyThinkingStep[];
}

const ResearchLogEntries = (props: Readonly<ResearchLogPanelProps>) => {
  const { thinkingSteps } = props;
  if (thinkingSteps.length === 0) {
    return <p className="text-xs text-muted-foreground">Reasoning steps will appear as the agent works.</p>;
  }
  return (
    <div className="space-y-3 text-sm">
      {thinkingSteps.slice(-RESEARCH_LOG_LIMIT).map((step) => (
        <div
          key={`${step.type}-${step.content}`}
          className="rounded-r-2xl border-l-2 border-primary/25 bg-background/25 px-3 py-2.5"
        >
          <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground/65">
            {step.type.replace("_", " ")}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground/80">
            {step.content}
          </p>
        </div>
      ))}
    </div>
  );
};

const ResearchLogPanel = (props: Readonly<ResearchLogPanelProps>) => {
  const { thinkingSteps } = props;
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground/70">
          Research Log
        </h3>
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground/55">
          {thinkingSteps.length} steps
        </span>
      </div>
      <ResearchLogEntries thinkingSteps={thinkingSteps} />
    </section>
  );
};

interface VerificationSectionProps {
  latestAssistantMessage: Message | undefined;
  latestUserMessage: Message | undefined;
}

const VerificationSection = (props: Readonly<VerificationSectionProps>) => {
  const { latestAssistantMessage, latestUserMessage } = props;
  if (
    latestAssistantMessage === undefined ||
    latestAssistantMessage.isStreaming === true ||
    latestAssistantMessage.content.length === 0
  ) {
    return null;
  }
  return (
    <section className="border-t border-border/15 pt-6">
      <VerificationPanel
        query={latestUserMessage?.content ?? ""}
        mainAnswer={latestAssistantMessage.content}
        className="rounded-2xl border-border/20 bg-card/30"
      />
    </section>
  );
};

interface RelatedCoveragePanelProps {
  readonly latestSemanticMessage: Message | undefined;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

interface RelatedCoverageEntryProps {
  readonly article: ReadonlyNewsArticle;
  readonly similarityScore?: number | null;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

const RelatedCoverageEntry = ({
  article,
  similarityScore,
  onOpenArticle,
}: Readonly<RelatedCoverageEntryProps>) => {
  const handleOpenArticle = useCallback(() => {
    onOpenArticle(article);
  }, [article, onOpenArticle]);
  return (
    <button
      type="button"
      onClick={handleOpenArticle}
      className="w-full rounded-2xl border border-border/15 bg-background/35 p-3 text-left transition-colors hover:border-primary/35"
    >
      <div className="line-clamp-2 font-serif text-sm font-medium text-foreground/90">
        {article.title}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{article.source}</span>
        {similarityScore !== undefined && similarityScore !== null && (
          <span className="rounded-full border border-border/20 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground">
            {Math.round(similarityScore * 100)}% match
          </span>
        )}
      </div>
    </button>
  );
};
const RelatedCoveragePanel = (props: Readonly<RelatedCoveragePanelProps>) => {
  const { latestSemanticMessage, onOpenArticle } = props,
    results = latestSemanticMessage?.semanticResults ?? [];
  if (results.length === 0) {
    return null;
  }
  return (
    <section className="border-t border-border/15 pt-6">
      <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground/70">
        Related Coverage
      </h3>
      <div className="mt-3 space-y-2">
        {results.map(({ article, similarityScore }) => (
          <RelatedCoverageEntry
            key={`semantic-${article.url || article.id}`}
            article={article}
            similarityScore={similarityScore}
            onOpenArticle={onOpenArticle}
          />
        ))}
      </div>
    </section>
  );
};

interface SourcesUsedPanelProps {
  readonly groupedSources: readonly SourceGroup[];
  readonly expandedSourceIds: ReadonlySet<string>;
  readonly onToggleSource: (sourceId: string) => void;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

interface SourceGroupEntryProps {
  readonly group: SourceGroup;
  readonly isExpanded: boolean;
  readonly onToggleSource: (sourceId: string) => void;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

const getVisibleArticles = (group: SourceGroup, isExpanded: boolean) => {
  if (isExpanded) {
    return group.articles;
  }
  return group.articles.slice(0, SOURCE_PREVIEW_LIMIT);
};

const getSourceToggleLabel = (group: SourceGroup, isExpanded: boolean) => {
  if (isExpanded) {
    return "Collapse";
  }
  return `Show all (${group.articles.length})`;
};

interface SourceArticleEntryProps {
  readonly article: ReadonlyNewsArticle;
  readonly sourceId: string;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

const SourceArticleEntry = ({
  article,
  sourceId,
  onOpenArticle,
}: Readonly<SourceArticleEntryProps>) => {
  const handleOpenArticle = useCallback(() => {
    onOpenArticle(article);
  }, [article, onOpenArticle]);
  return (
    <button
      type="button"
      key={`${sourceId}-${article.url || article.id}`}
      onClick={handleOpenArticle}
      className="w-full rounded-2xl bg-background/35 px-3 py-2.5 text-left text-xs transition-colors hover:bg-card/60"
    >
      <div className="line-clamp-2 font-serif text-sm font-medium text-foreground/90">
        {article.title}
      </div>
      <div className="mt-2.5 flex items-center justify-between font-mono text-xs uppercase tracking-wide text-muted-foreground/60">
        <span>{article.source}</span>
        <span>{formatShortDate(article.publishedAt)}</span>
      </div>
    </button>
  );
};

const SourceGroupSummary = (props: Readonly<{ group: SourceGroup }>) => {
  const { group } = props;
  return (
    <div>
      <div className="text-sm font-medium text-foreground">{group.sourceName}</div>
      <div className="mt-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground/70">
        {group.articles.length} articles
      </div>
    </div>
  );
};

const SourceGroupHeader = (
  props: Readonly<{
    readonly group: SourceGroup;
    readonly isExpanded: boolean;
    readonly onToggle: () => void;
  }>,
) => {
  const { group, isExpanded, onToggle } = props;
  return (
    <div className="flex items-start justify-between gap-3">
      <SourceGroupSummary group={group} />
      {group.articles.length > SOURCE_PREVIEW_LIMIT && (
        <button
          type="button"
          onClick={onToggle}
          className="font-mono text-xs uppercase tracking-wider text-primary hover:underline"
        >
          {getSourceToggleLabel(group, isExpanded)}
        </button>
      )}
    </div>
  );
};

const SourceGroupEntry = ({
  group,
  isExpanded,
  onToggleSource,
  onOpenArticle,
}: Readonly<SourceGroupEntryProps>) => {
  const visibleArticles = getVisibleArticles(group, isExpanded);
  const handleToggleSource = useCallback(() => {
    onToggleSource(group.sourceId);
  }, [group.sourceId, onToggleSource]);
  return (
    <div className="border-t border-border/10 pt-4 first:border-t-0 first:pt-0">
      <SourceGroupHeader
        group={group}
        isExpanded={isExpanded}
        onToggle={handleToggleSource}
      />
      <div className="mt-3 space-y-2">
        {visibleArticles.map((article) => (
          <SourceArticleEntry
            key={`${group.sourceId}-${article.url || article.id}`}
            article={article}
            sourceId={group.sourceId}
            onOpenArticle={onOpenArticle}
          />
        ))}
      </div>
    </div>
  );
};

const SourceGroupList = (props: Readonly<SourcesUsedPanelProps>) => {
  const { groupedSources, expandedSourceIds, onToggleSource, onOpenArticle } = props;
  return (
    <div className="mt-3 space-y-4">
      {groupedSources.map((group) => (
        <SourceGroupEntry
          key={group.sourceId}
          group={group}
          isExpanded={expandedSourceIds.has(group.sourceId)}
          onToggleSource={onToggleSource}
          onOpenArticle={onOpenArticle}
        />
      ))}
    </div>
  );
};

const SourcesUsedPanel = (props: Readonly<SourcesUsedPanelProps>) => {
    const { groupedSources, expandedSourceIds, onToggleSource, onOpenArticle } = props;
    if (groupedSources.length === 0) {
      return null;
    }
    return (
      <section className="border-t border-border/15 pt-6">
        <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground/70">
          Sources Used
        </h3>
        <SourceGroupList
          groupedSources={groupedSources}
          expandedSourceIds={expandedSourceIds}
          onToggleSource={onToggleSource}
          onOpenArticle={onOpenArticle}
        />
      </section>
    );
  };

const ResearchSidePanels = (props: ResearchSidePanelsProps) => {
  const {
    thinkingSteps,
    latestAssistantMessage,
    latestUserMessage,
    latestSemanticMessage,
    groupedSources,
    expandedSourceIds,
    onToggleSource,
    onOpenArticle,
  } = props;
  return (
    <div className="space-y-6 px-5 py-6 md:px-6">
      <ResearchLogPanel thinkingSteps={thinkingSteps} />

      <VerificationSection
        latestAssistantMessage={latestAssistantMessage}
        latestUserMessage={latestUserMessage}
      />

      <RelatedCoveragePanel
        latestSemanticMessage={latestSemanticMessage}
        onOpenArticle={onOpenArticle}
      />

      <SourcesUsedPanel
        groupedSources={groupedSources}
        expandedSourceIds={expandedSourceIds}
        onToggleSource={onToggleSource}
        onOpenArticle={onOpenArticle}
      />
    </div>
  );
};

export { ResearchSidePanels };
