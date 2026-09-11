"use client";

import type { ArticleDetailModalProps, NewsArticle } from "../lib/article-detail-modal-data";
import { DEFAULT_ARTICLE_DETAIL_SERVICES } from "../lib/article-detail-modal-data";
import { ArticleDetailModalView } from "./article-detail-modal-view";
import {
  createArticleDetailModalViewProps,
  useModalContentData,
  useModalContentActions,
} from "./article-detail-modal-model";
import { useModalArticleState } from "./article-detail-modal-logic";

const ArticleDetailModal = (props: Readonly<ArticleDetailModalProps>) => {
  const { article, isOpen } = props;
  if (!isOpen || !article) {
    return false;
  }

  return (
    <ArticleDetailModalContent
      key={[article.id, article.url].join(":")}
      article={article}
      isOpen={props.isOpen}
      layoutIdPrefix={props.layoutIdPrefix}
      onBookmarkChange={props.onBookmarkChange}
      onClose={props.onClose}
      onNavigate={props.onNavigate}
      services={props.services}
    />
  );
};

const ArticleDetailModalContent = ({
  article,
  isOpen,
  onClose,
  onBookmarkChange,
  onNavigate,
  layoutIdPrefix,
  services = DEFAULT_ARTICLE_DETAIL_SERVICES,
}: Readonly<ArticleDetailModalProps & { article: NewsArticle }>) => {
  const state = useModalArticleState({ article, onNavigate, services });
  const data = useModalContentData({
    activeStatusFilter: state.activeStatusFilter,
    aiAnalysis: state.aiAnalysis,
    aiAnalysisLoading: state.aiAnalysisLoading,
    aiAnalysisRequested: state.aiAnalysisRequested,
    article,
    fullArticleText: state.fullArticleText,
    highlights: state.highlights,
    isOpen,
    services,
  });
  const actions = useModalContentActions({
    analysisState: state,
    article,
    claimState: state,
    debugState: state,
    dialogState: state,
    factCheckResults: data.factCheckResults,
    hasReporterWiki: data.hasReporterWiki,
    hasSourceWiki: data.hasSourceWiki,
    libraryState: state,
    onBookmarkChange,
    onClose,
    services,
    wikiState: state,
  });

  const viewProps = createArticleDetailModalViewProps({
    article,
    ...actions,
    data,
    getServices: () => services,
    getState: () => state,
    isOpen,
    layoutIdPrefix,
    onClose,
    onNavigate,
  });

  return <ArticleDetailModalView viewProps={viewProps} />;
};

export { ArticleDetailModal };
