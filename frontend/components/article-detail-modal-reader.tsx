"use client";

import type {
  ArticleAnalysis,
  ArticleDetailServices,
  CreateHighlightHandler,
  DeleteHighlightHandler,
  Highlight,
  HighlightClickHandler,
  HighlightSyncController,
  LocalHighlight,
  ModalHighlightSyncStatus,
  NewsArticle,
  UpdateHighlightHandler,
} from "../lib/article-detail-modal-data";
import {
  isExtractableUrl,
  isNonEmptyString,
  markFailed,
  markSynced,
  saveHighlightStore,
} from "../lib/article-detail-modal-data";
import { ArticleContent } from "@/components/article-content";
import { HighlightToolbar } from "@/components/highlight-toolbar";
import type { RefObject } from "react";

type ReaderBodyProps = Readonly<{
  fullArticleText: string | undefined;
  articleUrl: string;
  articleSummary: string;
  showHighlights: boolean;
  visibleHighlights: readonly Highlight[];
  activeHighlightId: string | undefined;
  onHighlightClick: HighlightClickHandler;
  articleContentRef: Readonly<RefObject<HTMLDivElement | null>>;
  isExpanded: boolean;
  highlightColor: Highlight["color"];
  onCreate: CreateHighlightHandler;
  onUpdate: UpdateHighlightHandler;
  onDelete: DeleteHighlightHandler;
}>;

type ReaderProps = ReaderBodyProps & Readonly<{ articleLoading: boolean }>;

