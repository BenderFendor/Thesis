"use client"

import type {
 ArticleDetailDialogBodyProps,
 ArticleDetailDialogColumnsProps,
} from "../lib/article-detail-modal-types"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
 ModalActions,
 ModalAiCleanNote,
 ModalTags,
} from "./article-detail-modal-actions"
import {
 ModalArticleReader,
 ModalHeaderControls,
 ModalHero,
 ModalProgressRail,
 ModalSummaryQuote,
} from "./article-detail-modal-chrome"
import { getBodyHandlers, getColumnHandlers } from "./article-detail-modal-handlers"
import { ArticleDetailSidebar } from "./article-detail-modal-sidebar"
import { HighlightNotePopover } from "@/components/highlight-note-popover"
import { InlineDefinitionPopover as InlineDefinition } from "@/components/inline-definition"
import { ModalCompactAiSection } from "./article-detail-modal-analysis"
import { ModalWikiOverlay } from "@/components/article-detail-modal-wiki"

interface ArticleDetailColumnProps {
 readonly columnProps: Readonly<ArticleDetailDialogColumnsProps>
}

interface ArticleDetailBodyBoundaryProps {
 readonly bodyProps: Readonly<ArticleDetailDialogBodyProps>
}

interface ArticleDetailDialogChromeProps {
 readonly bodyProps: Readonly<ArticleDetailDialogBodyProps>
 readonly onClose: () => void
 readonly onNavigateArticle: (direction: "prev" | "next") => void
 readonly onToggleExpanded: () => void
}

interface ArticleDetailPrimaryReaderProps {
 readonly articleLoading: ArticleDetailDialogColumnsProps["articleLoading"]
 readonly fullArticleText: ArticleDetailDialogColumnsProps["fullArticleText"]
 readonly articleUrl: ArticleDetailDialogColumnsProps["currentArticle"]["url"]
 readonly articleSummary: ArticleDetailDialogColumnsProps["currentArticle"]["summary"]
 readonly showHighlights: ArticleDetailDialogColumnsProps["showHighlights"]
 readonly visibleHighlights: ArticleDetailDialogColumnsProps["visibleHighlights"]
 readonly activeHighlightId: ArticleDetailDialogColumnsProps["activeHighlightId"]
 readonly articleContentRef: ArticleDetailDialogColumnsProps["articleContentRef"]
 readonly isExpanded: ArticleDetailDialogColumnsProps["isExpanded"]
 readonly highlightColor: ArticleDetailDialogColumnsProps["highlightColor"]
 readonly onHighlightClick: ArticleDetailDialogColumnsProps["onHighlightClick"]
 readonly onCreate: ArticleDetailDialogColumnsProps["onCreate"]
 readonly onUpdate: ArticleDetailDialogColumnsProps["onUpdate"]
 readonly onDelete: ArticleDetailDialogColumnsProps["onDelete"]
}

interface ArticleDetailPrimaryActionsProps {
 readonly article: ArticleDetailDialogColumnsProps["currentArticle"]
 readonly canPersist: ArticleDetailDialogColumnsProps["canPersistArticle"]
 readonly bookmarkLoading: ArticleDetailDialogColumnsProps["bookmarkLoading"]
 readonly aiAnalysisLoading: ArticleDetailDialogColumnsProps["aiAnalysisLoading"]
 readonly canRequestAiAnalysis: ArticleDetailDialogColumnsProps["canRequestAiAnalysis"]
 readonly aiAnalysisRequested: ArticleDetailDialogColumnsProps["aiAnalysisRequested"]
 readonly aiHasError: ArticleDetailDialogColumnsProps["aiHasError"]
 readonly aiActionLabel: ArticleDetailDialogColumnsProps["aiActionLabel"]
 readonly isLiked: ArticleDetailDialogColumnsProps["isLiked"]
 readonly isFavorite: ArticleDetailDialogColumnsProps["isFavorite"]
 readonly isBookmarked: ArticleDetailDialogColumnsProps["isBookmarked"]
 readonly isArticleInQueue: ArticleDetailDialogColumnsProps["isArticleInQueue"]
 readonly onLike: ArticleDetailDialogColumnsProps["onLike"]
 readonly onFavorite: ArticleDetailDialogColumnsProps["onFavorite"]
 readonly onBookmark: ArticleDetailDialogColumnsProps["onBookmark"]
 readonly onAiAnalysis: ArticleDetailDialogColumnsProps["onAiAnalysis"]
 readonly onQueueToggle: ArticleDetailDialogColumnsProps["onQueueToggle"]
}

