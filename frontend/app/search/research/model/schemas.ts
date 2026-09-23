import type { ResearchStreamMessage, StoredChatState } from "./types";
import { z } from "zod";

const GeoSignalSchema = z.object({
  id: z.string(),
  label: z.string(),
});

const NewsArticleSchema = z
  .object({
    _parsedTimestamp: z.number().optional(),
    _queueData: z
      .object({
        fullText: z.string().optional(),
        preloadedAt: z.number().optional(),
        readingTimeMinutes: z.number().optional(),
      })
      .optional(),
    author: z.string().optional(),
    authors: z.array(z.string()).optional(),
    bias: z.enum(["left", "center", "right"]),
    category: z.string(),
    content: z.string().optional(),
    country: z.string(),
    credibility: z.enum(["high", "medium", "low"]),
    geo_signal: GeoSignalSchema.optional(),
    hasFullContent: z.boolean().optional(),
    id: z.number(),
    image: z.string(),
    isPersisted: z.boolean().optional(),
    mentioned_countries: z.array(z.string()).optional(),
    originalLanguage: z.string(),
    publishedAt: z.string(),
    source: z.string(),
    sourceId: z.string(),
    source_country: z.string().optional(),
    summary: z.string(),
    tags: z.array(z.string()),
    title: z.string(),
    translated: z.boolean(),
    url: z.string(),
  })
  .passthrough();

const StructuredArticleSummarySchema = z.object({
  author: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  link: z.string().optional(),
  published: z.string().optional(),
  source: z.string().optional(),
  summary: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
});

const StructuredClusterValueSchema = z.union([z.boolean(), z.number(), z.string(), z.null()]);
const StructuredClusterSchema = z.record(z.string(), StructuredClusterValueSchema);

const StructuredArticlesPayloadSchema = z.object({
  articles: z.array(StructuredArticleSummarySchema).optional(),
  clusters: z.array(StructuredClusterSchema).optional(),
});

const ThinkingStepSchema = z.object({
  content: z.string(),
  timestamp: z.string(),
  type: z.string(),
});

const ResearchModelOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  model: z.string(),
  provider: z.string(),
});

const ResearchModelCatalogSchema = z.object({
  default: z.string().nullable(),
  models: z.array(ResearchModelOptionSchema),
  provider: z.string(),
});

const ReferencedArticlePayloadSchema = z.object({
  category: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  link: z.string().optional(),
  published: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  title: z.string().optional(),
});

const SemanticResultSchema = z
  .object({
    article: NewsArticleSchema,
    distance: z.number().nullable().optional(),
    similarityScore: z.number().nullable().optional(),
  })
  .passthrough();

const ChatSummarySchema = z
  .object({
    id: z.string(),
    lastMessage: z.string().optional(),
    title: z.string(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

const AssistantVersionMapSchema = z.record(z.string(), z.string());

const ResearchResultSchema = z.object({
  answer: z.string(),
  articles_searched: z.number(),
  error: z.string().optional(),
  query: z.string(),
  referenced_articles: z.array(ReferencedArticlePayloadSchema).optional(),
  structured_articles: z.union([StructuredArticlesPayloadSchema, z.string()]).optional(),
  success: z.boolean(),
  thinking_steps: z.array(ThinkingStepSchema).optional(),
});

const StatusMessageSchema = z.object({
  message: z.string(),
  type: z.literal("status"),
});

const ThinkingStepMessageSchema = z.object({
  step: ThinkingStepSchema,
  type: z.literal("thinking_step"),
});

const ThinkingMessageSchema = z.object({
  content: z.string(),
  timestamp: z.string().optional(),
  type: z.literal("thinking"),
});

const ToolStartMessageSchema = z.object({
  args: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().optional(),
  tool: z.string().nullable().optional(),
  type: z.literal("tool_start"),
});

const ToolResultMessageSchema = z.object({
  content: z.string().optional(),
  timestamp: z.string().optional(),
  tool: z.string().nullable().optional(),
  type: z.literal("tool_result"),
});

const ArticlesJsonMessageSchema = z.object({
  data: z.string(),
  type: z.literal("articles_json"),
});

const ReferencedArticlesMessageSchema = z.object({
  articles: z.array(ReferencedArticlePayloadSchema).optional(),
  type: z.literal("referenced_articles"),
});

const CompleteMessageSchema = z.object({
  result: ResearchResultSchema,
  type: z.literal("complete"),
});

const ErrorMessageSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  model: z.string().nullable().optional(),
  retryable: z.boolean().optional(),
  type: z.literal("error"),
});

const UnknownResearchMessageSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const ResearchStreamMessageSchema = z.union([
  z.object({
    content: z.string(),
    message_id: z.string(),
    reasoning: z.string(),
    type: z.literal("model_delta"),
  }),
  StatusMessageSchema,
  ThinkingStepMessageSchema,
  ThinkingMessageSchema,
  ToolStartMessageSchema,
  ToolResultMessageSchema,
  ArticlesJsonMessageSchema,
  ReferencedArticlesMessageSchema,
  CompleteMessageSchema,
  ErrorMessageSchema,
  UnknownResearchMessageSchema,
]);

const StoredMessageSchema = z
  .object({
    articles_searched: z.number().optional(),
    content: z.string(),
    error: z.boolean().optional(),
    errorCode: z.string().optional(),
    errorModel: z.string().optional(),
    id: z.string(),
    isStreaming: z.boolean().optional(),
    parentMessageId: z.string().optional(),
    referenced_articles: z.array(NewsArticleSchema).optional(),
    retryOfMessageId: z.string().optional(),
    semanticResults: z.array(SemanticResultSchema).optional(),
    streamingStatus: z.string().optional(),
    structured_articles_json: StructuredArticlesPayloadSchema.optional(),
    thinking_steps: z.array(ThinkingStepSchema).optional(),
    timestamp: z.string(),
    toolType: z.literal("semantic_search").optional(),
    type: z.enum(["user", "assistant"]),
  })
  .passthrough();

const StoredChatStateSchema = z
  .object({
    activeAssistantVersionMap: z.record(z.string(), AssistantVersionMapSchema).optional(),
    activeChatId: z.string().nullable().optional(),
    chats: z.array(ChatSummarySchema),
    messages: z.record(z.string(), z.array(StoredMessageSchema)),
    version: z.number(),
  })
  .passthrough();

const parseResearchStreamMessage = (raw: string): ResearchStreamMessage => {
  let value: unknown = undefined;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Research stream message is not valid JSON.");
  }
  const parsed = ResearchStreamMessageSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Research stream message has no valid type.");
  }
  return parsed.data;
};

const parseStoredChatState = (raw: string): StoredChatState | undefined => {
  let value: unknown = undefined;
  try {
    value = JSON.parse(raw);
  } catch {
    return void 0;
  }
  const parsed = StoredChatStateSchema.safeParse(value);
  if (parsed.success) {
  return parsed.data;
}
return void 0;
};
export {
  ResearchModelCatalogSchema,
  StructuredArticlesPayloadSchema,
  parseResearchStreamMessage,
  parseStoredChatState,
};
