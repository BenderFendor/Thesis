import type {
  ArticleAnalysis,
  FactCheckResult,
  Highlight,
  LanguageDiagnosticExample,
  LanguageDiagnosticMetric,
  LanguageDiagnostics,
  NewsArticle,
  NewsSource,
  SourceDebugData,
  analyzeArticle,
  createHighlight,
  deleteHighlight,
  fetchLanguageDiagnostics,
  fetchSourceDebugData,
  getHighlightsForArticle,
  getSourceById,
  performAgenticSearch,
  updateHighlight,
} from "./api"
import type { Dispatch, RefObject, SetStateAction } from "react"
import type { LocalHighlight } from "./highlight-store"
import type { useInlineDefinition } from "../hooks/use-inline-definition"

type FactCheckStatus = FactCheckResult["verification_status"]
type FactCheckStatusFilter = FactCheckStatus | "all"
type LanguageMetricKey = "passive_voice" | "actor_omission" | "euphemisms"
type LanguageStatus = "low" | "medium" | "high"
type ModalHighlightSyncStatus = "idle" | "syncing" | "failed" | "offline"

interface ArticleExtractionResponse {
  readonly text?: string
  readonly full_text?: string
}

interface HighlightRange {
  readonly start: number
  readonly end: number
}

interface CreateHighlightPayload {
  readonly highlightedText: string
  readonly color: Highlight["color"]
  readonly range: HighlightRange
}

interface UpdateHighlightPayload {
  readonly highlightId: number
  readonly note: string
}

interface DeleteHighlightPayload {
  readonly highlightId: number
}

interface HighlightAnchorElement {
  readonly contains: HTMLElement["contains"]
  readonly getBoundingClientRect: () => DOMRect
}

type HighlightClickHandler = (stableId: string, element: HighlightAnchorElement) => void
type CreateHighlightHandler = (payload: Readonly<CreateHighlightPayload>) => Promise<void> | void
type UpdateHighlightHandler = (payload: Readonly<UpdateHighlightPayload>) => Promise<void> | void
type DeleteHighlightHandler = (payload: Readonly<DeleteHighlightPayload>) => Promise<void> | void
type ReadonlyLocalHighlights = readonly Readonly<LocalHighlight>[]

interface LanguageForensicsCardProps {
  readonly diagnostics?: Readonly<LanguageDiagnostics> | null
  readonly loading: boolean
  readonly error?: string | null
}

interface LanguageMetricCardProps {
  readonly label: string
  readonly metric?: Readonly<LanguageDiagnosticMetric>
}

interface LanguageExampleCardProps {
  readonly example: Readonly<LanguageDiagnosticExample>
}

interface HighlightSyncController {
  readonly latestSyncToken: Readonly<{ current: number }>
  readonly setLatestSyncToken: (token: number) => void
  readonly services: ArticleDetailServices
  readonly setHighlights: (highlights: ReadonlyLocalHighlights) => void
  readonly setStatus: (status: ModalHighlightSyncStatus) => void
}

interface ModalActionsProps {
  readonly article: Readonly<NewsArticle>
  readonly canPersist: boolean
  readonly bookmarkLoading: boolean
  readonly aiAnalysisLoading: boolean
  readonly canRequestAiAnalysis: boolean
  readonly aiAnalysisRequested: boolean
  readonly aiHasError: boolean
  readonly aiActionLabel: string
  readonly isLiked: (articleId: number) => boolean
  readonly isFavorite: (sourceId: string) => boolean
  readonly isBookmarked: (articleId: number) => boolean
  readonly isArticleInQueue: (url: string) => boolean
  readonly onLike: () => void
  readonly onFavorite: () => void
  readonly onBookmark: () => void
  readonly onAiAnalysis: () => void
  readonly onQueueToggle: () => void
}