const
 ArticleDetailDialogBody = (props: Readonly<ArticleDetailDialogBodyProps>) => {
  const bodyHandlers = getBodyHandlers(props),
   handleNavigateArticle = props.handleNavigate
  return (
   <Dialog open={props.isOpen} onOpenChange={bodyHandlers.handleDialogOpenChange}>
    <DialogContent
     showCloseButton={false}
     className={`${getDialogBodyClassName(props.isExpanded)} gap-0 overflow-hidden border border-border/50 bg-background/95 p-0 shadow-2xl shadow-black/60`}
    >
     <DialogTitle className="sr-only">{props.currentArticle.title}</DialogTitle>
     <ArticleDetailDialogOverlays bodyProps={props} />
     <ArticleDetailDialogChrome
      bodyProps={props}
      onClose={bodyHandlers.handleClose}
      onNavigateArticle={handleNavigateArticle}
      onToggleExpanded={bodyHandlers.handleToggleExpanded}
     />
    </DialogContent>
   </Dialog>
  )
 },

 ArticleDetailDialogChrome = ({ bodyProps, onClose, onNavigateArticle, onToggleExpanded }: Readonly<ArticleDetailDialogChromeProps>) => {
  const bodyHandlers = getBodyHandlers(bodyProps)
  return (
   <div className="flex h-full flex-col overflow-hidden">
    <ModalHeaderControls
     onNavigate={bodyHandlers.handleNavigate}
     onArticleNavigate={onNavigateArticle}
     isExpanded={bodyProps.isExpanded}
     onToggleExpanded={onToggleExpanded}
     onClose={onClose}
    />
    <ArticleDetailDialogScrollContent bodyProps={bodyProps} />
   </div>
  )
 },

 ArticleDetailDialogColumns = ({ columnProps }: Readonly<ArticleDetailColumnProps>) => (
  <div className={getDialogColumnsClassName(columnProps.isExpanded)}>
   <ArticleDetailPrimaryColumn columnProps={columnProps} />
   {columnProps.isExpanded && <ArticleDetailExpandedSidebar columnProps={columnProps} />}
  </div>
 ),

 ArticleDetailDialogOverlays = ({ bodyProps }: Readonly<ArticleDetailBodyBoundaryProps>) => {
  const bodyHandlers = getBodyHandlers(bodyProps)
  return (
   <>
    <InlineDefinition
     result={bodyProps.inlineResult}
     open={bodyProps.inlineOpen}
     setOpen={bodyProps.setInlineOpen}
     anchorPosition={bodyProps.inlineAnchorPosition}
    />
    <HighlightNotePopover
     open={bodyProps.highlightPopoverOpen}
     highlight={bodyProps.highlightPopoverHighlight ?? undefined}
     anchorEl={bodyProps.highlightPopoverAnchorEl ?? undefined}
     onClose={bodyHandlers.handleCloseHighlightPopover}
     onSave={bodyHandlers.handleSaveHighlightNote}
     articleTitle={bodyProps.currentArticle.title}
     articleSource={bodyProps.currentArticle.source}
    />
    <ModalWikiOverlay
     wikiPanelOpen={bodyProps.wikiPanelOpen}
     setWikiPanelOpen={bodyProps.setWikiPanelOpen}
     wikiPanelTab={bodyProps.wikiPanelTab}
     setWikiPanelTab={bodyProps.setWikiPanelTab}
     currentArticle={bodyProps.currentArticle}
     reporterName={bodyProps.reporterName}
     hasSourceWiki={bodyProps.hasSourceWiki}
     hasReporterWiki={bodyProps.hasReporterWiki}
     articleHost={bodyProps.articleHost}
     articleWikiContext={bodyProps.articleWikiContext}
    />
   </>
  )
 },

 ArticleDetailDialogScrollContent = ({ bodyProps }: Readonly<ArticleDetailBodyBoundaryProps>) => {
  const bodyHandlers = getBodyHandlers(bodyProps),
   { contentScrollRef, progressTrackRef, ...columnProps } = bodyProps
  return (
   <div id="article-detail-scroll-region" ref={contentScrollRef} className="no-scrollbar relative flex-1 overflow-y-auto bg-background">
    <ModalProgressRail trackRef={progressTrackRef} progress={columnProps.articleScrollProgress} />
    <ModalHero
     article={columnProps.currentArticle}
     isExpanded={columnProps.isExpanded}
     layoutIdPrefix={columnProps.layoutIdPrefix}
     reporterName={columnProps.reporterName}
     onOpenSourceWiki={bodyHandlers.handleOpenSourceWiki}
     onOpenReporterWiki={bodyHandlers.handleOpenReporterWiki}
     onClose={bodyHandlers.handleClose}
    />
    <div className={getScrollContentClassName(columnProps.isExpanded)}>
     {columnProps.showSummary && <ModalSummaryQuote summary={columnProps.currentArticle.summary} isExpanded={columnProps.isExpanded} />}
     <ArticleDetailDialogColumns columnProps={columnProps} />
     <ModalCompactAiSection
      isExpanded={columnProps.isExpanded}
      aiAnalysisLoading={columnProps.aiAnalysisLoading}
      aiAnalysis={columnProps.aiAnalysis}
      factCheckCount={columnProps.factCheckResults.length}
      onExpand={bodyHandlers.handleToggleExpanded}
     />
    </div>
   </div>
  )
 },

 ArticleDetailExpandedSidebar = ({ columnProps }: Readonly<ArticleDetailColumnProps>) => (
  <ArticleDetailSidebar columnProps={columnProps} />
 ),

 ArticleDetailPrimaryActions = ({
  article,
  canPersist,
  bookmarkLoading,
  aiAnalysisLoading,
  canRequestAiAnalysis,
  aiAnalysisRequested,
  aiHasError,
  aiActionLabel,
  isLiked,
  isFavorite,
  isBookmarked,
  isArticleInQueue,
  onLike,
  onFavorite,
  onBookmark,
  onAiAnalysis,
  onQueueToggle,
 }: Readonly<ArticleDetailPrimaryActionsProps>) => (
  <ModalActions
   article={article}
   canPersist={canPersist}
   bookmarkLoading={bookmarkLoading}
   aiAnalysisLoading={aiAnalysisLoading}
   canRequestAiAnalysis={canRequestAiAnalysis}
   aiAnalysisRequested={aiAnalysisRequested}
   aiHasError={aiHasError}
   aiActionLabel={aiActionLabel}
   isLiked={isLiked}
   isFavorite={isFavorite}
   isBookmarked={isBookmarked}
   isArticleInQueue={isArticleInQueue}
   onLike={onLike}
   onFavorite={onFavorite}
   onBookmark={onBookmark}
   onAiAnalysis={onAiAnalysis}
   onQueueToggle={onQueueToggle}
  />
 ),

 ArticleDetailPrimaryColumn = ({ columnProps }: Readonly<ArticleDetailColumnProps>) => {
  const columnHandlers = getColumnHandlers(columnProps)
  return (
   <div className={getPrimaryColumnClassName(columnProps.isExpanded)}>
    <ArticleDetailPrimaryReader
     articleLoading={columnProps.articleLoading}
     fullArticleText={columnProps.fullArticleText}
     articleUrl={columnProps.currentArticle.url}
     articleSummary={columnProps.currentArticle.summary}
     showHighlights={columnProps.showHighlights}
     visibleHighlights={columnProps.visibleHighlights}
     activeHighlightId={columnProps.activeHighlightId}
     articleContentRef={columnProps.articleContentRef}
     isExpanded={columnProps.isExpanded}
     highlightColor={columnProps.highlightColor}
     onHighlightClick={columnHandlers.handleHighlightClick}
     onCreate={columnHandlers.handleCreate}
     onUpdate={columnHandlers.handleUpdate}
     onDelete={columnHandlers.handleDelete}
    />
    <ModalAiCleanNote
     aiAnalysis={columnProps.aiAnalysis}
     fullArticleText={columnProps.fullArticleText}
     articleContent={columnProps.currentArticle.content}
    />
    <ModalTags tags={columnProps.currentArticle.tags} />
    <ArticleDetailPrimaryActions
     article={columnProps.currentArticle}
     canPersist={columnProps.canPersistArticle}
     bookmarkLoading={columnProps.bookmarkLoading}
     aiAnalysisLoading={columnProps.aiAnalysisLoading}
     canRequestAiAnalysis={columnProps.canRequestAiAnalysis}
     aiAnalysisRequested={columnProps.aiAnalysisRequested}
     aiHasError={columnProps.aiHasError}
     aiActionLabel={columnProps.aiActionLabel}
     isLiked={columnProps.isLiked}
     isFavorite={columnProps.isFavorite}
     isBookmarked={columnProps.isBookmarked}
     isArticleInQueue={columnProps.isArticleInQueue}
     onLike={columnHandlers.handleLike}
     onFavorite={columnHandlers.handleFavorite}
     onBookmark={columnHandlers.handleBookmark}
     onAiAnalysis={columnHandlers.handleAiAnalysis}
     onQueueToggle={columnHandlers.handleQueueToggle}
    />
   </div>
  )
 },

 ArticleDetailPrimaryReader = ({
  articleLoading,
  fullArticleText,
  articleUrl,
  articleSummary,
  showHighlights,
  visibleHighlights,
  activeHighlightId,
  articleContentRef,
  isExpanded,
  highlightColor,
  onHighlightClick,
  onCreate,
  onUpdate,
  onDelete,
 }: Readonly<ArticleDetailPrimaryReaderProps>) => (
  <ModalArticleReader
   articleLoading={articleLoading}
   fullArticleText={fullArticleText}
   articleUrl={articleUrl}
   articleSummary={articleSummary}
   showHighlights={showHighlights}
   visibleHighlights={visibleHighlights}
   activeHighlightId={activeHighlightId}
   onHighlightClick={onHighlightClick}
   articleContentRef={articleContentRef}
   isExpanded={isExpanded}
   highlightColor={highlightColor}
   onCreate={onCreate}
   onUpdate={onUpdate}
   onDelete={onDelete}
  />
 ),

 getDialogBodyClassName = (isExpanded: boolean): string => {
  if (isExpanded) {
   return "h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] rounded-2xl sm:max-w-[calc(100vw-1rem)]"
  }
  return "max-h-[85vh] w-full max-w-6xl rounded-2xl sm:max-w-6xl"
 },

 getDialogColumnsClassName = (isExpanded: boolean): string => {
  if (isExpanded) {
   return "grid gap-8 grid-cols-1 lg:grid-cols-3 gap-12"
  }
  return "grid gap-8 grid-cols-1"
 },

 getPrimaryColumnClassName = (isExpanded: boolean): string => {
  if (isExpanded) {
   return "lg:col-span-2 space-y-8"
  }
  return "space-y-6"
 },

 getScrollContentClassName = (isExpanded: boolean): string => {
  if (isExpanded) {
   return "mx-auto max-w-6xl px-6 py-10 md:px-8 md:py-12"
  }
  return "px-6 py-8 md:px-8"
 }

export { ArticleDetailDialogBody }
