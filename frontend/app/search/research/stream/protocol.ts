import type {
  ArticlesJsonMessage,
  CompleteMessage,
  ErrorMessage,
  Message,
  ReferencedArticlesMessage,
  ResearchStreamContext,
  ResearchStreamMessage,
  StatusMessage,
  StructuredArticlesPayload,
  ThinkingStepMessage,
} from "../model/types";
import { StructuredArticlesPayloadSchema, parseResearchStreamMessage } from "../model/schemas";
import { mapReferencedArticleToNewsArticle } from "../model/articles";
import {
  processRawResearchEvent,
  processModelDelta,
  processResearchThinking,
  updateAssistantMessage,
} from "./activity-protocol";

const FIRST_INDEX = 0;
const STREAM_DATA_PREFIX_LENGTH = 6;
const STRUCTURED_ARTICLE_BLOCK_PATTERN = /```json:articles\n(?<json>[\s\S]*?)\n```/u;
const SUMMARY_PREVIEW_LENGTH = 200;
const SEARCH_STREAM_STALL_TIMEOUT_MS = 30_000;

const parseStructuredArticles = (raw: string): StructuredArticlesPayload | undefined => {
  try {
    const parsed = StructuredArticlesPayloadSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
  return parsed.data;
}
return void 0;
  } catch {
    return void 0;
  }
};

const parseStructuredArticleBlock = (raw: string): StructuredArticlesPayload | undefined => {
  const json = STRUCTURED_ARTICLE_BLOCK_PATTERN.exec(raw)?.groups?.json;
  if (json === undefined || json.length === FIRST_INDEX) {
    return void 0;
  }
  return parseStructuredArticles(json);
};

const installResearchStallTimeout = (
  streamContext: Readonly<ResearchStreamContext>,
): ReturnType<typeof globalThis.setTimeout> => {
  const stallTimeout = globalThis.setTimeout(() => {
    updateAssistantMessage(
      streamContext,
      (message) => ({
        ...message,
        streamingStatus: "Still working. Gathering more coverage.",
      }),
      { syncSummary: false },
    );
  }, SEARCH_STREAM_STALL_TIMEOUT_MS);
  streamContext.streamState.setClearStallTimeout(() => {
    globalThis.clearTimeout(stallTimeout);
  });
  return stallTimeout;
};

const processResearchStatus = (
  data: Readonly<StatusMessage>,
  context: Readonly<ResearchStreamContext>,
): void => {
  updateAssistantMessage(
    context,
    (message) => ({
      ...message,
      streamingStatus: data.message,
    }),
    { syncSummary: false },
  );
};

const processResearchArticles = (
  data: Readonly<ArticlesJsonMessage>,
  context: Readonly<ResearchStreamContext>,
): void => {
  const parsed = parseStructuredArticles(data.data) ?? parseStructuredArticleBlock(data.data);
  if (parsed === undefined) {
    return;
  }
  context.streamState.setStructuredArticles(parsed);
  updateAssistantMessage(
    context,
    (message) => ({
      ...message,
      streamingStatus: "Article data ready.",
      structured_articles_json: parsed,
    }),
    { syncSummary: false },
  );
};

const processReferencedArticles = (
  data: Readonly<ReferencedArticlesMessage>,
  context: Readonly<ResearchStreamContext>,
): void => {
  const referencedArticles = (data.articles ?? []).map((article) =>
    mapReferencedArticleToNewsArticle(article),
  );
  updateAssistantMessage(
    context,
    (message) => ({
      ...message,
      referenced_articles: referencedArticles,
      streamingStatus: "Reviewing articles.",
    }),
    { syncSummary: false },
  );
};

const prepareResearchCompletion = (result: CompleteMessage["result"]) => {
  const referencedArticles = (result.referenced_articles ?? []).map((article) =>
    mapReferencedArticleToNewsArticle(article),
  );
  const answer = result.answer || "No answer returned.";
  return {
    answer,
    referencedArticles,
    summaryPreview: answer.slice(FIRST_INDEX, SUMMARY_PREVIEW_LENGTH),
  };
};

const processResearchComplete = (
  data: Readonly<CompleteMessage>,
  context: Readonly<ResearchStreamContext>,
): void => {
  if (!context.isCurrentRequest()) {
    return;
  }
  context.streamState.clearStallTimeout();
  const { result } = data;
  const { answer, referencedArticles, summaryPreview } = prepareResearchCompletion(result);
  updateAssistantMessage(
    context,
    (message) => ({
      ...message,
      activities: [...context.streamState.activities],
      articles_searched: result.articles_searched,
      content: answer,
      error: !result.success,
      isStreaming: false,
      referenced_articles: referencedArticles,
      streamingStatus: undefined,
      structured_articles_json:
        context.streamState.structuredArticles ?? message.structured_articles_json,
      thinking_steps: [...context.streamState.thinkingSteps],
    }),
    {
      summaryPreview,
      updatedAt: new Date().toISOString(),
    },
  );
  context.setActiveAssistantVersion(context.chatId, context.assistantGroupId, context.assistantId);
  context.setIsSearching(false);
  context.focusInput();
};