interface ModalActionButtonsProps {
  readonly canPersist: boolean
  readonly bookmarkLoading: boolean
  readonly aiAnalysisLoading: boolean
  readonly canRequestAiAnalysis: boolean
  readonly aiAnalysisRequested: boolean
  readonly aiHasError: boolean
  readonly aiActionLabel: string
  readonly liked: boolean
  readonly favorited: boolean
  readonly bookmarked: boolean
  readonly inQueue: boolean
  readonly onLike: () => void
  readonly onFavorite: () => void
  readonly onBookmark: () => void
  readonly onAiAnalysis: () => void
  readonly onQueueToggle: () => void
}

interface ActionIconProps {
  readonly active: boolean
}

interface ArticleDetailServices {
  readonly analyzeArticle: typeof analyzeArticle
  readonly createHighlight: typeof createHighlight
  readonly deleteHighlight: typeof deleteHighlight
  readonly fetchLanguageDiagnostics: typeof fetchLanguageDiagnostics
  readonly fetchSourceDebugData: typeof fetchSourceDebugData
  readonly getHighlightsForArticle: typeof getHighlightsForArticle
  readonly getSourceById: typeof getSourceById
  readonly performAgenticSearch: typeof performAgenticSearch
  readonly updateHighlight: typeof updateHighlight
}

interface ArticleDetailModalProps {
  article: NewsArticle | null
  isOpen: boolean
  onClose: () => void
  onBookmarkChange?: (articleId: number, isBookmarked: boolean) => void
  onNavigate?: (direction: "prev" | "next") => void
  layoutIdPrefix?: string
  services?: ArticleDetailServices
}

interface ArticleDetailDialogBodyProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly onDialogOpenChange: (open: boolean) => void
  readonly currentArticle: Readonly<NewsArticle>
  readonly layoutIdPrefix?: string
  readonly inlineResult: ReturnType<typeof useInlineDefinition>["result"]
  readonly inlineOpen: boolean
  readonly setInlineOpen: (open: boolean) => void
  readonly inlineAnchorPosition: ReturnType<typeof useInlineDefinition>["anchorPosition"]
  readonly highlightPopoverOpen: boolean
  readonly highlightPopoverHighlight: LocalHighlight | undefined
  readonly highlightPopoverAnchorEl: HighlightAnchorElement | undefined
  readonly onCloseHighlightPopover: () => void
  readonly onSaveHighlightNote: (highlightId: string, note: string) => Promise<void>
  readonly wikiPanelOpen: boolean
  readonly setWikiPanelOpen: (open: boolean) => void
  readonly wikiPanelTab: "source" | "reporter"
  readonly setWikiPanelTab: (tab: "source" | "reporter") => void
  readonly reporterName: string
  readonly hasSourceWiki: boolean
  readonly hasReporterWiki: boolean
  readonly articleHost?: string
  readonly articleWikiContext: string
  readonly onNavigate?: (direction: "prev" | "next") => void
  readonly handleNavigate: (direction: "prev" | "next") => void
  readonly isExpanded: boolean
  readonly onToggleExpanded: () => void
  readonly articleScrollProgress: number
  readonly progressTrackRef: Readonly<RefObject<HTMLDivElement | null>>
  readonly contentScrollRef: Readonly<RefObject<HTMLDivElement | null>>
  readonly articleContentRef: Readonly<RefObject<HTMLDivElement | null>>
  readonly fullArticleText: string | undefined
  readonly articleLoading: boolean
  readonly showSummary: boolean
  readonly visibleHighlights: readonly Highlight[]
  readonly showHighlights: boolean
  readonly activeHighlightId: string | undefined
  readonly highlightColor: Highlight["color"]
  readonly onHighlightClick: HighlightClickHandler
  readonly onCreate: CreateHighlightHandler
  readonly onUpdate: UpdateHighlightHandler
  readonly onDelete: DeleteHighlightHandler
  readonly aiAnalysis: ArticleAnalysis | undefined
  readonly aiAnalysisLoading: boolean
  readonly bookmarkLoading: boolean
  readonly canPersistArticle: boolean
  readonly canRequestAiAnalysis: boolean
  readonly aiAnalysisRequested: boolean
  readonly aiHasError: boolean
  readonly aiActionLabel: string
  readonly isLiked: (articleId: number) => boolean
  readonly isFavorite: (sourceId: string) => boolean
  readonly isBookmarked: (articleId: number) => boolean
  readonly isArticleInQueue: (url: string) => boolean
  readonly onLike: () => void
  readonly onFavorite: () => void
  readonly onBookmark: () => void
  readonly onAiAnalysis: () => void
  readonly onQueueToggle: () => void
  readonly highlights: readonly LocalHighlight[]
  readonly highlightSyncStatus: ModalHighlightSyncStatus
  readonly onRetrySync: () => void
  readonly onToggleShowHighlights: () => void
  readonly wordCount: number
  readonly estimatedReadMinutes: number
  readonly onColorSelect: (color: Highlight["color"]) => void
  readonly obsidianMarkdown: string
  readonly onBackToTop: () => void
  readonly editingId: string | undefined
  readonly editingNote: string
  readonly onStartEdit: (highlight: Readonly<LocalHighlight>) => void
  readonly onCancelEdit: () => void
  readonly onNoteChange: (value: string) => void
  readonly onSaveNote: (stableId: string, note: string) => void
  readonly onHighlightDelete: (highlight: Readonly<LocalHighlight>) => void
  readonly languageDiagnostics: Readonly<LanguageDiagnostics> | null | undefined
  readonly languageDiagnosticsLoading: boolean
  readonly languageDiagnosticsError?: string
  readonly sourceLoading: boolean
  readonly source: NewsSource | undefined
  readonly showSourceDetails: boolean
  readonly onToggleSourceDetails: () => void
  readonly debugMode: boolean
  readonly debugOpen: boolean
  readonly debugLoading: boolean
  readonly debugData: SourceDebugData | undefined
  readonly matchedEntryIndex: number | undefined
  readonly onToggleDebug: () => void
  readonly onOpenSourceWiki: () => void
  readonly onOpenReporterWiki: () => void
  readonly onRelatedArticleClick: (article: Readonly<{ url: string }>) => void
  readonly factCheckResults: readonly FactCheckResult[]
  readonly claimsOpen: boolean
  readonly onClaimsOpenChange: (open: boolean) => void
  readonly statusCounts: Readonly<Record<FactCheckStatus, number>>
  readonly activeStatusFilter: FactCheckStatusFilter
  readonly onFilterChange: (filter: FactCheckStatusFilter) => void
  readonly filteredClaims: readonly FactCheckResult[]
  readonly selectedClaim: FactCheckResult | undefined
  readonly onSelectClaim: (claim: Readonly<FactCheckResult>) => void
  readonly agenticLoading: boolean
  readonly agenticError: string | undefined
  readonly agenticAnswer: string | undefined
  readonly agenticHistory: readonly Readonly<{ claim: string; answer: string; timestamp: number }>[]
  readonly onRunAgenticSearch: (claim: Readonly<FactCheckResult> | undefined) => Promise<void>
}

interface ArticleDetailDialogColumnsProps extends Omit<ArticleDetailDialogBodyProps, "contentScrollRef" | "progressTrackRef"> {}

type ArticleScrollAction =
  | { readonly kind: "scroll"; readonly amount: number }
  | { readonly direction: "next" | "prev"; readonly kind: "navigate" }

interface DebugLoaderState {
  readonly article: NewsArticle
  readonly services: ArticleDetailServices
  readonly setDebugData: (data: Readonly<SourceDebugData> | undefined) => void
  readonly setDebugLoading: (loading: boolean) => void
  readonly setMatchedEntryIndex: (index: number | undefined) => void
}

interface ModalHighlightLoaderProps {
  readonly articleUrl: string
  readonly services: ArticleDetailServices
  readonly debugEnabled: boolean
  readonly setHighlights: (highlights: ReadonlyLocalHighlights) => void
  readonly setStatus: (status: ModalHighlightSyncStatus) => void
}

interface ArticleBookmarkActionProps {
  readonly article: NewsArticle
  readonly isBookmarked: (articleId: number) => boolean
  readonly onBookmarkChange?: (articleId: number, isBookmarked: boolean) => void
  readonly setBookmarkLoading: (loading: boolean) => void
  readonly toggleBookmark: (articleId: number) => Promise<void>
}

