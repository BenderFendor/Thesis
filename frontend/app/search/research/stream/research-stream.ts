import { API_BASE_URL, semanticSearch } from "@/lib/api";
import type { Message, ReadonlySemanticSearchResult, UpdateChatMessages } from "../model/types";

const NO_ARTICLE_INDEX = -1;
const SEMANTIC_SEARCH_MIN_SCORE = 0.55;
const SEMANTIC_SEARCH_RESULT_LIMIT = 5;
const STREAM_REQUEST_LIMIT = 3;

interface SemanticSearchMessageContext {
  readonly assistantId: string;
  readonly chatId: string;
  readonly retryGroupId?: string;
  readonly semanticToolId: string;
  readonly updateChatMessages: UpdateChatMessages;
}

const addSemanticSearchMessage = (
  response: Readonly<{ results: readonly ReadonlySemanticSearchResult[] }>,
  context: Readonly<SemanticSearchMessageContext>,
): void => {
  const relevant = response.results
    .filter((result) => {
      if (!result.article?.summary) {
        return false;
      }
      const score = result.similarityScore ?? SEMANTIC_SEARCH_MIN_SCORE;
      return score >= SEMANTIC_SEARCH_MIN_SCORE;
    })
    .slice(0, SEMANTIC_SEARCH_RESULT_LIMIT);
  if (relevant.length === 0) {
    return;
  }
  const toolMessage: Message = {
    content: "Found related coverage.",
    id: context.semanticToolId,
    retryOfMessageId: context.retryGroupId,
    semanticResults: relevant,
    timestamp: new Date(),
    toolType: "semantic_search",
    type: "assistant",
  };
  context.updateChatMessages(
    context.chatId,
    (messages) => {
      const withoutExisting = messages.filter((message) => message.id !== context.semanticToolId);
      const insertAt = withoutExisting.findIndex((message) => message.id === context.assistantId);
      if (insertAt === NO_ARTICLE_INDEX) {
        return [...withoutExisting, toolMessage];
      }
      const next = [...withoutExisting];
      next.splice(insertAt, 0, toolMessage);
      return next;
    },
    { syncSummary: false },
  );
};

const startSemanticResearch = async (
  context: Readonly<SemanticSearchMessageContext & { readonly prompt: string }>,
): Promise<void> => {
  try {
    const response = await semanticSearch(context.prompt, { limit: STREAM_REQUEST_LIMIT });
    addSemanticSearchMessage(response, context);
  } catch (error) {
    console.warn("Semantic search unavailable:", error);
  }
};

const buildResearchStreamUrl = (
  promptQuery: string,
  historyPayload: readonly { readonly content: string; readonly type: string }[],
): string => {
  const streamUrl = new URL(`${API_BASE_URL}/api/news/research/stream`);
  streamUrl.searchParams.set("query", promptQuery);
  streamUrl.searchParams.set("include_thinking", "true");
  if (historyPayload.length > 0) {
    streamUrl.searchParams.set("history", JSON.stringify(historyPayload));
  }
  return streamUrl.toString();
};

const buildChatHistoryPayload = (
  items: readonly Message[],
): readonly { readonly content: string; readonly type: Message["type"] }[] =>
  items
    .filter(
      (message) =>
        (message.type === "user" || message.type === "assistant") &&
        !message.toolType &&
        message.isStreaming !== true,
    )
    .map((message) => ({
      content: message.content,
      type: message.type,
    }))
    .filter((entry) => entry.content.trim().length > 0);
export { startSemanticResearch, buildResearchStreamUrl, buildChatHistoryPayload };
