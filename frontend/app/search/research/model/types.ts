import type { ApiOpaqueObject, NewsArticle, SemanticSearchResult, ThinkingStep } from "@/lib/api";
import type { ChatSummary } from "@/components/chat-sidebar";

type ReadonlyChatSummary = Readonly<ChatSummary>;
type ReadonlyNewsArticle = Readonly<Omit<NewsArticle, "_queueData">>;
type ReadonlySemanticSearchResult = Readonly<Omit<SemanticSearchResult, "article">> & {
  readonly article: ReadonlyNewsArticle;
};
type ReadonlyThinkingStep = Readonly<ThinkingStep>;

type ResearchModelOption = Readonly<{
  id: string;
  label: string;
  model: string;
  provider: string;
}>;

type ResearchModelCatalog = Readonly<{
  default: string | null;
  models: readonly ResearchModelOption[];
  provider: string;
}>;

type ResearchActivity = Readonly<{
  args?: Readonly<ApiOpaqueObject>;
  content: string;
  id: string;
  timestamp?: string;
  tool?: string | null;
  type: "thought" | "tool_start" | "tool_result";
}>;

type ReferencedArticlePayload = Readonly<{
  category?: string;
  description?: string;
  image?: string;
  link?: string;
  published?: string;
  source?: string;
  tags?: readonly string[];
  title?: string;
}>;

type StructuredArticleSummary = Readonly<{
  author?: string;
  category?: string;
  description?: string;
  image?: string;
  link?: string;
  published?: string;
  source?: string;
  summary?: string;
  title?: string;
  url?: string;
}>;

type StructuredArticleCluster = Readonly<Record<string, string | number | boolean | null>>;

type StructuredArticlesPayload = Readonly<{
  articles?: readonly StructuredArticleSummary[];
  clusters?: readonly StructuredArticleCluster[];
}>;

type ResearchResult = Readonly<{
  answer: string;
  articles_searched: number;
  error?: string;
  query: string;
  referenced_articles?: readonly ReferencedArticlePayload[];
  structured_articles?: StructuredArticlesPayload | string;
  success: boolean;
  thinking_steps?: readonly ReadonlyThinkingStep[];
}>;

type Message = Readonly<{
  streamingText?: string;
  streamingReasoning?: string;
  streamingMessageId?: string;
  articles_searched?: number;
  activities?: readonly ResearchActivity[];
  content: string;
  errorCode?: string;
  errorModel?: string;
  error?: boolean;
  id: string;
  isStreaming?: boolean;
  parentMessageId?: string;
  referenced_articles?: readonly ReadonlyNewsArticle[];
  retryOfMessageId?: string;
  semanticResults?: readonly ReadonlySemanticSearchResult[];
  streamingStatus?: string;
  structured_articles_json?: StructuredArticlesPayload;
  thinking_steps?: readonly ReadonlyThinkingStep[];
  timestamp: Readonly<Date>;
  toolType?: "semantic_search";
  type: "user" | "assistant";
}>;

interface ChatMessageUpdateOptions {
  readonly summaryPreview?: string;
  readonly syncSummary?: boolean;
  readonly updatedAt?: string;
}

type UpdateChatMessages = (
  chatId: string,
  updater: (previous: readonly Message[]) => readonly Message[],
  options?: Readonly<ChatMessageUpdateOptions>,
) => void;

interface StartResearchParameters {
  readonly chatId: string;
  readonly newChatTitle?: string;
  readonly parentMessageId?: string;
  readonly prompt: string;
  readonly retryGroupId?: string;
  readonly seedMessages: readonly Message[];
  readonly model?: string;
  readonly versionSelectionOverrides?: Readonly<Record<string, string>>;
}

type ResearchStreamState = Readonly<{
  activities: readonly ResearchActivity[];
  addActivity: (activity: ResearchActivity) => void;
  addThinkingStep: (step: ReadonlyThinkingStep) => void;
  clearStallTimeout: () => void;
  setClearStallTimeout: (clear: () => void) => void;
  setStructuredArticles: (articles: StructuredArticlesPayload) => void;
  structuredArticles?: StructuredArticlesPayload;
  thinkingSteps: readonly ReadonlyThinkingStep[];
}>;

type StatusMessage = Readonly<{
  type: "status";
  message: string;
}>;

type ThinkingStepMessage = Readonly<{
  type: "thinking_step";
  step: ReadonlyThinkingStep;
}>;

type ThinkingMessage = Readonly<{
  content: string;
  timestamp?: string;
  type: "thinking";
}>;

type ModelDeltaMessage = Readonly<{
  type: "model_delta";
  message_id: string;
  content: string;
  reasoning: string;
}>;

type ToolStartMessage = Readonly<{
  args?: Readonly<ApiOpaqueObject>;
  timestamp?: string;
  tool?: string | null;
  type: "tool_start";
}>;

type ToolResultMessage = Readonly<{
  content?: string;
  timestamp?: string;
  tool?: string | null;
  type: "tool_result";
}>;

type ArticlesJsonMessage = Readonly<{
  type: "articles_json";
  data: string;
}>;

type ReferencedArticlesMessage = Readonly<{
  type: "referenced_articles";
  articles?: readonly ReferencedArticlePayload[];
}>;

type CompleteMessage = Readonly<{
  type: "complete";
  result: ResearchResult;
}>;

type ErrorMessage = Readonly<{
  code?: string;
  type: "error";
  message?: string;
  model?: string | null;
  retryable?: boolean;
}>;

type UnknownMessage = Readonly<{
  type: string;
}>;

type ResearchStreamMessage =
  | ModelDeltaMessage
  | StatusMessage
  | ThinkingStepMessage
  | ThinkingMessage
  | ToolStartMessage
  | ToolResultMessage
  | ArticlesJsonMessage
  | ReferencedArticlesMessage
  | CompleteMessage
  | ErrorMessage
  | UnknownMessage;

type StoredMessage = Omit<Message, "timestamp"> &
  Readonly<{
    timestamp: string;
  }>;

type StoredChatState = Readonly<{
  version: number;
  activeChatId?: string | null;
  chats: readonly ReadonlyChatSummary[];
  activeAssistantVersionMap?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  messages: Readonly<Record<string, readonly StoredMessage[]>>;
}>;

type ResearchStreamContext = Readonly<{
  assistantGroupId: string;
  assistantId: string;
  chatId: string;
  focusInput: () => void;
  isCurrentRequest: () => boolean;
  retryGroupId?: string;
  setActiveAssistantVersion: (chatId: string, groupId: string, messageId: string) => void;
  setIsSearching: (searching: boolean) => void;
  streamState: ResearchStreamState;
  updateChatMessages: UpdateChatMessages;
}>;
export type {
  ModelDeltaMessage,
  ReadonlyChatSummary,
  ReadonlyNewsArticle,
  ReadonlySemanticSearchResult,
  ReadonlyThinkingStep,
  ResearchActivity,
  ResearchModelCatalog,
  ResearchModelOption,
  ReferencedArticlePayload,
  StructuredArticleSummary,
  StructuredArticlesPayload,
  Message,
  ChatMessageUpdateOptions,
  UpdateChatMessages,
  StartResearchParameters,
  ResearchStreamState,
  StatusMessage,
  ThinkingStepMessage,
  ThinkingMessage,
  ToolStartMessage,
  ToolResultMessage,
  ArticlesJsonMessage,
  ReferencedArticlesMessage,
  CompleteMessage,
  ErrorMessage,
  ResearchStreamMessage,
  StoredMessage,
  StoredChatState,
  ResearchStreamContext,
};

export type { DeepReadonly } from "@/lib/deep-readonly";