const normalizeResearchError = (message: string): string => {
  const lowered = message.toLowerCase();
  if (lowered.includes("rate limit") || lowered.includes("quota") || lowered.includes("429")) {
    return "The selected model is rate-limited. Choose another model or try again later.";
  }
  return message;
};

const researchErrorCode = (
  data: Readonly<ErrorMessage>,
  isRateLimited: boolean,
): string | undefined => {
  if (data.code !== undefined) {
    return data.code;
  }
  if (isRateLimited) {
    return "rate_limit";
  }
  return undefined;
};

const processResearchError = (
  data: Readonly<ErrorMessage>,
  context: Readonly<ResearchStreamContext>,
): void => {
  if (!context.isCurrentRequest()) {
    return;
  }
  context.streamState.clearStallTimeout();
  const errorMessage = normalizeResearchError(data.message ?? "Research hit an error.");
  const isRateLimited = /rate limit|quota|429/iu.test(data.message ?? "");
  updateAssistantMessage(
    context,
    (message) => ({
      ...message,
      content: errorMessage,
      error: true,
      errorCode: researchErrorCode(data, isRateLimited),
      errorModel: data.model ?? undefined,
      isStreaming: false,
      streamingStatus: undefined,
    }),
    {
      summaryPreview: errorMessage.slice(FIRST_INDEX, SUMMARY_PREVIEW_LENGTH),
      updatedAt: new Date().toISOString(),
    },
  );
  context.setActiveAssistantVersion(context.chatId, context.assistantGroupId, context.assistantId);
  context.setIsSearching(false);
};

type ResearchMessageHandler = (
  data: Readonly<ResearchStreamMessage>,
  context: Readonly<ResearchStreamContext>,
) => void;

type ResearchMessageType =
  | "model_delta"
  | "articles_json"
  | "complete"
  | "error"
  | "referenced_articles"
  | "status"
  | "thinking_step"
  | "thinking"
  | "tool_start"
  | "tool_result";

const isStatusMessage = (message: Readonly<ResearchStreamMessage>): message is StatusMessage =>
  message.type === "status";

const isThinkingStepMessage = (
  message: Readonly<ResearchStreamMessage>,
): message is ThinkingStepMessage => message.type === "thinking_step";

const isArticlesJsonMessage = (
  message: Readonly<ResearchStreamMessage>,
): message is ArticlesJsonMessage => message.type === "articles_json";

const isReferencedArticlesMessage = (
  message: Readonly<ResearchStreamMessage>,
): message is ReferencedArticlesMessage => message.type === "referenced_articles";

const isCompleteMessage = (message: Readonly<ResearchStreamMessage>): message is CompleteMessage =>
  message.type === "complete";

const isErrorMessage = (message: Readonly<ResearchStreamMessage>): message is ErrorMessage =>
  message.type === "error";

const researchMessageHandlers = {
  articles_json: (
    data: Readonly<ResearchStreamMessage>,
    context: Readonly<ResearchStreamContext>,
  ) => {
    if (isArticlesJsonMessage(data)) {
      processResearchArticles(data, context);
    }
  },
  complete: (data: Readonly<ResearchStreamMessage>, context: Readonly<ResearchStreamContext>) => {
    if (isCompleteMessage(data)) {
      processResearchComplete(data, context);
    }
  },
  error: (data: Readonly<ResearchStreamMessage>, context: Readonly<ResearchStreamContext>) => {
    if (isErrorMessage(data)) {
      processResearchError(data, context);
    }
  },
  model_delta: processModelDelta,
  referenced_articles: (
    data: Readonly<ResearchStreamMessage>,
    context: Readonly<ResearchStreamContext>,
  ) => {
    if (isReferencedArticlesMessage(data)) {
      processReferencedArticles(data, context);
    }
  },
  status: (data: Readonly<ResearchStreamMessage>, context: Readonly<ResearchStreamContext>) => {
    if (isStatusMessage(data)) {
      processResearchStatus(data, context);
    }
  },
  thinking: (data: Readonly<ResearchStreamMessage>, context: Readonly<ResearchStreamContext>) => {
    processRawResearchEvent(data, context);
  },
  thinking_step: (
    data: Readonly<ResearchStreamMessage>,
    context: Readonly<ResearchStreamContext>,
  ) => {
    if (isThinkingStepMessage(data)) {
      processResearchThinking(data, context);
    }
  },
  tool_result: (
    data: Readonly<ResearchStreamMessage>,
    context: Readonly<ResearchStreamContext>,
  ) => {
    processRawResearchEvent(data, context);
  },
  tool_start: (data: Readonly<ResearchStreamMessage>, context: Readonly<ResearchStreamContext>) => {
    processRawResearchEvent(data, context);
  },
} satisfies Record<ResearchMessageType, ResearchMessageHandler>;

