"use client"

import {
  ModalAiAnalysisBlock,
  ModalAiStatusBlocks,
  ModalSourceTransparency,
} from "./article-detail-modal-analysis"
import {
  ModalAnnotationsPanel,
  ModalHighlightsList,
} from "./article-detail-modal-actions"
import type { ArticleDetailDialogColumnsProps } from "../lib/article-detail-modal-types"
import { ArticleDetailResearchLinks } from "./article-detail-modal-research"
import { LanguageForensicsCard } from "./article-detail-modal-language"
import { getColumnHandlers } from "./article-detail-modal-handlers"

interface ArticleDetailSidebarProps {
  readonly columnProps: Readonly<ArticleDetailDialogColumnsProps>
}

const ArticleDetailSidebar = ({ columnProps }: Readonly<ArticleDetailSidebarProps>) => (
  <div className="lg:col-span-1 space-y-6">
    <ArticleDetailSidebarReaderTools columnProps={columnProps} />
    <ArticleDetailSidebarResearch columnProps={columnProps} />
  </div>
),

 ArticleDetailSidebarAnalysis = ({ columnProps }: Readonly<ArticleDetailSidebarProps>) => {
  const columnHandlers = getColumnHandlers(columnProps)
  if (columnProps.aiAnalysis === undefined || !columnProps.aiAnalysis.success) {return false}
  return (
    <ModalAiAnalysisBlock
      aiAnalysis={columnProps.aiAnalysis}
      factCheckResults={columnProps.factCheckResults}
      claimsOpen={columnProps.claimsOpen}
      onOpenChange={columnHandlers.handleClaimsOpenChange}
      statusCounts={columnProps.statusCounts}
      activeStatusFilter={columnProps.activeStatusFilter}
      onFilterChange={columnHandlers.handleFilterChange}
      filteredClaims={columnProps.filteredClaims}
      selectedClaim={columnProps.selectedClaim}
      onSelectClaim={columnHandlers.handleSelectClaim}
      agenticLoading={columnProps.agenticLoading}
      agenticError={columnProps.agenticError}
      agenticAnswer={columnProps.agenticAnswer}
      agenticHistory={columnProps.agenticHistory}
      onRunAgenticSearch={columnHandlers.handleRunAgenticSearch}
    />
  )
},

 ArticleDetailSidebarReaderTools = ({ columnProps }: Readonly<ArticleDetailSidebarProps>) => {
  const columnHandlers = getColumnHandlers(columnProps)
  return (
    <>
      <ModalAnnotationsPanel
        highlightCount={columnProps.highlights.length}
        highlightSyncStatus={columnProps.highlightSyncStatus}
        onRetrySync={columnHandlers.handleRetrySync}
        showHighlights={columnProps.showHighlights}
        onToggleShowHighlights={columnHandlers.handleToggleShowHighlights}
        wordCount={columnProps.wordCount}
        estimatedReadMinutes={columnProps.estimatedReadMinutes}
        highlightColor={columnProps.highlightColor}
        onColorSelect={columnHandlers.handleColorSelect}
        obsidianMarkdown={columnProps.obsidianMarkdown}
        articleTitle={columnProps.currentArticle.title}
        articleUrl={columnProps.currentArticle.url}
        articleScrollProgress={columnProps.articleScrollProgress}
        onBackToTop={columnHandlers.handleBackToTop}
      />
      <ModalHighlightsList
        highlights={columnProps.highlights}
        articleTitle={columnProps.currentArticle.title}
        articleSource={columnProps.currentArticle.source}
        onHighlightClick={columnHandlers.handleHighlightClick}
        articleContentRef={columnProps.articleContentRef}
        editingId={columnProps.editingId}
        editingNote={columnProps.editingNote}
        onStartEdit={columnHandlers.handleStartEdit}
        onCancelEdit={columnHandlers.handleCancelEdit}
        onNoteChange={columnHandlers.handleNoteChange}
        onSaveNote={columnHandlers.handleSaveNote}
        onDelete={columnHandlers.handleHighlightDelete}
      />
      <ModalAiStatusBlocks
        aiAnalysisRequested={columnProps.aiAnalysisRequested}
        aiAnalysisLoading={columnProps.aiAnalysisLoading}
        aiAnalysis={columnProps.aiAnalysis}
      />
      <LanguageForensicsCard
        diagnostics={columnProps.languageDiagnostics}
        loading={columnProps.languageDiagnosticsLoading}
        error={columnProps.languageDiagnosticsError ?? columnProps.languageDiagnostics?.error}
      />
    </>
  )
},

 ArticleDetailSidebarResearch = ({ columnProps }: Readonly<ArticleDetailSidebarProps>) => {
  const columnHandlers = getColumnHandlers(columnProps)
  return (
    <>
      <ArticleDetailResearchLinks
        sourceName={columnProps.currentArticle.source}
        website={columnProps.articleHost}
        articleId={columnProps.currentArticle.id}
        onArticleClick={columnHandlers.handleRelatedArticleClick}
      />
      <ArticleDetailSidebarAnalysis columnProps={columnProps} />
      <ModalSourceTransparency
        sourceLoading={columnProps.sourceLoading}
        source={columnProps.source}
        article={columnProps.currentArticle}
        reporterName={columnProps.reporterName}
        showSourceDetails={columnProps.showSourceDetails}
        onToggleDetails={columnHandlers.handleToggleSourceDetails}
        debugMode={columnProps.debugMode}
        debugOpen={columnProps.debugOpen}
        debugLoading={columnProps.debugLoading}
        debugData={columnProps.debugData}
        matchedEntryIndex={columnProps.matchedEntryIndex}
        onToggleDebug={columnHandlers.handleToggleDebug}
        onOpenSourceWiki={columnHandlers.handleOpenSourceWiki}
        onOpenReporterWiki={columnHandlers.handleOpenReporterWiki}
        onClose={columnHandlers.handleClose}
      />
    </>
  )
}

export { ArticleDetailSidebar }