const EMPTY_COUNT = 0,
  HIGHLIGHT_STORE_VERSION = 1,
  MINIMUM_READING_MINUTES = 1,
  ModalArticleReader = (props: Readonly<ReaderProps>) => (
    <div className="space-y-6">
      <h2 className={getModalReaderTitleClassName(props.isExpanded)}>Full Article</h2>
      {renderReaderContent(props)}
    </div>
  ),
  ModalArticleReaderBody = (props: Readonly<ReaderBodyProps>) => {
    const {
      activeHighlightId,
      articleContentRef,
      articleSummary,
      articleUrl,
      fullArticleText,
      highlightColor,
      isExpanded,
      onCreate,
      onDelete,
      onHighlightClick,
      onUpdate,
      showHighlights,
      visibleHighlights,
    } = props;
    return (
      <>
        <ArticleContent
          ref={articleContentRef}
          content={getModalReaderText(fullArticleText, articleSummary)}
          highlights={getVisibleReaderHighlights(showHighlights, visibleHighlights)}
          activeHighlightId={activeHighlightId}
          onHighlightClick={onHighlightClick}
          className={getReaderContentClassName(isExpanded)}
        />
        <HighlightToolbar
          articleUrl={articleUrl}
          containerRef={articleContentRef}
          highlightColor={highlightColor}
          autoCreate
          highlights={visibleHighlights}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      </>
    );
  },
  ModalArticleReaderLoading = ({ updating }: Readonly<{ updating: boolean }>) => {
    if (updating) {
      return (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border/50 bg-card/60 p-4">
          <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary" />
          <p className="text-sm text-muted-foreground">Updating full article text...</p>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card/60 p-6">
        <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-primary" />
        <p className="text-muted-foreground">Loading full article text...</p>
      </div>
    );
  },
  NEXT_INDEX = 1,
  WORDS_PER_READING_MINUTE = 230,
  attemptHighlightOperation = async (
    item: Readonly<LocalHighlight>,
    current: readonly LocalHighlight[],
    controller: Readonly<HighlightSyncController>,
  ): Promise<LocalHighlight[]> => {
    try {
      return await syncOneHighlight(item, current, controller.services);
    } catch (error) {
      controller.setStatus(getHighlightSyncFailureStatus());
      return replaceSyncedHighlight(current, item.client_id, (highlight) =>
        markFailed({ error, highlight }),
      );
    }
  },
  getArticleHost = (url?: string): string | undefined => {
    if (url === undefined || !isExtractableUrl(url)) {
      return void 0;
    }
    return new URL(url).hostname;
  },
  getArticleTextForMetrics = (
    fullArticleText: string | undefined,
    content: string | undefined,
    summary: string | undefined,
  ): string => {
    const primary = fullArticleText ?? content;
    if (primary !== undefined && primary !== "") {
      return primary.trim();
    }
    return (summary ?? "").trim();
  },
  getArticleWikiContext = (
    fullArticleText: string | undefined,
    content: string | undefined,
    summary: string | undefined,
  ): string => {
    const articleContent = (content ?? "").trim(),
      fullText = (fullArticleText ?? "").trim();
    if (fullText !== "") {
      return fullText;
    }
    if (articleContent !== "") {
      return articleContent;
    }
    return (summary ?? "").trim();
  },
  getArticleWordMetrics = (text: string) => {
    let wordCount = EMPTY_COUNT;
    if (text !== "") {
      wordCount = text.split(/\s+/u).filter(Boolean).length;
    }
    return {
      estimatedReadMinutes: Math.max(
        MINIMUM_READING_MINUTES,
        Math.ceil(wordCount / WORDS_PER_READING_MINUTE),
      ),
      wordCount,
    };
  },
  getHighlightSyncFailureStatus = (): ModalHighlightSyncStatus => {
    if (getOfflineSyncStatus() === "offline") {
      return "offline";
    }
    return "failed";
  },
  getModalReaderText = (fullArticleText: string | undefined, articleSummary: string): string => {
    if (isNonEmptyString(fullArticleText)) {
      return fullArticleText;
    }
    if (articleSummary !== "") {
      return articleSummary;
    }
    return "";
  },
  getModalReaderTitleClassName = (isExpanded: boolean): string => {
    if (isExpanded) {
      return "mb-6 font-bold font-serif text-3xl text-foreground";
    }
    return "mb-6 font-bold font-serif text-xl text-foreground";
  },
  getOfflineSyncStatus = (): ModalHighlightSyncStatus => {
    if (globalThis.navigator.onLine) {
      return "idle";
    }
    return "offline";
  },
  getReaderContentClassName = (isExpanded: boolean): string => {
    if (isExpanded) {
      return "reading-prose space-y-6";
    }
    return "reading-prose space-y-5";
  },
  getRenderedLanguageDiagnostics = (
    aiAnalysis: ArticleAnalysis | null | undefined,
    languageDiagnostics: ArticleAnalysis["language_diagnostics"] | null | undefined,
  ) => {
    if (aiAnalysis?.language_diagnostics?.success === true) {
      return aiAnalysis.language_diagnostics;
    }
    return languageDiagnostics;
  },
  getReporterName = (article: NewsArticle): string => {
    const author = article.author?.trim();
    if (author !== undefined && author !== "") {
      return author;
    }
    return article.authors?.find((value) => value.trim().length > EMPTY_COUNT)?.trim() ?? "";
  },
  getVisibleReaderHighlights = (
    showHighlights: boolean,
    visibleHighlights: readonly Highlight[],
  ): readonly Highlight[] => {
    if (showHighlights) {
      return visibleHighlights;
    }
    return [];
  },
  isTextInputFocused = (): boolean => {
    const active = globalThis.document.activeElement;
    return (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable)
    );
  },
  persistHighlightOperation = (
    articleUrl: string,
    highlights: readonly LocalHighlight[],
    controller: Readonly<HighlightSyncController>,
  ): void => {
    if (articleUrl === "") {
      return;
    }
    saveHighlightStore({
      article_url: articleUrl,
      highlights: [...highlights],
      version: HIGHLIGHT_STORE_VERSION,
    });
    controller.setHighlights([...highlights]);
  },
  processHighlightItems = async (
    articleUrl: string,
    actionable: readonly LocalHighlight[],
    current: readonly LocalHighlight[],
    syncToken: number,
    controller: Readonly<HighlightSyncController>,
  ): Promise<void> => {
    const processNext = async (
      nextCurrent: readonly LocalHighlight[],
      index: number,
    ): Promise<void> => {
      if (controller.latestSyncToken.current !== syncToken || index >= actionable.length) {
        return;
      }
      const item = actionable[index];
      if (item === undefined) {
        return;
      }
      let nextHighlights = nextCurrent;
      nextHighlights = await attemptHighlightOperation(item, nextHighlights, controller);
      persistHighlightOperation(articleUrl, nextHighlights, controller);
      await processNext(nextHighlights, index + NEXT_INDEX);
    };
    await processNext(current, EMPTY_COUNT);
    if (controller.latestSyncToken.current === syncToken) {
      controller.setStatus(getOfflineSyncStatus());
    }
  },
  renderReaderBodyContent = (props: Readonly<ReaderBodyProps>) => {
    const {
      activeHighlightId,
      articleContentRef,
      articleSummary,
      articleUrl,
      fullArticleText,
      highlightColor,
      isExpanded,
      onCreate,
      onDelete,
      onHighlightClick,
      onUpdate,
      showHighlights,
      visibleHighlights,
    } = props;
    return (
      <ModalArticleReaderBody
        activeHighlightId={activeHighlightId}
        articleContentRef={articleContentRef}
        articleSummary={articleSummary}
        articleUrl={articleUrl}
        fullArticleText={fullArticleText}
        highlightColor={highlightColor}
        isExpanded={isExpanded}
        onCreate={onCreate}
        onDelete={onDelete}
        onHighlightClick={onHighlightClick}
        onUpdate={onUpdate}
        showHighlights={showHighlights}
        visibleHighlights={visibleHighlights}
      />
    );
  },
  renderReaderContent = (props: Readonly<ReaderProps>) => {
    if (props.articleLoading && isNonEmptyString(props.fullArticleText)) {
      return (
        <>
          <ModalArticleReaderLoading updating />
          {renderReaderBodyContent(props)}
        </>
      );
    }
    if (props.articleLoading) {
      return <ModalArticleReaderLoading updating={false} />;
    }
    return renderReaderBodyContent(props);
  },
  replaceSyncedHighlight = (
    highlights: readonly LocalHighlight[],
    clientId: string,
    update: (highlight: LocalHighlight) => LocalHighlight,
  ): LocalHighlight[] =>
    highlights.map((highlight) => {
      if (highlight.client_id !== clientId) {
        return highlight;
      }
      return update(highlight);
    }),
  shouldShowSummary = (
    summary: string | undefined,
    content: string | undefined,
    fullArticleText: string | undefined,
  ) => {
    const contentText = (content ?? "").trim(),
      fullText = (fullArticleText ?? "").trim(),
      summaryText = (summary ?? "").trim();
    return Boolean(summaryText && summaryText !== fullText && summaryText !== contentText);
  },
  syncCreatedHighlight = async (
    item: Readonly<LocalHighlight>,
    current: readonly LocalHighlight[],
    services: ArticleDetailServices,
  ): Promise<LocalHighlight[]> => {
    const created = await services.createHighlight({
      article_url: item.article_url,
      character_end: item.character_end,
      character_start: item.character_start,
      color: item.color,
      highlighted_text: item.highlighted_text,
      note: item.note,
    });
    return replaceSyncedHighlight(current, item.client_id, (highlight) =>
      markSynced({ highlight, server: created }),
    );
  },
  syncDeletedHighlight = async (
    item: Readonly<LocalHighlight>,
    current: readonly LocalHighlight[],
    services: ArticleDetailServices,
  ): Promise<LocalHighlight[]> => {
    const id = item.server_id ?? item.id;
    if (id !== undefined) {
      await services.deleteHighlight(id);
    }
    return current.filter((highlight) => highlight.client_id !== item.client_id);
  },
  syncHighlights = async (
    articleUrl: string,
    current: readonly LocalHighlight[],
    controller: Readonly<HighlightSyncController>,
  ): Promise<void> => {
    const actionable = current.filter((item) => item.pending_op !== undefined),
      syncToken = Date.now();
    controller.setLatestSyncToken(syncToken);
    controller.setStatus("syncing");
    if (actionable.length === EMPTY_COUNT) {
      controller.setStatus(getOfflineSyncStatus());
      return;
    }
    await processHighlightItems(articleUrl, actionable, current, syncToken, controller);
  },
  syncOneHighlight = (
    item: Readonly<LocalHighlight>,
    current: readonly LocalHighlight[],
    services: ArticleDetailServices,
  ): Promise<LocalHighlight[]> => {
    if (item.pending_op === "create") {
      return syncCreatedHighlight(item, current, services);
    }
    if (item.pending_op === "update") {
      return syncUpdatedHighlight(item, current, services);
    }
    if (item.pending_op === "delete") {
      return syncDeletedHighlight(item, current, services);
    }
    return Promise.resolve([...current]);
  },
  syncUpdatedHighlight = async (
    item: Readonly<LocalHighlight>,
    current: readonly LocalHighlight[],
    services: ArticleDetailServices,
  ): Promise<LocalHighlight[]> => {
    const id = item.server_id ?? item.id;
    if (id === undefined) {
      return replaceSyncedHighlight(current, item.client_id, (highlight) =>
        markFailed({ error: "missing server id", highlight }),
      );
    }
    {
      const updated = await services.updateHighlight(id, {
        character_end: item.character_end,
        character_start: item.character_start,
        color: item.color,
        highlighted_text: item.highlighted_text,
        note: item.note,
      });
      return replaceSyncedHighlight(current, item.client_id, (highlight) =>
        markSynced({ highlight, server: updated }),
      );
    }
  };

export {
  ModalArticleReader,
  getArticleHost,
  getArticleTextForMetrics,
  getArticleWikiContext,
  getArticleWordMetrics,
  getRenderedLanguageDiagnostics,
  getReporterName,
  isTextInputFocused,
  shouldShowSummary,
  syncHighlights,
};