type LocalHighlightStateSetter = Dispatch<SetStateAction<LocalHighlight[]>>

type LocalHighlightHistorySetter = Dispatch<SetStateAction<LocalHighlight[][]>>

interface ModalHighlightHistoryProps {
  readonly article: NewsArticle
  readonly latestHighlightSyncRef: { current: number }
  readonly services: ArticleDetailServices
  readonly setHighlightSyncStatus: (status: ModalHighlightSyncStatus) => void
  readonly setHighlights: LocalHighlightStateSetter
  readonly setHighlightsHistory: LocalHighlightHistorySetter
}

interface ModalHighlightActionsProps {
  readonly article: NewsArticle
  readonly articleContentRef: { current: HTMLDivElement | null }
  readonly highlights: ReadonlyLocalHighlights
  readonly lastCreatedClientIdRef: { current: string | undefined }
  readonly setActiveHighlightId: (id: string | undefined) => void
  readonly setHighlightColor: (color: Highlight["color"]) => void
  readonly setHighlightPopoverAnchorEl: (element: HighlightAnchorElement | undefined) => void
  readonly setHighlightPopoverHighlight: (highlight: Readonly<LocalHighlight> | undefined) => void
  readonly setHighlightPopoverOpen: (open: boolean) => void
  readonly updateHighlightsWithHistory: (updater: (previous: ReadonlyLocalHighlights) => LocalHighlight[]) => void
  readonly runHighlightOperations: (articleUrl: string, current: ReadonlyLocalHighlights) => void
  readonly setShowHighlights: (update: boolean | ((previous: boolean) => boolean)) => void
}

interface ModalHighlightEditorActionsProps {
  readonly handleSaveHighlightNote: (highlightId: string, note: string) => Promise<void>
  readonly setSidebarEditingId: (id: string | undefined) => void
  readonly setSidebarEditingNote: (note: string) => void
  readonly updateHighlightByStableId: (stableId: string, updater: (highlight: Readonly<LocalHighlight>) => LocalHighlight) => void
  readonly updateHighlightsWithHistory: (updater: (previous: ReadonlyLocalHighlights) => LocalHighlight[]) => void
}

interface ArticleDetailModalViewProps extends ArticleDetailDialogBodyProps {
  readonly article: NewsArticle
  readonly debugEnabled: boolean
  readonly handleUndo: () => void
  readonly markAsRead: (articleId: number, title?: string, source?: string) => void
  readonly services: ArticleDetailServices
  readonly setArticleScrollProgress: (progress: number) => void
  readonly setHighlightSyncStatus: (status: ModalHighlightSyncStatus) => void
  readonly setHighlights: LocalHighlightStateSetter
  readonly setSelectedClaim: (claim: Readonly<FactCheckResult> | undefined) => void
}

export type {
  ActionIconProps,
  ArticleBookmarkActionProps,
  ArticleDetailDialogBodyProps,
  ArticleDetailDialogColumnsProps,
  ArticleDetailModalProps,
  ArticleDetailModalViewProps,
  ArticleDetailServices,
  ArticleExtractionResponse,
  ArticleScrollAction,
  CreateHighlightHandler,
  CreateHighlightPayload,
  DebugLoaderState,
  DeleteHighlightHandler,
  DeleteHighlightPayload,
  FactCheckStatus,
  FactCheckStatusFilter,
  HighlightAnchorElement,
  HighlightClickHandler,
  HighlightRange,
  HighlightSyncController,
  LanguageExampleCardProps,
  LanguageForensicsCardProps,
  LanguageMetricCardProps,
  LanguageMetricKey,
  LanguageStatus,
  LocalHighlightHistorySetter,
  LocalHighlightStateSetter,
  ModalActionButtonsProps,
  ModalActionsProps,
  ModalHighlightActionsProps,
  ModalHighlightEditorActionsProps,
  ModalHighlightHistoryProps,
  ModalHighlightLoaderProps,
  ModalHighlightSyncStatus,
  UpdateHighlightHandler,
  UpdateHighlightPayload,
}
