import type {
  ArticleDetailDialogBodyProps,
  ArticleDetailDialogColumnsProps,
} from "../lib/article-detail-modal-data"

interface ArticleDetailBodyHandlerSource {
  readonly onClose: ArticleDetailDialogBodyProps["onClose"]
  readonly onCloseHighlightPopover: ArticleDetailDialogBodyProps["onCloseHighlightPopover"]
  readonly onDialogOpenChange: ArticleDetailDialogBodyProps["onDialogOpenChange"]
  readonly onNavigate?: ArticleDetailDialogBodyProps["onNavigate"]
  readonly onOpenReporterWiki: ArticleDetailDialogBodyProps["onOpenReporterWiki"]
  readonly onOpenSourceWiki: ArticleDetailDialogBodyProps["onOpenSourceWiki"]
  readonly onSaveHighlightNote: ArticleDetailDialogBodyProps["onSaveHighlightNote"]
  readonly onToggleExpanded: ArticleDetailDialogBodyProps["onToggleExpanded"]
}

interface ArticleDetailColumnHandlerSource extends ArticleDetailBodyHandlerSource {
  readonly onAiAnalysis: ArticleDetailDialogColumnsProps["onAiAnalysis"]
  readonly onBackToTop: ArticleDetailDialogColumnsProps["onBackToTop"]
  readonly onBookmark: ArticleDetailDialogColumnsProps["onBookmark"]
  readonly onCancelEdit: ArticleDetailDialogColumnsProps["onCancelEdit"]
  readonly onClaimsOpenChange: ArticleDetailDialogColumnsProps["onClaimsOpenChange"]
  readonly onColorSelect: ArticleDetailDialogColumnsProps["onColorSelect"]
  readonly onCreate: ArticleDetailDialogColumnsProps["onCreate"]
  readonly onDelete: ArticleDetailDialogColumnsProps["onDelete"]
  readonly onFavorite: ArticleDetailDialogColumnsProps["onFavorite"]
  readonly onFilterChange: ArticleDetailDialogColumnsProps["onFilterChange"]
  readonly onHighlightClick: ArticleDetailDialogColumnsProps["onHighlightClick"]
  readonly onHighlightDelete: ArticleDetailDialogColumnsProps["onHighlightDelete"]
  readonly onLike: ArticleDetailDialogColumnsProps["onLike"]
  readonly onNoteChange: ArticleDetailDialogColumnsProps["onNoteChange"]
  readonly onQueueToggle: ArticleDetailDialogColumnsProps["onQueueToggle"]
  readonly onRelatedArticleClick: ArticleDetailDialogColumnsProps["onRelatedArticleClick"]
  readonly onRetrySync: ArticleDetailDialogColumnsProps["onRetrySync"]
  readonly onRunAgenticSearch: ArticleDetailDialogColumnsProps["onRunAgenticSearch"]
  readonly onSaveNote: ArticleDetailDialogColumnsProps["onSaveNote"]
  readonly onSelectClaim: ArticleDetailDialogColumnsProps["onSelectClaim"]
  readonly onStartEdit: ArticleDetailDialogColumnsProps["onStartEdit"]
  readonly onToggleDebug: ArticleDetailDialogColumnsProps["onToggleDebug"]
  readonly onToggleShowHighlights: ArticleDetailDialogColumnsProps["onToggleShowHighlights"]
  readonly onToggleSourceDetails: ArticleDetailDialogColumnsProps["onToggleSourceDetails"]
  readonly onUpdate: ArticleDetailDialogColumnsProps["onUpdate"]
}

const getBodyHandlers = (props: ArticleDetailBodyHandlerSource) => ({
  handleClose: props.onClose,
  handleCloseHighlightPopover: props.onCloseHighlightPopover,
  handleDialogOpenChange: props.onDialogOpenChange,
  handleNavigate: props.onNavigate,
  handleOpenReporterWiki: props.onOpenReporterWiki,
  handleOpenSourceWiki: props.onOpenSourceWiki,
  handleSaveHighlightNote: props.onSaveHighlightNote,
  handleToggleExpanded: props.onToggleExpanded,
}),
 getColumnHandlers = (props: ArticleDetailColumnHandlerSource) => ({
  handleAiAnalysis: props.onAiAnalysis,
  handleBackToTop: props.onBackToTop,
  handleBookmark: props.onBookmark,
  handleCancelEdit: props.onCancelEdit,
  handleClaimsOpenChange: props.onClaimsOpenChange,
  handleClose: props.onClose,
  handleColorSelect: props.onColorSelect,
  handleCreate: props.onCreate,
  handleDelete: props.onDelete,
  handleFavorite: props.onFavorite,
  handleFilterChange: props.onFilterChange,
  handleHighlightClick: props.onHighlightClick,
  handleHighlightDelete: props.onHighlightDelete,
  handleLike: props.onLike,
  handleNoteChange: props.onNoteChange,
  handleOpenReporterWiki: props.onOpenReporterWiki,
  handleOpenSourceWiki: props.onOpenSourceWiki,
  handleQueueToggle: props.onQueueToggle,
  handleRelatedArticleClick: props.onRelatedArticleClick,
  handleRetrySync: props.onRetrySync,
  handleRunAgenticSearch: (claim: ArticleDetailDialogColumnsProps["selectedClaim"]) => {
    void props.onRunAgenticSearch(claim)
  },
  handleSaveNote: props.onSaveNote,
  handleSelectClaim: props.onSelectClaim,
  handleStartEdit: props.onStartEdit,
  handleToggleDebug: props.onToggleDebug,
  handleToggleShowHighlights: props.onToggleShowHighlights,
  handleToggleSourceDetails: props.onToggleSourceDetails,
  handleUpdate: props.onUpdate,
})

export { getBodyHandlers, getColumnHandlers }
