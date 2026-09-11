import {
  API_BASE_URL,
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
import type {
  ArticleDetailServices,
  ArticleExtractionResponse,
  ModalHighlightLoaderProps,
} from "./article-detail-modal-types"
import type { Highlight, NewsArticle } from "./api"
import { loadHighlightStore, mergeHighlights, saveHighlightStore } from "./highlight-store"
import type { LocalHighlight } from "./highlight-store"
import { z } from "zod"

type ArticleTextInput = Readonly<Pick<NewsArticle, "content" | "hasFullContent" | "id" | "url">>

interface ExtractionResponse {
  readonly ok: boolean
  readonly json: () => Promise<ArticleExtractionResponse>
}

interface ModalHighlightStoreSnapshot {
  readonly highlights: readonly Readonly<LocalHighlight>[]
}

const ARTICLE_EXTRACTION_RESPONSE_SCHEMA = z.object({
  full_text: z.string().optional(),
  text: z.string().optional(),
}) satisfies z.ZodType<ArticleExtractionResponse>,
 DEFAULT_ARTICLE_DETAIL_SERVICES: ArticleDetailServices = {
  analyzeArticle,
  createHighlight,
  deleteHighlight,
  fetchLanguageDiagnostics,
  fetchSourceDebugData,
  getHighlightsForArticle,
  getSourceById,
  performAgenticSearch,
 updateHighlight,
},

 HIGHLIGHT_STORE_VERSION = 1,

 fetchFullArticleText = async (
  article: ArticleTextInput,
  articleCacheKey: string,
  signal?: Readonly<AbortSignal>,
): Promise<string | undefined> => {
  if (fullArticleCache.has(articleCacheKey)) {return fullArticleCache.get(articleCacheKey)}

  const initialText = getInitialArticleText(article)
  if (!isExtractableUrl(article.url)) {
    fullArticleCache.set(articleCacheKey, initialText)
    return initialText
  }

  {
    const resolvedText = await requestFullArticleText(article.url, initialText, signal)
    fullArticleCache.set(articleCacheKey, resolvedText)
    return resolvedText
  }
 },

 fullArticleCache = new Map<string, string | undefined>(),

 getArticleCacheKey = (article: Readonly<Pick<NewsArticle, "id" | "url">>): string => {
  if (isExtractableUrl(article.url)) {return article.url}
 return `article_${article.id}`
},

 getHighlightErrorMessage = (error: Readonly<Error>): string => error.message,

 getInitialArticleText = (article: Readonly<Pick<NewsArticle, "content" | "hasFullContent">>): string | undefined => {
  if (article.hasFullContent === true && isNonEmptyString(article.content)) {
    return article.content
  }
  return undefined
 },

 handleExtractionError = (error: Readonly<Error>, initialText: string | undefined): string | undefined => {
  if (!(error instanceof DOMException && error.name === "AbortError")) {
    console.error("Failed to fetch full article:", error)
  }
  return initialText
},

 isExtractableUrl = (url?: string | null): boolean => {
  if (url === undefined || url === null || url.trim() === "") {return false}
 return /^https?:\/\//iu.test(url)
},

 isNonEmptyString = (value: string | null | undefined): value is string =>
  value !== undefined && value !== null && value.trim() !== "",

loadModalHighlights = ({ articleUrl, debugEnabled, services, setHighlights }: Readonly<ModalHighlightLoaderProps>): void => {
  const store = loadHighlightStore(articleUrl)
  setHighlights(store.highlights)
  logHighlightDebug(debugEnabled, "[Highlights] loaded local store", { count: store.highlights.length, url: articleUrl })
  void loadRemoteHighlights({ articleUrl, debugEnabled, localStore: store, services, setHighlights })
},

loadRemoteHighlights = async ({ articleUrl, debugEnabled, localStore, services, setHighlights }: Readonly<{
  articleUrl: string
  debugEnabled: boolean
  localStore: ModalHighlightStoreSnapshot
  services: Readonly<ArticleDetailServices>
  setHighlights: (highlights: readonly Readonly<LocalHighlight>[]) => void
}>): Promise<void> => {
  try {
    const serverHighlights = await services.getHighlightsForArticle(articleUrl)
    storeRemoteHighlights(articleUrl, localStore.highlights, serverHighlights, debugEnabled, setHighlights)
  } catch (error) {
    console.error("Failed to load highlights", error)
    let errorMessage = String(error)
    if (error instanceof Error) {
      errorMessage = getHighlightErrorMessage(error)
    }
    logHighlightDebug(debugEnabled, "[Highlights] fetch failed", { error: errorMessage, online: globalThis.navigator.onLine, url: articleUrl })
  }
},

 logHighlightDebug = (
  enabled: boolean,
  message: string,
  details: Readonly<{ count?: number; error?: string; online?: boolean; url: string }>,
): void => {
  if (enabled) {
    console.debug(message, details)
  }
},

 logHighlightMerge = (
  enabled: boolean,
  articleUrl: string,
  serverCount: number,
  mergedCount: number,
): void => {
  logHighlightDebug(enabled, "[Highlights] fetched server highlights", { count: serverCount, url: articleUrl })
  logHighlightDebug(enabled, "[Highlights] merged highlights", { count: mergedCount, url: articleUrl })
},

 readExtractionText = async (response: ExtractionResponse): Promise<string | undefined> => {
  if (!response.ok) {return undefined}

  const parsed = ARTICLE_EXTRACTION_RESPONSE_SCHEMA.safeParse(await response.json())
  if (!parsed.success) {return undefined}
  return parsed.data.text ?? parsed.data.full_text
},

requestFullArticleText = async (
  articleUrl: string,
  initialText: string | undefined,
  signal?: Readonly<AbortSignal>,
): Promise<string | undefined> => {
  try {
    const extractedText = await fetch(`${API_BASE_URL}/article/extract?url=${encodeURIComponent(articleUrl)}`, { signal })
      .then(readExtractionText)
    return extractedText ?? initialText
  } catch (error) {
    if (error instanceof Error) {return handleExtractionError(error, initialText)}
    return handleExtractionError(new Error(String(error)), initialText)
  }
},

storeRemoteHighlights = (
  articleUrl: string,
  localHighlights: readonly Readonly<LocalHighlight>[],
  serverHighlights: readonly Readonly<Highlight>[],
  debugEnabled: boolean,
  setHighlights: (highlights: readonly Readonly<LocalHighlight>[]) => void,
): void => {
  const merged = mergeHighlights({
    articleUrl,
    local: [...localHighlights],
    server: [...serverHighlights],
  })
  logHighlightMerge(debugEnabled, articleUrl, serverHighlights.length, merged.length)
  setHighlights(merged)
  saveHighlightStore({ article_url: articleUrl, highlights: merged, version: HIGHLIGHT_STORE_VERSION })
}

export {
  DEFAULT_ARTICLE_DETAIL_SERVICES,
  HIGHLIGHT_STORE_VERSION,
  fetchFullArticleText,
  getArticleCacheKey,
  getInitialArticleText,
  isExtractableUrl,
  isNonEmptyString,
  loadModalHighlights,
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
  ModalActionButtonsProps,
  ModalActionsProps,
  ModalHighlightActionsProps,
  ModalHighlightEditorActionsProps,
  ModalHighlightHistoryProps,
  ModalHighlightLoaderProps,
  ModalHighlightSyncStatus,
  UpdateHighlightHandler,
  UpdateHighlightPayload,
} from "./article-detail-modal-types"

export type {
  ArticleAnalysis,
  FactCheckResult,
  Highlight,
  LanguageDiagnosticExample,
  LanguageDiagnosticMetric,
  LanguageDiagnostics,
  NewsArticle,
  NewsSource,
  SourceDebugData,
} from "./api"

export type { LocalHighlight } from "./highlight-store"

export {
  buildObsidianMarkdown,
  highlightStableId,
} from "./highlight-utils"

export {
  createHighlightFingerprint,
  dedupeLocalHighlights,
  generateClientId,
  loadHighlightStore,
  markFailed,
  markPending,
  markSynced,
  mergeHighlights,
  saveHighlightStore,
  toRemoteHighlights,
} from "./highlight-store"