const hasResearchMessageHandler = (type: string): type is ResearchMessageType =>
  Object.hasOwn(researchMessageHandlers, type);

const processResearchEvent = (line: string, context: Readonly<ResearchStreamContext>): void => {
  if (!line.startsWith("data: ")) {
    return;
  }
  const raw = line.slice(STREAM_DATA_PREFIX_LENGTH).trim();
  if (!raw || raw === "[DONE]") {
    return;
  }
  try {
    const data = parseResearchStreamMessage(raw);
    if (hasResearchMessageHandler(data.type)) {
      researchMessageHandlers[data.type](data, context);
    }
  } catch (error) {
    console.error("Failed to parse research stream message:", error);
  }
};

const processResearchStreamChunk = (
  chunk: Uint8Array,
  decoder: TextDecoder,
  buffer: string,
  context: Readonly<ResearchStreamContext>,
): string => {
  const lines = `${buffer}${decoder.decode(chunk, { stream: true })}`.split("\n");
  const remainder = lines.pop() ?? "";
  lines.forEach((line) => {
    processResearchEvent(line, context);
  });
  return remainder;
};

const consumeResearchStreamChunks = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  buffer: string,
  context: Readonly<ResearchStreamContext>,
): Promise<string> => {
  const result = await reader.read();
  if (result.done) {
    return buffer;
  }
  const nextBuffer = processResearchStreamChunk(result.value, decoder, buffer, context);
  return consumeResearchStreamChunks(reader, decoder, nextBuffer, context);
};

const flushResearchStreamBuffer = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  context: Readonly<ResearchStreamContext>,
): Promise<void> => {
  const buffer = await consumeResearchStreamChunks(reader, decoder, "", context);
  if (buffer.length > FIRST_INDEX) {
    processResearchEvent(buffer, context);
  }
};

const consumeResearchStream = async (
  streamUrl: string,
  abortController: Readonly<AbortController>,
  stallTimeout: ReturnType<typeof setTimeout>,
  context: Readonly<ResearchStreamContext>,
): Promise<void> => {
  const response = await fetch(streamUrl, {
    headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
    signal: abortController.signal,
  });
  if (!response.ok || response.body === null) {
    throw new Error(`Stream request failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    await flushResearchStreamBuffer(reader, decoder, context);
  } finally {
    reader.releaseLock();
    globalThis.clearTimeout(stallTimeout);
  }
};

const cancelAbortedMessage = (message: Message, assistantId: string): Message => {
  if (message.id !== assistantId || message.isStreaming !== true) {
    return message;
  }
  return {
    ...message,
    content: message.content || "Research cancelled.",
    isStreaming: false,
    streamingStatus: undefined,
  };
};

const finishAbortedResearch = (context: Readonly<ResearchStreamContext>): void => {
  const isCurrentRequest = context.isCurrentRequest();
  context.updateChatMessages(
    context.chatId,
    (messages) => messages.map((message) => cancelAbortedMessage(message, context.assistantId)),
    { syncSummary: false },
  );
  if (isCurrentRequest) {
    context.setIsSearching(false);
  }
};

const handleResearchRequestError = (
  error: Error | undefined,
  context: Readonly<ResearchStreamContext>,
): void => {
  if (error?.name === "AbortError" || !context.isCurrentRequest()) {
    finishAbortedResearch(context);
    return;
  }
  console.error("Failed to start research stream:", error);
  const message = error?.message ?? "Could not start research.";
  updateAssistantMessage(
    context,
    (current) => ({
      ...current,
      content: message,
      error: true,
      isStreaming: false,
      streamingStatus: undefined,
    }),
    {
      summaryPreview: message.slice(FIRST_INDEX, SUMMARY_PREVIEW_LENGTH),
      updatedAt: new Date().toISOString(),
    },
  );
  context.setActiveAssistantVersion(context.chatId, context.assistantGroupId, context.assistantId);
  context.setIsSearching(false);
};

const runResearchStream = async (
  streamUrl: string,
  abortController: Readonly<AbortController>,
  stallTimeout: ReturnType<typeof setTimeout>,
  context: Readonly<ResearchStreamContext>,
): Promise<void> => {
  try {
    await consumeResearchStream(streamUrl, abortController, stallTimeout, context);
  } catch (error) {
    handleResearchRequestError((() => {
  if (error instanceof Error) {
    return error;
  }
  return void 0;
})(), context);
  }
};
export { installResearchStallTimeout, processResearchEvent, runResearchStream };
