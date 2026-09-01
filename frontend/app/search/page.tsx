"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Cpu,
  Filter,
  Home,
  Loader2,
  Pencil,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import { z } from "zod";
import { ArticleDetailModal } from "@/components/article-detail-modal";
import { ChatSidebar } from '@/components/chat-sidebar';
import type { ChatSummary } from '@/components/chat-sidebar';
import { SearchSuggestions } from "@/components/search-suggestions";
import { SafeImage } from "@/components/safe-image";
import { Button } from "@/components/ui/button";
import { VerificationPanel } from "@/components/verification-panel";
import { API_BASE_URL, semanticSearch } from "@/lib/api";
import type { NewsArticle, SemanticSearchResult, ThinkingStep } from '@/lib/api';
import {
  getMessageVersionGroupId,
  getMessageVersionInfo,
  getVisibleConversationMessages,
} from "@/lib/chat-branching";

type ReadonlyChatSummary = Readonly<ChatSummary>;
type ReadonlyNewsArticle = Readonly<NewsArticle>;
type ReadonlySemanticSearchResult = Readonly<SemanticSearchResult>;
type ReadonlyThinkingStep = Readonly<ThinkingStep>;

interface ReferencedArticlePayload {
  readonly category?: string;
  readonly description?: string;
  readonly image?: string;
  readonly link?: string;
  readonly published?: string;
  readonly source?: string;
  readonly tags?: readonly string[];
  readonly title?: string;
}

interface StructuredArticleSummary {
  readonly author?: string;
  readonly category?: string;
  readonly description?: string;
  readonly image?: string;
  readonly link?: string;
  readonly published?: string;
  readonly source?: string;
  readonly summary?: string;
  readonly title?: string;
  readonly url?: string;
}

type StructuredArticleCluster = Readonly<Record<string, string | number | boolean | null>>;

interface StructuredArticlesPayload {
  readonly articles?: readonly StructuredArticleSummary[];
  readonly clusters?: readonly StructuredArticleCluster[];
}

interface ResearchResult {
  readonly answer: string;
  readonly articles_searched: number;
  readonly error?: string;
  readonly query: string;
  readonly referenced_articles?: readonly ReferencedArticlePayload[];
  readonly structured_articles?: StructuredArticlesPayload;
  readonly success: boolean;
  readonly thinking_steps: readonly ReadonlyThinkingStep[];
}

interface Message {
  readonly articles_searched?: number;
  readonly content: string;
  readonly error?: boolean;
  readonly id: string;
  readonly isStreaming?: boolean;
  readonly parentMessageId?: string;
  readonly referenced_articles?: readonly ReadonlyNewsArticle[];
  readonly retryOfMessageId?: string;
  readonly semanticResults?: readonly ReadonlySemanticSearchResult[];
  readonly streamingStatus?: string;
  readonly structured_articles_json?: StructuredArticlesPayload;
  readonly thinking_steps?: readonly ReadonlyThinkingStep[];
  readonly timestamp: Date;
  readonly toolType?: "semantic_search";
  readonly type: "user" | "assistant";
}

interface ChatMessageUpdateOptions {
  readonly summaryPreview?: string;
  readonly syncSummary?: boolean;
  readonly updatedAt?: string;
}

type UpdateChatMessages = (
  chatId: string,
  updater: (previous: readonly Message[]) => Message[],
  options?: Readonly<ChatMessageUpdateOptions>,
) => void;

interface StartResearchParameters {
  readonly chatId: string;
  readonly newChatTitle?: string;
  readonly parentMessageId?: string;
  readonly prompt: string;
  readonly retryGroupId?: string;
  readonly seedMessages: readonly Message[];
  readonly versionSelectionOverrides?: Readonly<Record<string, string>>;
}

interface ResearchStreamState {
  readonly addThinkingStep: (step: ReadonlyThinkingStep) => void;
  readonly clearStallTimeout: () => void;
  readonly setClearStallTimeout: (clear: () => void) => void;
  readonly setStructuredArticles: (articles: StructuredArticlesPayload) => void;
  readonly structuredArticles?: StructuredArticlesPayload;
  readonly thinkingSteps: readonly ReadonlyThinkingStep[];
}

interface ResearchStreamContext {
  readonly assistantGroupId: string;
  readonly assistantId: string;
  readonly chatId: string;
  readonly clearAbortController: () => void;
  readonly focusInput: () => void;
  readonly retryGroupId?: string;
  readonly setActiveAssistantVersion: ResearchChatState["setActiveAssistantVersion"];
  readonly setIsSearching: (searching: boolean) => void;
  readonly streamState: ResearchStreamState;
  readonly updateChatMessages: UpdateChatMessages;
}

const ARTICLE_DESCRIPTION_FALLBACK = "No description",
 ARTICLE_SOURCE_FALLBACK = "Unknown",
 ARTICLE_TITLE_FALLBACK = "No title",
 SEARCH_STREAM_STALL_TIMEOUT_MS = 30_000,
 SEMANTIC_SEARCH_MIN_SCORE = 0.55,
 SEMANTIC_SEARCH_RESULT_LIMIT = 5,
 NO_ARTICLE_INDEX = -1,
 ANIMATION_OFFSET = 18,
 ARTICLE_IMAGE_HEIGHT = 96,
 ARTICLE_IMAGE_WIDTH = 128,
 FIRST_INDEX = 0,
 MINIMUM_QUERY_LENGTH = 3,
 NEW_CHAT_ID_LENGTH = 8,
 NEW_CHAT_ID_RADIX = 36,
 NEW_CHAT_ID_START = 2,
 NEW_CHAT_TITLE_WORD_COUNT = 4,
 PERCENTAGE_MULTIPLIER = 100,
 RESEARCH_LOG_LIMIT = 6,
 SAMPLE_QUERY_LIMIT = 3,
 SOURCE_PREVIEW_LIMIT = 5,
 STREAM_DATA_PREFIX_LENGTH = 6,
 STREAM_REQUEST_LIMIT = 3,
 STRUCTURED_ARTICLE_BLOCK_PATTERN = /```json:articles\n(?<json>[\s\S]*?)\n```/u,
 SUMMARY_PREVIEW_LENGTH = 200,
 VERSION_OFFSET = 1,
 MARKDOWN_PLUGINS = [remarkGfm],
 UnknownResearchMessageSchema = z.object({ type: z.string() }),

 StructuredArticleSummarySchema = z.object({
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
}),

 StructuredArticlesPayloadSchema = z.object({
  articles: z.array(StructuredArticleSummarySchema).optional(),
  clusters: z.array(
    z.record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.null()])),
  ).optional(),
});

function parseResearchStreamMessage(raw: string): ResearchStreamMessage {
  const parsed = UnknownResearchMessageSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error("Research stream message has no valid type.");
  }
  return parsed.data;
}

function parseStructuredArticles(raw: string): StructuredArticlesPayload | undefined {
  try {
    const parsed = StructuredArticlesPayloadSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

function parseStructuredArticleBlock(raw: string): StructuredArticlesPayload | undefined {
  const match = STRUCTURED_ARTICLE_BLOCK_PATTERN.exec(raw),
   json = match?.groups?.json;
  if (json === undefined || json.length === FIRST_INDEX) {
    return undefined;
  }
  return parseStructuredArticles(json);
}

function updateAssistantMessage(
  context: Readonly<ResearchStreamContext>,
  updater: (message: Readonly<Message>) => Message,
  options?: Readonly<ChatMessageUpdateOptions>,
): void {
  context.updateChatMessages(
    context.chatId,
    (messages) =>
      messages.map((message) =>
        message.id === context.assistantId ? updater(message) : message,
      ),
    options,
  );
}

function processResearchStatus(
  data: Readonly<StatusMessage>,
  context: Readonly<ResearchStreamContext>,
): void {
  updateAssistantMessage(context, (message) => ({
    ...message,
    streamingStatus: data.message,
  }), { syncSummary: false });
}

function processResearchThinking(
  data: Readonly<ThinkingStepMessage>,
  context: Readonly<ResearchStreamContext>,
): void {
  context.streamState.addThinkingStep(data.step);
  updateAssistantMessage(context, (message) => ({
    ...message,
    streamingStatus: stepStatusLabel(data.step.type),
    thinking_steps: [...context.streamState.thinkingSteps],
  }), { syncSummary: false });
}

function processResearchArticles(
  data: Readonly<ArticlesJsonMessage>,
  context: Readonly<ResearchStreamContext>,
): void {
  const parsed = parseStructuredArticles(data.data) ?? parseStructuredArticleBlock(data.data);
  if (parsed === undefined) {
    return;
  }
  context.streamState.setStructuredArticles(parsed);
  updateAssistantMessage(context, (message) => ({
    ...message,
    streamingStatus: "Article data ready.",
    structured_articles_json: parsed,
  }), { syncSummary: false });
}

function processReferencedArticles(
  data: Readonly<ReferencedArticlesMessage>,
  context: Readonly<ResearchStreamContext>,
): void {
  const referencedArticles = (data.articles ?? []).map(
    (article) => mapReferencedArticleToNewsArticle(article),
  );
  updateAssistantMessage(context, (message) => ({
    ...message,
    referenced_articles: referencedArticles,
    streamingStatus: "Reviewing articles.",
  }), { syncSummary: false });
}

function processResearchComplete(
  data: Readonly<CompleteMessage>,
  context: Readonly<ResearchStreamContext>,
): void {
  context.streamState.clearStallTimeout();
  const {result} = data,
   referencedArticles = (result.referenced_articles ?? []).map(
    (article) => mapReferencedArticleToNewsArticle(article),
   ),
   summaryPreview = (result.answer || "No answer returned.").slice(FIRST_INDEX, SUMMARY_PREVIEW_LENGTH);
  updateAssistantMessage(context, (message) => ({
    ...message,
    articles_searched: result.articles_searched,
    content: result.answer || "No answer returned.",
    error: !result.success,
    isStreaming: false,
    referenced_articles: referencedArticles,
    streamingStatus: undefined,
    structured_articles_json:
      context.streamState.structuredArticles ?? message.structured_articles_json,
    thinking_steps: [...context.streamState.thinkingSteps],
  }), {
    summaryPreview,
    updatedAt: new Date().toISOString(),
  });
  context.setActiveAssistantVersion(
    context.chatId,
    context.assistantGroupId,
    context.assistantId,
  );
  context.setIsSearching(false);
  context.clearAbortController();
  context.focusInput();
}

function normalizeResearchError(message: string): string {
  const lowered = message.toLowerCase();
  if (
    lowered.includes("rate limit") ||
    lowered.includes("quota") ||
    lowered.includes("429")
  ) {
    return "API Rate Limit: The AI service has reached its rate limit. Please wait a moment and try again.";
  }
  return message;
}

function processResearchError(
  data: Readonly<ErrorMessage>,
  context: Readonly<ResearchStreamContext>,
): void {
  context.streamState.clearStallTimeout();
  const errorMessage = normalizeResearchError(
    data.message || "Research hit an error.",
  );
  updateAssistantMessage(context, (message) => ({
    ...message,
    content: errorMessage,
    error: true,
    isStreaming: false,
    streamingStatus: undefined,
  }), {
    summaryPreview: errorMessage.slice(FIRST_INDEX, SUMMARY_PREVIEW_LENGTH),
    updatedAt: new Date().toISOString(),
  });
  context.setActiveAssistantVersion(
    context.chatId,
    context.assistantGroupId,
    context.assistantId,
  );
  context.setIsSearching(false);
  context.clearAbortController();
}

type ResearchMessageHandler = (
  data: Readonly<ResearchStreamMessage>,
  context: Readonly<ResearchStreamContext>,
) => void;

type ResearchMessageType =
  | "articles_json"
  | "complete"
  | "error"
  | "referenced_articles"
  | "status"
  | "thinking_step";

const researchMessageHandlers = {
  articles_json: (data, context) => {
    if (isArticlesJsonMessage(data)) {processResearchArticles(data, context);}
  },
  complete: (data, context) => {
    if (isCompleteMessage(data)) {processResearchComplete(data, context);}
  },
  error: (data, context) => {
    if (isErrorMessage(data)) {processResearchError(data, context);}
  },
  referenced_articles: (data, context) => {
    if (isReferencedArticlesMessage(data)) {processReferencedArticles(data, context);}
  },
  status: (data, context) => {
    if (isStatusMessage(data)) {processResearchStatus(data, context);}
  },
  thinking_step: (data, context) => {
    if (isThinkingStepMessage(data)) {processResearchThinking(data, context);}
  },
} satisfies Record<ResearchMessageType, ResearchMessageHandler>,

 hasResearchMessageHandler = (type: string): type is ResearchMessageType =>
  Object.hasOwn(researchMessageHandlers, type);

function processResearchEvent(
  line: string,
  context: Readonly<ResearchStreamContext>,
): void {
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
}

function processResearchStreamChunk(
  chunk: Uint8Array,
  decoder: TextDecoder,
  buffer: string,
  context: Readonly<ResearchStreamContext>,
): string {
  const lines = `${buffer}${decoder.decode(chunk, { stream: true })}`.split("\n"),
   remainder = lines.pop() ?? "";
  lines.forEach((line) =>{  processResearchEvent(line, context); });
  return remainder;
}

async function consumeResearchStreamChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  buffer: string,
  context: Readonly<ResearchStreamContext>,
): Promise<string> {
  const result = await reader.read();
  if (result.done) {
    return buffer;
  }
  const nextBuffer = processResearchStreamChunk(result.value, decoder, buffer, context);
  return consumeResearchStreamChunks(reader, decoder, nextBuffer, context);
}

async function consumeResearchStream(
  streamUrl: string,
  abortController: Readonly<AbortController>,
  stallTimeout: ReturnType<typeof setTimeout>,
  context: Readonly<ResearchStreamContext>,
): Promise<void> {
  const response = await fetch(streamUrl, { signal: abortController.signal });
  if (!response.ok || response.body === null) {
    throw new Error(`Stream request failed: ${response.status}`);
  }
  const reader = response.body.getReader(),
   decoder = new TextDecoder();
  try {
    const buffer = await consumeResearchStreamChunks(reader, decoder, "", context);
    if (buffer.length > FIRST_INDEX) {
      processResearchEvent(buffer, context);
    }
  } finally {
    reader.releaseLock();
    globalThis.clearTimeout(stallTimeout);
  }
}

function finishAbortedResearch(context: Readonly<ResearchStreamContext>): void {
  updateAssistantMessage(context, (message) => ({
    ...message,
    content: message.content || "Research cancelled.",
    isStreaming: false,
    streamingStatus: undefined,
  }), { syncSummary: false });
  context.clearAbortController();
  context.setIsSearching(false);
}

function handleResearchRequestError(
  error: Error | undefined,
  context: Readonly<ResearchStreamContext>,
): void {
  if (error?.name === "AbortError") {
    finishAbortedResearch(context);
    return;
  }
  console.error("Failed to start research stream:", error);
  const message = error?.message ?? "Could not start research.";
  updateAssistantMessage(context, (current) => ({
    ...current,
    content: message,
    error: true,
    isStreaming: false,
    streamingStatus: undefined,
  }), {
    summaryPreview: message.slice(FIRST_INDEX, SUMMARY_PREVIEW_LENGTH),
    updatedAt: new Date().toISOString(),
  });
  context.setActiveAssistantVersion(
    context.chatId,
    context.assistantGroupId,
    context.assistantId,
  );
  context.setIsSearching(false);
}

async function runResearchStream(
  streamUrl: string,
  abortController: Readonly<AbortController>,
  stallTimeout: ReturnType<typeof setTimeout>,
  context: Readonly<ResearchStreamContext>,
): Promise<void> {
  try {
    await consumeResearchStream(streamUrl, abortController, stallTimeout, context);
  } catch (error) {
    if (error instanceof Error) {
      handleResearchRequestError(error, context);
      return;
    }
    handleResearchRequestError(undefined, context);
  }
}

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
  context.updateChatMessages(context.chatId, (messages) => {
    const withoutExisting = messages.filter((message) => message.id !== context.semanticToolId),
     insertAt = withoutExisting.findIndex(
      (message) => message.id === context.assistantId,
    );
    if (insertAt === NO_ARTICLE_INDEX) {
      return [...withoutExisting, toolMessage];
    }
    const next = [...withoutExisting];
    next.splice(insertAt, 0, toolMessage);
    return next;
  }, { syncSummary: false });
};

function buildResearchStreamUrl(
  promptQuery: string,
  historyPayload: readonly { content: string; type: string }[],
): string {
  const streamUrl = new URL(`${API_BASE_URL}/api/news/research/stream`);
  streamUrl.searchParams.set("query", promptQuery);
  streamUrl.searchParams.set("include_thinking", "true");
  if (historyPayload.length > 0) {
    streamUrl.searchParams.set("history", JSON.stringify(historyPayload));
  }
  return streamUrl.toString();
}

function buildChatHistoryPayload(
  items: readonly Message[],
): { content: string; type: Message["type"] }[] {
  return items
    .filter(
      (message) =>
        (message.type === "user" || message.type === "assistant") &&
        !message.toolType &&
        !message.isStreaming,
    )
    .map((message) => ({
      content: message.content,
      type: message.type,
    }))
    .filter((entry) => entry.content.trim().length > 0);
}

interface SubmitPromptParameters {
  readonly prompt: string;
  readonly editingTargetId?: string | null;
  readonly clearComposer?: boolean;
  readonly forceNewChat?: boolean;
}

interface SubmitPromptContext {
  readonly activeChatId: string | null;
  readonly clearMessageEditing: () => void;
  readonly conversationMessages: readonly Message[];
  readonly messages: readonly Message[];
  readonly setActiveAssistantVersion: (
    chatId: string,
    groupId: string,
    messageId: string,
  ) => void;
  readonly setActiveAssistantVersionMap: React.Dispatch<
    React.SetStateAction<Record<string, Record<string, string>>>
  >;
  readonly setActiveChatId: React.Dispatch<React.SetStateAction<string | null>>;
  readonly setChatMessagesMap: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  readonly setChats: React.Dispatch<React.SetStateAction<ChatSummary[]>>;
  readonly setQuery: (value: string) => void;
  readonly startResearch: (parameters: StartResearchParameters) => Promise<void>;
  readonly updateChatMessages: UpdateChatMessages;
}

interface ChatTarget {
  readonly chatId: string | null;
  readonly newChatTitle?: string;
}

interface ResolvedChatTarget {
  readonly chatId: string;
  readonly newChatTitle?: string;
}

const CHAT_PREVIEW_MAX_LENGTH = 120,
 CHAT_TITLE_MAX_LENGTH = 60,
 PROMPT_PREVIEW_MAX_LENGTH = 200,

 buildNewChatSummary = (prompt: string): ChatSummary => {
  const firstSentence = (prompt.split(/[.\n]/u)[0] ?? "").trim(),
   firstWords = prompt.split(/\s+/u).slice(0, NEW_CHAT_TITLE_WORD_COUNT).join(" "),
   title = (firstSentence || firstWords || "New Chat").slice(0, CHAT_TITLE_MAX_LENGTH);
  return {
    id: `chat-${Date.now()}-${Math.random().toString(NEW_CHAT_ID_RADIX).slice(NEW_CHAT_ID_START, NEW_CHAT_ID_LENGTH)}`,
    lastMessage: prompt.slice(0, CHAT_PREVIEW_MAX_LENGTH),
    title,
    updatedAt: new Date().toISOString(),
  };
},

 initializeNewChat = (
  prompt: string,
  context: Readonly<SubmitPromptContext>,
): ChatSummary => {
  const newChat = buildNewChatSummary(prompt);
  context.setChats((chats) => [newChat, ...chats]);
  context.setChatMessagesMap((messages) => ({ ...messages, [newChat.id]: [] }));
  context.setActiveAssistantVersionMap((versions) => ({ ...versions, [newChat.id]: {} }));
  context.setActiveChatId(newChat.id);
  return newChat;
},

 resolveChatTarget = (
  parameters: Readonly<SubmitPromptParameters>,
  prompt: string,
  context: Readonly<SubmitPromptContext>,
): ChatTarget => {
  if (context.activeChatId && parameters.forceNewChat !== true) {
    return { chatId: context.activeChatId };
  }
  const newChat = initializeNewChat(prompt, context);
  return { chatId: newChat.id, newChatTitle: newChat.title };
},

 findEditingTarget = (
  parameters: Readonly<SubmitPromptParameters>,
  context: Readonly<SubmitPromptContext>,
): Message | undefined => {
  if (parameters.editingTargetId === undefined || parameters.editingTargetId === null) {
    return undefined;
  }
  return context.messages.find((message) => message.id === parameters.editingTargetId);
},

 resolveEditedParentId = (
  editingTarget: Readonly<Message> | undefined,
  conversationMessages: readonly Message[],
): string | undefined => {
  if (editingTarget === undefined) {
    return undefined;
  }
  if (editingTarget.parentMessageId !== undefined) {
    return editingTarget.parentMessageId;
  }
  const targetIndex = conversationMessages.findIndex(
    (message) => message.id === editingTarget.id,
  );
  return conversationMessages[targetIndex + NO_ARTICLE_INDEX]?.id;
},

 getRetryMessageGroupId = (
  editingTarget: Readonly<Message> | undefined,
): string | undefined => {
  if (editingTarget?.type !== "user") {
    return undefined;
  }
  return getMessageVersionGroupId(editingTarget);
},

 buildUserMessage = (
  prompt: string,
  editingTarget: Readonly<Message> | undefined,
  latestVisibleMessage: Readonly<Message> | undefined,
  conversationMessages: readonly Message[],
): Message => {
  let parentMessageId = latestVisibleMessage?.id;
  if (editingTarget !== undefined) {
    parentMessageId = resolveEditedParentId(editingTarget, conversationMessages);
  }
  return {
    content: prompt,
    id: `user-${Date.now()}`,
    parentMessageId,
    retryOfMessageId: getRetryMessageGroupId(editingTarget),
    timestamp: new Date(),
    type: "user",
  };
},

 getVersionSelectionOverrides = (
  editingTarget: Readonly<Message> | undefined,
  userMessage: Readonly<Message>,
): Record<string, string> | undefined => {
  if (editingTarget?.type !== "user") {
    return undefined;
  }
  return { [getMessageVersionGroupId(editingTarget)]: userMessage.id };
},

 appendPromptMessage = (
  context: Readonly<SubmitPromptContext>,
  chatId: string,
  userMessage: Readonly<Message>,
  prompt: string,
): void => {
  context.updateChatMessages(chatId, (messages) => [...messages, userMessage], {
    summaryPreview: prompt.slice(0, PROMPT_PREVIEW_MAX_LENGTH),
    updatedAt: new Date().toISOString(),
  });
},

 applyPromptStateChanges = (
  parameters: Readonly<SubmitPromptParameters>,
  context: Readonly<SubmitPromptContext>,
  target: Readonly<ResolvedChatTarget>,
  editingTarget: Readonly<Message> | undefined,
  userMessage: Readonly<Message>,
): void => {
  if (editingTarget?.type === "user") {
    context.setActiveAssistantVersion(
      target.chatId,
      getMessageVersionGroupId(editingTarget),
      userMessage.id,
    );
  }
  if (parameters.clearComposer === true) {
    context.setQuery("");
  }
  if (parameters.editingTargetId !== undefined && parameters.editingTargetId !== null) {
    context.clearMessageEditing();
  }
},

 createResearchStartParameters = (
  target: Readonly<ResolvedChatTarget>,
  prompt: string,
  userMessage: Readonly<Message>,
  seedMessages: readonly Message[],
  editingTarget: Readonly<Message> | undefined,
): StartResearchParameters => ({
  chatId: target.chatId,
  newChatTitle: target.newChatTitle,
  parentMessageId: userMessage.id,
  prompt,
  seedMessages: [...seedMessages],
  versionSelectionOverrides: getVersionSelectionOverrides(editingTarget, userMessage),
}),

 submitResearchPrompt = async (
  parameters: Readonly<SubmitPromptParameters>,
  context: Readonly<SubmitPromptContext>,
): Promise<void> => {
  const trimmedQuery = parameters.prompt.trim();
  if (!trimmedQuery) {
    return;
  }

  const target = resolveChatTarget(parameters, trimmedQuery, context);
  if (target.chatId === null) {
    return;
  }
  const resolvedTarget: ResolvedChatTarget = {
    chatId: target.chatId,
    newChatTitle: target.newChatTitle,
  },

   editingTarget = findEditingTarget(parameters, context),
   userMessage = buildUserMessage(
    trimmedQuery,
    editingTarget,
    context.conversationMessages.at(-1),
    context.conversationMessages,
  ),
   seedMessages = [...context.messages, userMessage];
  appendPromptMessage(context, resolvedTarget.chatId, userMessage, trimmedQuery);
  applyPromptStateChanges(
    parameters,
    context,
    resolvedTarget,
    editingTarget,
    userMessage,
  );
  await context.startResearch(
    createResearchStartParameters(
      resolvedTarget,
      trimmedQuery,
      userMessage,
      seedMessages,
      editingTarget,
    ),
  );
};

interface StatusMessage { readonly type: "status"; readonly message: string }
interface ThinkingStepMessage {
  readonly type: "thinking_step";
  readonly step: ReadonlyThinkingStep;
}
interface ArticlesJsonMessage { readonly type: "articles_json"; readonly data: string }
interface ReferencedArticlesMessage {
  readonly type: "referenced_articles";
  readonly articles?: readonly ReferencedArticlePayload[];
}
interface CompleteMessage { readonly type: "complete"; readonly result: ResearchResult }
interface ErrorMessage { readonly type: "error"; readonly message?: string }
interface UnknownMessage { readonly type: string }

type ResearchStreamMessage =
  | StatusMessage
  | ThinkingStepMessage
  | ArticlesJsonMessage
  | ReferencedArticlesMessage
  | CompleteMessage
  | ErrorMessage
  | UnknownMessage;

const isStatusMessage = (
  message: Readonly<ResearchStreamMessage>,
): message is StatusMessage => message.type === "status",
 isThinkingStepMessage = (
  message: Readonly<ResearchStreamMessage>,
): message is ThinkingStepMessage => message.type === "thinking_step",
 isArticlesJsonMessage = (
  message: Readonly<ResearchStreamMessage>,
): message is ArticlesJsonMessage => message.type === "articles_json",
 isReferencedArticlesMessage = (
  message: Readonly<ResearchStreamMessage>,
): message is ReferencedArticlesMessage =>
  message.type === "referenced_articles",
 isCompleteMessage = (
  message: Readonly<ResearchStreamMessage>,
 ): message is CompleteMessage => message.type === "complete",
 isErrorMessage = (
  message: Readonly<ResearchStreamMessage>,
 ): message is ErrorMessage => message.type === "error",

 stepStatusLabel = (stepType: string): string => {
  switch (stepType) {
    case "thought": {
      return "Working through the question.";
    }
    case "tool_start":
    case "action": {
      return "Checking more sources.";
    }
    case "observation": {
      return "Reviewing results.";
    }
    default: {
      return "Working.";
    }
  }
},

 CHAT_STORAGE_KEY = "news-research.chat-state",
 CHAT_STORAGE_VERSION = 1;

interface StoredChatState {
  version: number;
  activeChatId?: string | null;
  chats: ChatSummary[];
  activeAssistantVersionMap?: Record<string, Record<string, string>>;
  messages: Record<
    string,
    (Omit<Message, "timestamp"> & { timestamp: string })[]
  >;
}

const getArticleText = (value: string | undefined, fallback: string): string => {
  if (value === undefined || value.length === FIRST_INDEX) {
    return fallback;
  }
  return value;
},

 mapReferencedArticleToNewsArticle = (
  article: Readonly<ReferencedArticlePayload>,
): NewsArticle => {
  const category = getArticleText(article.category, "general"),
   description = getArticleText(article.description, ARTICLE_DESCRIPTION_FALLBACK),
   image = getArticleText(article.image, "/placeholder.svg"),
   publishedAt = getArticleText(article.published, new Date().toISOString()),
   source = getArticleText(article.source, ARTICLE_SOURCE_FALLBACK),
   title = getArticleText(article.title, ARTICLE_TITLE_FALLBACK),
   link = article.link ?? "";
  return {
    bias: "center",
    category,
    content: description,
    country: "International",
    credibility: "medium",
    id: Date.now() + Math.random(),
    image,
    isPersisted: false,
    originalLanguage: "en",
    publishedAt,
    source,
    sourceId: source.toLowerCase().replaceAll(/\s+/gu, "-"),
    summary: description,
    tags: getEmbeddedArticleTags(article),
    title,
    translated: false,
    url: link,
  };
},

 getEmbeddedArticleTags = (
  article: Readonly<Pick<ReferencedArticlePayload, "category" | "source">>,
): string[] => [article.category, article.source].filter(
  (value): value is string => value !== undefined && value.length > FIRST_INDEX,
),

 getEmbeddedArticleDescription = (
  article: Readonly<Pick<StructuredArticleSummary, "summary" | "description">>,
): string => getArticleText(
  article.summary,
  getArticleText(article.description, ARTICLE_DESCRIPTION_FALLBACK),
),

 getEmbeddedArticleLink = (
  article: Readonly<Pick<StructuredArticleSummary, "link" | "url">>,
): string => {
  if (article.link !== undefined && article.link.length > FIRST_INDEX) {
    return article.link;
  }
  return article.url ?? "";
},

 mapStructuredArticle = (article: Readonly<StructuredArticleSummary>): NewsArticle => {
  const description = getEmbeddedArticleDescription(article),
   link = getEmbeddedArticleLink(article),
   source = getArticleText(article.source, ARTICLE_SOURCE_FALLBACK),
   category = getArticleText(article.category, "general"),
   image = getArticleText(article.image, "/placeholder.svg"),
   publishedAt = getArticleText(article.published, new Date().toISOString()),
   title = getArticleText(article.title, ARTICLE_TITLE_FALLBACK);
  return {
    bias: "center",
    category,
    content: description,
    country: "United States",
    credibility: "medium",
    id: Date.now() + Math.random(),
    image,
    originalLanguage: "en",
    publishedAt,
    source,
    sourceId: source.toLowerCase().replaceAll(/\s+/gu, "-"),
    summary: description,
    tags: getEmbeddedArticleTags(article),
    title,
    translated: false,
    url: link,
  };
},



 sampleQueries = [
    "What are the different perspectives on climate change?",
    "Compare how different sources cover technology news",
    "Summarize the latest political developments",
    "Which sources have covered AI recently?",
    "Analyze bias in coverage of international conflicts",
],

 formatShortDate = (date: string) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
},

 buildArticleEmbeds = (message?: Readonly<Message>): NewsArticle[] => {
  if (message === undefined) {
    return [];
  }

  if (message.referenced_articles !== undefined && message.referenced_articles.length > FIRST_INDEX) {
    return [...message.referenced_articles];
  }
  const structuredArticles = message.structured_articles_json?.articles ?? [];
  return structuredArticles.map((article) => mapStructuredArticle(article));
};

interface EmbeddedContentProps {
  readonly articles: readonly ReadonlyNewsArticle[];
  readonly content: string;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

interface InlineArticleCardProps {
  readonly article: ReadonlyNewsArticle;
  readonly handleOpenArticle: (article: ReadonlyNewsArticle) => void;
}

interface MarkdownLinkProps {
  readonly children?: React.ReactNode;
  readonly href?: string;
}

interface MarkdownChildrenProps {
  readonly children?: React.ReactNode;
}

const InlineArticleCard = (props: Readonly<InlineArticleCardProps>) => {
  const { article, handleOpenArticle } = props,
   handleClick = (): void => {
    handleOpenArticle(article);
  };
  return (
    <button
    onClick={handleClick}
    className="not-prose group relative my-6 block w-full overflow-hidden rounded-3xl border border-border/40 bg-card/30 text-left transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-card/50 hover:shadow-2xl hover:shadow-black/30"
  >
    <div className="flex flex-col gap-4 p-4 sm:flex-row">
      {article.image.length > 0 && (
        <div className="h-48 shrink-0 overflow-hidden rounded-2xl bg-card sm:h-24 sm:w-32">
          <SafeImage
            src={article.image}
            alt={article.title}
            width={ARTICLE_IMAGE_WIDTH}
            height={ARTICLE_IMAGE_HEIGHT}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
        <div>
          <h4 className="font-medium text-foreground line-clamp-2 text-base transition-colors group-hover:text-primary">
            {article.title}
          </h4>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-2">
            {article.summary}
          </p>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span className="text-primary/80">{article.source}</span>
          <span>•</span>
          <span>{new Date(article.publishedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
    </button>
  );
},

 cleanEmbeddedContent = (content: string): string => content.replaceAll(
  /(?<!\])\(https?:\/\/[^)]+\)/giu,
  (match) => match.slice(1, -1)
),

 buildArticleUrlMap = (
  articles: readonly ReadonlyNewsArticle[]
): ReadonlyMap<string, ReadonlyNewsArticle> => {
  const articleMap = new Map<string, ReadonlyNewsArticle>();
  articles.forEach((article) => {
    if (article.url.length > 0) {
      articleMap.set(article.url, article);
      articleMap.set(article.url.replace(/\/$/u, ""), article);
    }
  });
  return articleMap;
},

 createEmbeddedMarkdownComponents = (
  articleMap: ReadonlyMap<string, ReadonlyNewsArticle>,
  handleOpenArticle: (article: ReadonlyNewsArticle) => void
) => ({
  a: ({ href, children }: MarkdownLinkProps) => {
    let article: ReadonlyNewsArticle | undefined;
    if (href !== undefined) {
      article = articleMap.get(href) ?? articleMap.get(href.replace(/\/$/u, ""));
    }
    if (article === undefined) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary decoration-primary/30 underline-offset-2 hover:underline"
        >
          {children}
        </a>
      );
    }
    return <InlineArticleCard article={article} handleOpenArticle={handleOpenArticle} />;
  },
  h1: ({ children }: MarkdownChildrenProps) => (
    <h1 className="mb-3 mt-6 text-xl font-semibold text-foreground">{children}</h1>
  ),
  h2: ({ children }: MarkdownChildrenProps) => (
    <h2 className="mb-2 mt-5 text-lg font-semibold text-foreground">{children}</h2>
  ),
  h3: ({ children }: MarkdownChildrenProps) => (
    <h3 className="mb-2 mt-4 text-base font-medium text-foreground">{children}</h3>
  ),
  li: ({ children }: MarkdownChildrenProps) => (
    <li className="text-foreground/80">{children}</li>
  ),
  p: ({ children }: MarkdownChildrenProps) => (
    <p className="mb-4 leading-7 text-foreground/80">{children}</p>
  ),
  strong: ({ children }: MarkdownChildrenProps) => (
    <span className="font-semibold text-foreground">{children}</span>
  ),
  ul: ({ children }: MarkdownChildrenProps) => (
    <ul className="my-3 space-y-1">{children}</ul>
  ),
}),

 EmbeddedMarkdown = (props: Readonly<EmbeddedContentProps>) => {
  const { articles, content, onOpenArticle } = props,
   articleMap = useMemo(() => buildArticleUrlMap(articles), [articles]),
   components = useMemo(
    () => createEmbeddedMarkdownComponents(articleMap, onOpenArticle),
    [articleMap, onOpenArticle],
  );
  return <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS} components={components}>{content}</ReactMarkdown>;
},

 EmbeddedContent = ({
  articles,
  content,
  onOpenArticle,
}: Readonly<EmbeddedContentProps>) => (
  <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-transparent prose-pre:p-0">
    <EmbeddedMarkdown
      articles={articles}
      content={cleanEmbeddedContent(content)}
      onOpenArticle={onOpenArticle}
    />
  </div>
);

type VersionInfo = ReturnType<typeof getMessageVersionInfo>;

interface MessageItemProps {
  readonly message: Readonly<Message>;
  readonly messages: readonly Message[];
  readonly activeAssistantVersions: Readonly<Record<string, string>>;
  readonly editingMessageId: string | null;
  readonly editingDraft: string;
  readonly setEditingDraft: (value: string) => void;
  readonly isSearching: boolean;
  readonly expandedStepMessageIds: ReadonlySet<string>;
  readonly onStop: () => void;
  readonly onCopy: (content: string) => void;
  readonly onEdit: (messageId: string) => void;
  readonly onReset: (messageId: string) => void;
  readonly onDelete: (messageId: string) => void;
  readonly onSaveEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onSelectVersion: (groupId: string, messageId: string) => void;
  readonly onToggleSteps: (messageId: string) => void;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

interface MessageActionBarProps {
  readonly message: Readonly<Message>;
  readonly isAssistant: boolean;
  readonly isInlineEditing: boolean;
  readonly isSearching: boolean;
  readonly versionInfo: VersionInfo | null;
  readonly onSelectVersion: (groupId: string, messageId: string) => void;
  readonly onCopy: (content: string) => void;
  readonly onEdit: (messageId: string) => void;
  readonly onReset: (messageId: string) => void;
  readonly onDelete: (messageId: string) => void;
}

const MessageVersionControls = ({
  versionInfo,
  onSelectVersion,
}: Readonly<Pick<MessageActionBarProps, "versionInfo" | "onSelectVersion">>) => {
  if (versionInfo === null) {
    return <></>;
  }
  const previousVersionId = versionInfo.versionIds[versionInfo.currentIndex - 1],
   nextVersionId = versionInfo.versionIds[versionInfo.currentIndex + 1],
   selectPreviousVersion = () => {
    if (previousVersionId) {
      onSelectVersion(versionInfo.groupId, previousVersionId);
    }
  },
   selectNextVersion = () => {
    if (nextVersionId) {
      onSelectVersion(versionInfo.groupId, nextVersionId);
    }
  };
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={selectPreviousVersion}
        disabled={versionInfo.currentIndex === 0}
        className="h-7 w-7 px-0"
        aria-label="Previous message version"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span className="font-mono text-xs">
        {versionInfo.currentIndex + 1}/{versionInfo.totalVersions}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={selectNextVersion}
        disabled={versionInfo.currentIndex === versionInfo.totalVersions - 1}
        className="h-7 w-7 px-0"
        aria-label="Next message version"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </>
  );
},

 MessageActionButtons = ({
 message,
 isAssistant,
 isSearching,
  onCopy,
  onEdit,
  onReset,
  onDelete,
}: Readonly<Pick<
  MessageActionBarProps,
  "message" | "isAssistant" | "isSearching" | "onCopy" | "onEdit" | "onReset" | "onDelete"
>>) => (
  <>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() =>{  onCopy(message.content); }}
      className="h-8 px-2 text-xs"
    >
      <Copy className="mr-1 h-3.5 w-3.5" />
      Copy
    </Button>
    {!isAssistant && (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>{  onEdit(message.id); }}
        className="h-8 px-2 text-xs"
      >
        <Pencil className="mr-1 h-3.5 w-3.5" />
        Edit
      </Button>
    )}
    {isAssistant && (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() =>{  onReset(message.id); }}
        disabled={isSearching}
        className="h-8 px-2 text-xs"
      >
        <RotateCcw className="mr-1 h-3.5 w-3.5" />
        Retry
      </Button>
    )}
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() =>{  onDelete(message.id); }}
      disabled={isSearching}
      className="h-8 px-2 text-xs"
    >
      <Trash2 className="mr-1 h-3.5 w-3.5" />
      Delete
    </Button>
  </>
),

 MessageActionBar = (props: Readonly<MessageActionBarProps>) => {
  const {
    message,
    isAssistant,
    isInlineEditing,
    isSearching,
    versionInfo,
    onSelectVersion,
    onCopy,
    onEdit,
    onReset,
    onDelete,
  } = props;
  if (message.isStreaming || message.toolType) {
    return <></>;
  }
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1">
        <MessageVersionControls
          versionInfo={versionInfo}
          onSelectVersion={onSelectVersion}
        />
      </div>
      {!isInlineEditing && (
        <div className="flex items-center justify-end gap-1.5">
          <MessageActionButtons
            message={message}
            isAssistant={isAssistant}
            isSearching={isSearching}
            onCopy={onCopy}
            onEdit={onEdit}
            onReset={onReset}
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  );
};

interface MessageStepsToggleProps {
  readonly message: Readonly<Message>;
  readonly isAssistant: boolean;
  readonly stepsExpanded: boolean;
  readonly onToggleSteps: (messageId: string) => void;
}

const ThinkingSteps = ({
  message,
  stepsExpanded,
}: Readonly<Pick<MessageStepsToggleProps, "message" | "stepsExpanded">>) => {
  const steps = message.thinking_steps ?? [];
  return (
    <>
      {stepsExpanded && (
        <div className="mt-3 space-y-2">
          {steps.map((step, stepIndex) => (
            <div
              key={`${message.id}-step-${step.type}-${step.content}`}
              className="rounded-2xl border border-border/20 bg-background/40 p-3"
            >
              <div className="font-mono text-xs uppercase tracking-wide text-muted-foreground/70">
                Step {stepIndex + 1}: {step.type.replace("_", " ")}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{step.content}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
},

 MessageStepsToggle = (props: Readonly<MessageStepsToggleProps>) => {
  const { message, isAssistant, stepsExpanded, onToggleSteps } = props,
   stepCount = message.thinking_steps?.length ?? 0;
  if (!isAssistant || message.isStreaming === true || stepCount === FIRST_INDEX) {
    return <></>;
  }
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() =>{  onToggleSteps(message.id); }}
        className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {stepsExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
        {stepsExpanded ? "Hide steps" : `Show steps (${stepCount})`}
      </button>
      <ThinkingSteps message={message} stepsExpanded={stepsExpanded} />
    </div>
  );
};

interface MessageBodyProps {
  readonly message: Readonly<Message>;
  readonly isAssistant: boolean;
  readonly isInlineEditing: boolean;
  readonly editingDraft: string;
  readonly isSearching: boolean;
  readonly setEditingDraft: (value: string) => void;
  readonly onStop: () => void;
  readonly onSaveEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

function getMessageClass(message: Message): string {
  if (message.type === "user") {
    return "border-border/5 bg-[var(--news-bg-secondary)]/30 ml-20";
  }
  if (message.error === true) {
    return "border-border/5 bg-destructive/5 mr-12";
  }
  return "border-transparent bg-transparent pl-0 pr-0 mt-2 mr-4";
}

const InlineMessageEditor = ({
  editingDraft,
  isSearching,
  setEditingDraft,
  onSaveEdit,
  onCancelEdit,
}: Readonly<
  Pick<
    MessageBodyProps,
    "editingDraft" | "isSearching" | "setEditingDraft" | "onSaveEdit" | "onCancelEdit"
  >
>) => (
  <form
    onSubmit={(event) => {
      event.preventDefault();
      onSaveEdit();
    }}
    className="space-y-3"
  >
    <textarea
      value={editingDraft}
      onChange={(event) =>{  setEditingDraft(event.target.value); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onSaveEdit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onCancelEdit();
        }
      }}
      autoFocus
      disabled={isSearching}
      className="min-h-28 w-full resize-y rounded-2xl border border-primary/30 bg-background/60 px-4 py-3 text-base text-foreground focus:outline-none"
    />
    <div className="flex justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCancelEdit}
        disabled={isSearching}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        size="sm"
        disabled={editingDraft.trim().length === 0 || isSearching}
      >
        Save
      </Button>
    </div>
  </form>
),

 StreamingMessage = ({
  message,
  onStop,
}: Readonly<Pick<MessageBodyProps, "message" | "onStop">>) => (
  <div className="flex items-center gap-2 text-muted-foreground">
    <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
    <span>{message.streamingStatus ?? "Working..."}</span>
    <button
      type="button"
      onClick={onStop}
      className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-border/40 hover:text-foreground"
      title="Stop generation"
    >
      <Square className="h-3 w-3" />
      Stop
    </button>
  </div>
),

 MessageBody = (props: Readonly<MessageBodyProps>) => {
  const {
    message,
    isAssistant,
    isInlineEditing,
    editingDraft,
    isSearching,
    setEditingDraft,
    onStop,
    onSaveEdit,
    onCancelEdit,
    onOpenArticle,
  } = props;

  if (isInlineEditing) {
    return (
      <InlineMessageEditor
        editingDraft={editingDraft}
        isSearching={isSearching}
        setEditingDraft={setEditingDraft}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
      />
    );
  }

  if (isAssistant && message.isStreaming === true) {
    return <StreamingMessage message={message} onStop={onStop} />;
  }

  if (isAssistant) {
    return (
      <EmbeddedContent
        content={message.content}
        articles={buildArticleEmbeds(message)}
        onOpenArticle={onOpenArticle}
      />
    );
  }
  return <p>{message.content}</p>;
},

 ConversationMessageHeader = ({
  isAssistant,
  timestamp,
}: Readonly<{ isAssistant: boolean; timestamp: Date }>) => (
  <div className="flex items-center justify-between font-mono text-xs uppercase tracking-wider text-muted-foreground">
    <span>{isAssistant ? "Assistant" : "You"}</span>
    <span>
      {timestamp.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  </div>
);

interface ConversationMessageDetailsProps {
  item: MessageItemProps;
  isAssistant: boolean;
  isInlineEditing: boolean;
  versionInfo: VersionInfo | null;
  stepsExpanded: boolean;
}

const ConversationMessageBody = ({
  item,
  isAssistant,
  isInlineEditing,
}: Readonly<Pick<ConversationMessageDetailsProps, "item" | "isAssistant" | "isInlineEditing">>) => (
  <div className="mt-3 text-base text-foreground/90">
    <MessageBody
      message={item.message}
      isAssistant={isAssistant}
      isInlineEditing={isInlineEditing}
      editingDraft={item.editingDraft}
      isSearching={item.isSearching}
      setEditingDraft={item.setEditingDraft}
      onStop={item.onStop}
      onSaveEdit={item.onSaveEdit}
      onCancelEdit={item.onCancelEdit}
      onOpenArticle={item.onOpenArticle}
    />
  </div>
),

 ConversationMessageControls = ({
  item,
  isAssistant,
  isInlineEditing,
  versionInfo,
  stepsExpanded,
}: Readonly<ConversationMessageDetailsProps>) => (
  <>
    <MessageActionBar
      message={item.message}
      isAssistant={isAssistant}
      isInlineEditing={isInlineEditing}
      isSearching={item.isSearching}
      versionInfo={versionInfo}
      onSelectVersion={item.onSelectVersion}
      onCopy={item.onCopy}
      onEdit={item.onEdit}
      onReset={item.onReset}
      onDelete={item.onDelete}
    />
    <MessageStepsToggle
      message={item.message}
      isAssistant={isAssistant}
      stepsExpanded={stepsExpanded}
      onToggleSteps={item.onToggleSteps}
    />
  </>
),

 ConversationMessageDetails = ({
  item,
  isAssistant,
  isInlineEditing,
  versionInfo,
  stepsExpanded,
}: Readonly<ConversationMessageDetailsProps>) =>
  (
    <>
      <ConversationMessageHeader
        isAssistant={isAssistant}
        timestamp={item.message.timestamp}
      />
      <ConversationMessageBody
        item={item}
        isAssistant={isAssistant}
        isInlineEditing={isInlineEditing}
      />
      <ConversationMessageControls
        item={item}
        isAssistant={isAssistant}
        isInlineEditing={isInlineEditing}
        versionInfo={versionInfo}
        stepsExpanded={stepsExpanded}
      />
    </>
  )
,

 ConversationMessageItem = (props: MessageItemProps) => {
  const { message, messages, activeAssistantVersions, editingMessageId, expandedStepMessageIds } = props,
   isAssistant = message.type === "assistant",
   isInlineEditing = !isAssistant && editingMessageId === message.id,
   stepsExpanded = expandedStepMessageIds.has(message.id),
   versionInfo = getMessageVersionInfo(
    messages,
    message.id,
    activeAssistantVersions,
  ),
   messageClass = getMessageClass(message);
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`rounded-xl border px-5 py-3.5 ${messageClass}`}
    >
      <ConversationMessageDetails
        item={props}
        isAssistant={isAssistant}
        isInlineEditing={isInlineEditing}
        versionInfo={versionInfo}
        stepsExpanded={stepsExpanded}
      />
    </motion.div>
  );
};

interface ChatScrollAreaProps {
  conversationMessages: Message[];
  messages: Message[];
  activeAssistantVersions: Record<string, string>;
  editingMessageId: string | null;
  editingDraft: string;
  setEditingDraft: (value: string) => void;
  isSearching: boolean;
  expandedStepMessageIds: Set<string>;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  onStop: () => void;
  onCopy: (content: string) => void;
  onEdit: (messageId: string) => void;
  onReset: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onSelectVersion: (groupId: string, messageId: string) => void;
  onToggleSteps: (messageId: string) => void;
  onOpenArticle: (article: NewsArticle) => void;
}

const ConversationMessageList = ({
  conversationMessages,
  ...messageProps
}: Readonly<Omit<ChatScrollAreaProps, "chatScrollRef">>) => {
  if (conversationMessages.length === 0) {
    return (
      <div className="rounded-2xl border border-border/40 bg-card/50 p-6 text-sm text-muted-foreground backdrop-blur-xl">
        Ask a question to start.
      </div>
    );
  }
  return (
    <>
      {conversationMessages.map((message) => (
        <ConversationMessageItem key={message.id} message={message} {...messageProps} />
      ))}
    </>
  );
},

 ChatScrollArea = (props: ChatScrollAreaProps) => {
  const { chatScrollRef, ...messageProps } = props;
  return (
    <div
      ref={chatScrollRef}
      className="custom-scrollbar flex-1 min-h-0 space-y-6 overflow-y-auto px-2 py-6"
    >
      <ConversationMessageList {...messageProps} />
    </div>
  );
};

interface ChatComposerFormProps {
  query: string;
  setQuery: (value: string) => void;
  isSearching: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  composerFormRef: React.RefObject<HTMLFormElement | null>;
  onSearch: (e: React.FormEvent) => void;
}

const ChatComposerInput = ({
  query,
  setQuery,
  isSearching,
  inputRef,
  onSearch,
}: Readonly<Pick<ChatComposerFormProps, "query" | "setQuery" | "isSearching" | "inputRef" | "onSearch">>) => (
  <>
    <div className="flex items-center gap-2 rounded-2xl border border-border/40 bg-card/50 p-2 pl-4 shadow-xl shadow-black/10 transition-all duration-300 ease-out focus-within:border-primary/40 focus-within:bg-card/60">
      <textarea
        ref={inputRef}
        value={query}
        onChange={(event) =>{  setQuery(event.target.value); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSearch(event);
          }
        }}
        placeholder="Ask a question and press Enter..."
        className="h-10 w-full resize-none bg-transparent px-1 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        disabled={isSearching}
      />
    </div>
    {query.length >= 3 && (
      <SearchSuggestions
        query={query}
        onSuggestionClick={(suggestion) => {
          setQuery(suggestion.label);
          inputRef.current?.focus();
        }}
        className="pt-2"
      />
    )}
  </>
),

 ChatComposerSubmit = ({
  query,
  isSearching,
}: Readonly<Pick<ChatComposerFormProps, "query" | "isSearching">>) => (
  <Button
    type="submit"
    size="sm"
    disabled={!query.trim() || isSearching}
    className="h-10 rounded-full bg-primary px-6 text-background transition-all duration-300 ease-out active:scale-95"
  >
    {isSearching ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : (
      <>
        Send <ArrowRight className="ml-1 h-4 w-4" />
      </>
    )}
  </Button>
),

 ChatComposerForm = (props: ChatComposerFormProps) => {
  const { query, setQuery, isSearching, inputRef, composerFormRef, onSearch } = props;
  return (
    <div className="border-t border-border/20 bg-background/70 p-4 backdrop-blur-xl">
      <form ref={composerFormRef} onSubmit={onSearch} className="space-y-2">
        <ChatComposerInput
          query={query}
          setQuery={setQuery}
          isSearching={isSearching}
          inputRef={inputRef}
          onSearch={onSearch}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" />
          <ChatComposerSubmit query={query} isSearching={isSearching} />
        </div>
      </form>
    </div>
  );
};

interface ResearchSidePanelsProps {
  thinkingSteps: ThinkingStep[];
  latestAssistantMessage: Message | undefined;
  latestUserMessage: Message | undefined;
  latestSemanticMessage: Message | undefined;
  groupedSources: {
    sourceId: string;
    sourceName: string;
    articles: NewsArticle[];
  }[];
  expandedSourceIds: Set<string>;
  onToggleSource: (sourceId: string) => void;
  onOpenArticle: (article: NewsArticle) => void;
}

interface SourceGroup {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly articles: NewsArticle[];
}

interface ResearchLogPanelProps {
  thinkingSteps: ThinkingStep[];
}

const ResearchLogPanel = (props: Readonly<ResearchLogPanelProps>) => {
  const { thinkingSteps } = props;
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground/70">
          Research Log
        </h3>
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground/55">
          {thinkingSteps.length} steps
        </span>
      </div>
      <div className="space-y-3 text-sm">
        {thinkingSteps.length > 0 ? (
          thinkingSteps.slice(-RESEARCH_LOG_LIMIT).map((step) => (
            <div
              key={`${step.type}-${step.content}`}
              className="rounded-r-2xl border-l-2 border-primary/25 bg-background/25 px-3 py-2.5"
            >
              <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground/65">
                {step.type.replace("_", " ")}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground/80">
                {step.content}
              </p>
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            Reasoning steps will appear as the agent works.
          </p>
        )}
      </div>
    </section>
  );
};

interface VerificationSectionProps {
  latestAssistantMessage: Message | undefined;
  latestUserMessage: Message | undefined;
}

const VerificationSection = (props: Readonly<VerificationSectionProps>) => {
  const { latestAssistantMessage, latestUserMessage } = props;
  if (
    latestAssistantMessage === undefined ||
    latestAssistantMessage.isStreaming === true ||
    latestAssistantMessage.content.length === 0
  ) {
    return;
  }
  return (
    <section className="border-t border-border/15 pt-6">
      <VerificationPanel
        query={latestUserMessage?.content ?? ""}
        mainAnswer={latestAssistantMessage.content}
        className="rounded-2xl border-border/20 bg-card/30"
      />
    </section>
  );
};

interface RelatedCoveragePanelProps {
  latestSemanticMessage: Message | undefined;
  onOpenArticle: (article: NewsArticle) => void;
}

const RelatedCoveragePanel = (props: Readonly<RelatedCoveragePanelProps>) => {
  const { latestSemanticMessage, onOpenArticle } = props,
   results = latestSemanticMessage?.semanticResults ?? [];
  if (results.length === 0) {
    return;
  }
  return (
    <section className="border-t border-border/15 pt-6">
      <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground/70">
        Related Coverage
      </h3>
      <div className="mt-3 space-y-2">
        {results.map(({ article, similarityScore }) => (
          <button
            key={`semantic-${article.url || article.id}`}
            onClick={() =>{  onOpenArticle(article); }}
            className="w-full rounded-2xl border border-border/15 bg-background/35 p-3 text-left transition-colors hover:border-primary/35"
          >
            <div className="line-clamp-2 font-serif text-sm font-medium text-foreground/90">
              {article.title}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{article.source}</span>
              {typeof similarityScore === "number" && (
                <span className="rounded-full border border-border/20 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground">
                  {Math.round(similarityScore * 100)}% match
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
};

interface SourcesUsedPanelProps {
  groupedSources: SourceGroup[];
  expandedSourceIds: Set<string>;
  onToggleSource: (sourceId: string) => void;
  onOpenArticle: (article: NewsArticle) => void;
}

interface SourceGroupEntryProps {
  group: SourceGroup;
  isExpanded: boolean;
  onToggleSource: (sourceId: string) => void;
  onOpenArticle: (article: NewsArticle) => void;
}

const SourceGroupEntry = ({
  group,
  isExpanded,
  onToggleSource,
  onOpenArticle,
}: Readonly<SourceGroupEntryProps>) => {
  const visibleArticles = isExpanded
    ? group.articles
    : group.articles.slice(0, SOURCE_PREVIEW_LIMIT);
  return (
    <div className="border-t border-border/10 pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">{group.sourceName}</div>
          <div className="mt-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground/70">
            {group.articles.length} articles
          </div>
        </div>
        {group.articles.length > SOURCE_PREVIEW_LIMIT && (
          <button
            type="button"
            onClick={() =>{  onToggleSource(group.sourceId); }}
            className="font-mono text-xs uppercase tracking-wider text-primary hover:underline"
          >
            {isExpanded ? "Collapse" : `Show all (${group.articles.length})`}
          </button>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {visibleArticles.map((article) => (
          <button
            key={`${group.sourceId}-${article.url || article.id}`}
            onClick={() =>{  onOpenArticle(article); }}
            className="w-full rounded-2xl bg-background/35 px-3 py-2.5 text-left text-xs transition-colors hover:bg-card/60"
          >
            <div className="line-clamp-2 font-serif text-sm font-medium text-foreground/90">
              {article.title}
            </div>
            <div className="mt-2.5 flex items-center justify-between font-mono text-xs uppercase tracking-wide text-muted-foreground/60">
              <span>{article.source}</span>
              <span>{formatShortDate(article.publishedAt)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
},

 SourcesUsedPanel = (props: Readonly<SourcesUsedPanelProps>) => {
  const {
    groupedSources,
    expandedSourceIds,
    onToggleSource,
    onOpenArticle,
  } = props;
  if (groupedSources.length === 0) {
    return <></>;
  }
  return (
    <section className="border-t border-border/15 pt-6">
      <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground/70">
        Sources Used
      </h3>
      <div className="mt-3 space-y-4">
        {groupedSources.map((group) => (
          <SourceGroupEntry
            key={group.sourceId}
            group={group}
            isExpanded={expandedSourceIds.has(group.sourceId)}
            onToggleSource={onToggleSource}
            onOpenArticle={onOpenArticle}
          />
        ))}
      </div>
    </section>
  );
};

function ResearchSidePanels(props: ResearchSidePanelsProps) {
  const { thinkingSteps, latestAssistantMessage, latestUserMessage, latestSemanticMessage, groupedSources, expandedSourceIds, onToggleSource, onOpenArticle } = props;
  return (
    <div className="space-y-6 px-5 py-6 md:px-6">
                      <ResearchLogPanel thinkingSteps={thinkingSteps} />

                      <VerificationSection
                        latestAssistantMessage={latestAssistantMessage}
                        latestUserMessage={latestUserMessage}
                      />

                      <RelatedCoveragePanel
                        latestSemanticMessage={latestSemanticMessage}
                        onOpenArticle={onOpenArticle}
                      />

                      <SourcesUsedPanel
                        groupedSources={groupedSources}
                        expandedSourceIds={expandedSourceIds}
                        onToggleSource={onToggleSource}
                        onOpenArticle={onOpenArticle}
                      />
    </div>
  );
}

interface ResearchChatViewProps {
  conversationMessages: Message[];
  messages: Message[];
  activeAssistantVersions: Record<string, string>;
  editingMessageId: string | null;
  editingDraft: string;
  setEditingDraft: (value: string) => void;
  isSearching: boolean;
  expandedStepMessageIds: Set<string>;
  expandedSourceIds: Set<string>;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  composerFormRef: React.RefObject<HTMLFormElement | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  query: string;
  setQuery: (value: string) => void;
  onSearch: (e: React.FormEvent) => void;
  onStop: () => void;
  onCopy: (content: string) => void;
  onEdit: (messageId: string) => void;
  onReset: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onSelectVersion: (groupId: string, messageId: string) => void;
  onToggleSteps: (messageId: string) => void;
  onToggleSource: (sourceId: string) => void;
  onOpenArticle: (article: NewsArticle) => void;
  thinkingSteps: ThinkingStep[];
  latestAssistantMessage: Message | undefined;
  latestUserMessage: Message | undefined;
  latestSemanticMessage: Message | undefined;
  groupedSources: {
    sourceId: string;
    sourceName: string;
    articles: NewsArticle[];
  }[];
}

interface ResearchChatPartProps {
  view: ResearchChatViewProps;
}

const ResearchChatMain = ({
  view,
}: Readonly<ResearchChatPartProps>) => (
  <section className="flex min-w-0 flex-1 flex-col lg:basis-8/12">
    <div className="flex-1 min-h-0">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 md:px-6">
        <ChatScrollArea
          conversationMessages={view.conversationMessages}
          messages={view.messages}
          activeAssistantVersions={view.activeAssistantVersions}
          editingMessageId={view.editingMessageId}
          editingDraft={view.editingDraft}
          setEditingDraft={view.setEditingDraft}
          isSearching={view.isSearching}
          expandedStepMessageIds={view.expandedStepMessageIds}
          chatScrollRef={view.chatScrollRef}
          onStop={view.onStop}
          onCopy={view.onCopy}
          onEdit={view.onEdit}
          onReset={view.onReset}
          onDelete={view.onDelete}
          onSaveEdit={view.onSaveEdit}
          onCancelEdit={view.onCancelEdit}
          onSelectVersion={view.onSelectVersion}
          onToggleSteps={view.onToggleSteps}
          onOpenArticle={view.onOpenArticle}
        />
        <ChatComposerForm
          query={view.query}
          setQuery={view.setQuery}
          isSearching={view.isSearching}
          inputRef={view.inputRef}
          composerFormRef={view.composerFormRef}
          onSearch={view.onSearch}
        />
      </div>
    </div>
  </section>
),

 ResearchChatAside = ({
  view,
}: Readonly<ResearchChatPartProps>) => (
  <aside className="flex h-full w-full shrink-0 flex-col overflow-hidden border-t border-border/20 bg-background/60 lg:w-96 lg:border-l lg:border-t-0">
    <div className="custom-scrollbar h-full flex-1 overflow-y-auto">
      <ResearchSidePanels
        thinkingSteps={view.thinkingSteps}
        latestAssistantMessage={view.latestAssistantMessage}
        latestUserMessage={view.latestUserMessage}
        latestSemanticMessage={view.latestSemanticMessage}
        groupedSources={view.groupedSources}
        expandedSourceIds={view.expandedSourceIds}
        onToggleSource={view.onToggleSource}
        onOpenArticle={view.onOpenArticle}
      />
    </div>
  </aside>
),

 ResearchChatView = (props: ResearchChatViewProps) =>
  (
    <div className="flex h-full min-h-0 flex-1 flex-col lg:flex-row">
      <ResearchChatMain view={props} />
      <ResearchChatAside view={props} />
    </div>
  )
;

interface WorkspaceHeaderProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  isEmpty: boolean;
  activeBriefTitle: string;
  messageCount: number;
  latestAssistantMessage: Message | undefined;
  isSearching: boolean;
  onStop: () => void;
}

interface WorkspaceHeaderContentProps {
  activeBriefTitle: string;
  messageCount: number;
  latestAssistantMessage: Message | undefined;
  isSearching: boolean;
  onStop: () => void;
}

const WorkspaceHomeLink = () => (
  <Link href="/">
    <Button
      variant="ghost"
      size="sm"
      className="h-9 rounded-full px-4 text-xs text-muted-foreground transition-all duration-300 ease-out hover:bg-card/50 hover:text-foreground"
    >
      <Home className="mr-2 h-3.5 w-3.5" />
      Back to News
    </Button>
  </Link>
),

 EmptyWorkspaceHeaderContent = () => (
  <>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="truncate font-serif text-base font-medium tracking-tight text-foreground">
          Scoop Research
        </h1>
        <span className="hidden h-1 w-1 rounded-full bg-border/70 md:inline-block" />
        <span className="hidden font-mono text-xs uppercase tracking-widest text-muted-foreground/55 md:inline">
          Workspace
        </span>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-xl text-sm text-muted-foreground">
        Start a focused question to build a source-backed brief.
      </p>
      <WorkspaceHomeLink />
    </div>
  </>
),

 WorkspaceActivity = ({
  latestAssistantMessage,
  isSearching,
  onStop,
}: Readonly<Pick<WorkspaceHeaderContentProps, "latestAssistantMessage" | "isSearching" | "onStop">>) => {
  const isRunning = isSearching || latestAssistantMessage?.isStreaming === true;
  if (!isRunning) {
    return <></>;
  }
  return (
    <div className="flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1.5 text-xs text-primary/80">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span className="hidden font-mono text-xs uppercase tracking-widest sm:inline">
        {latestAssistantMessage?.streamingStatus ?? "Running"}
      </span>
      <button
        type="button"
        onClick={onStop}
        className="flex items-center justify-center rounded-full p-1 transition-colors hover:bg-primary/15"
        title="Stop generation"
      >
        <Square className="h-2.5 w-2.5 fill-current" />
      </button>
    </div>
  );
},

 ActiveWorkspaceHeaderContent = (
  props: Readonly<WorkspaceHeaderContentProps>,
) => {
  const {
    activeBriefTitle,
    messageCount,
    latestAssistantMessage,
    isSearching,
    onStop,
  } = props;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <h2 className="min-w-0 flex-1 truncate font-serif text-xl font-medium leading-tight tracking-tight text-foreground md:text-2xl">
        {activeBriefTitle}
      </h2>
      <div className="hidden shrink-0 items-center gap-4 font-mono text-xs uppercase tracking-widest text-muted-foreground/65 xl:flex">
        <span>{messageCount} messages</span>
        {latestAssistantMessage?.articles_searched !== undefined &&
          latestAssistantMessage.articles_searched > 0 && (
            <span>{latestAssistantMessage.articles_searched} sources searched</span>
          )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <WorkspaceActivity
          latestAssistantMessage={latestAssistantMessage}
          isSearching={isSearching}
          onStop={onStop}
        />
        <WorkspaceHomeLink />
      </div>
    </div>
  );
};

function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const { sidebarCollapsed, onToggleSidebar, isEmpty, activeBriefTitle, messageCount, latestAssistantMessage, isSearching, onStop } = props;
  return (
          <header className="sticky top-0 z-20 shrink-0 border-b border-border/20 bg-background/80 backdrop-blur-2xl">
            <div className="flex w-full items-start gap-4 px-4 py-4 md:px-6 lg:px-8">
              <button
                onClick={onToggleSidebar}
                className="mt-0.5 shrink-0 rounded-full border border-border/30 bg-background/70 p-2 text-muted-foreground transition-all duration-300 ease-out hover:border-border/50 hover:text-foreground active:scale-95"
                aria-label={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
              >
                {sidebarCollapsed ? (
                  <ChevronRight size={16} />
                ) : (
                  <ChevronLeft size={16} />
                )}
              </button>

              <div className="min-w-0 flex-1">
                {isEmpty ? (
                  <EmptyWorkspaceHeaderContent />
                ) : (
                  <ActiveWorkspaceHeaderContent
                    activeBriefTitle={activeBriefTitle}
                    messageCount={messageCount}
                    latestAssistantMessage={latestAssistantMessage}
                    isSearching={isSearching}
                    onStop={onStop}
                  />
                )}
              </div>
            </div>
          </header>
  );
}

interface EmptyResearchViewProps {
  query: string;
  setQuery: (value: string) => void;
  isSearching: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSearch: (e: React.FormEvent) => void;
  onSampleQuery: (sampleQuery: string) => void;
}

const EmptyResearchHeader = () => (
  <motion.div
    className="mb-6"
    initial={{ opacity: 0, y: 24 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, ease: "easeOut" }}
  >
    <div className="mb-2 flex items-center gap-3">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
        <Cpu className="h-4 w-4 text-primary" />
      </div>
      <h1 className="font-serif text-3xl tracking-tight text-foreground">
        Research Workspace
      </h1>
    </div>
    <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
      Ask a focused question to start a multi-source research brief.
    </p>
  </motion.div>
);

interface EmptyResearchComposerProps {
  query: string;
  setQuery: (value: string) => void;
  isSearching: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSearch: (event: React.FormEvent) => void;
}

const EmptyResearchComposer = ({
  query,
  setQuery,
  isSearching,
  inputRef,
  onSearch,
}: Readonly<EmptyResearchComposerProps>) => (
  <div className="group relative w-full">
    <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-primary/10 to-transparent opacity-0 blur-xl transition duration-500 group-hover:opacity-100" />
    <div className="relative rounded-2xl border border-border/40 bg-card/40 p-2 shadow-2xl shadow-black/20 backdrop-blur-xl transition-all duration-300 ease-out focus-within:border-primary/30">
      <form onSubmit={onSearch}>
        <textarea
          ref={inputRef}
          value={query}
          onChange={(event) =>{  setQuery(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSearch(event);
            }
          }}
          placeholder="Ask a question about coverage, bias, or context..."
          className="min-h-20 w-full resize-none bg-transparent px-4 py-3 text-base font-sans text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
        />
        {query.length >= 3 && (
          <SearchSuggestions
            query={query}
            onSuggestionClick={(suggestion) => {
              setQuery(suggestion.label);
              inputRef.current?.focus();
            }}
            className="mt-2 border-t border-border/40 pt-2"
          />
        )}
        <div className="mt-2 flex items-center justify-between border-t border-border/20 px-3 pb-1 pt-3">
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
            >
              <Filter className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
            >
              <Clock className="h-4 w-4" />
            </button>
          </div>
          <button
            type="submit"
            disabled={!query.trim() || isSearching}
            className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-background transition-all duration-300 ease-out active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSearching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Start Research <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  </div>
),

 SampleQueryGrid = ({
  onSampleQuery,
}: Readonly<Pick<EmptyResearchViewProps, "onSampleQuery">>) => (
  <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
    {sampleQueries.slice(0, SAMPLE_QUERY_LIMIT).map((sampleQuery) => (
      <motion.button
        key={sampleQuery}
        onClick={() =>{  onSampleQuery(sampleQuery); }}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="group rounded-2xl border border-border/40 bg-card/40 p-5 text-left transition-all duration-300 ease-out hover:-translate-y-1 hover:border-primary/30 hover:bg-card/60"
      >
        <p className="text-sm leading-relaxed text-muted-foreground/70 transition-colors group-hover:text-foreground">
          {sampleQuery}
        </p>
      </motion.button>
    ))}
  </div>
),

 EmptyResearchView = (props: EmptyResearchViewProps) => {
  const { onSampleQuery, ...composerProps } = props;
  return (
    <div className="flex flex-1 flex-col p-4 lg:p-8">
      <div className="mx-auto flex w-full max-w-2xl flex-1 -mt-16 flex-col justify-center">
        <EmptyResearchHeader />
        <EmptyResearchComposer {...composerProps} />
        <SampleQueryGrid onSampleQuery={onSampleQuery} />
      </div>
    </div>
  );
};

interface ResearchPageViewProps {
  activeAssistantVersions: Record<string, string>;
  activeBriefTitle: string;
  activeChatId: string | null;
  chatMessages: Message[];
  chats: ChatSummary[];
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  composerFormRef: React.RefObject<HTMLFormElement | null>;
  editingDraft: string;
  editingMessageId: string | null;
  expandedSourceIds: Set<string>;
  expandedStepMessageIds: Set<string>;
  groupedSources: { sourceId: string; sourceName: string; articles: NewsArticle[] }[];
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  isArticleModalOpen: boolean;
  isEmpty: boolean;
  isSearching: boolean;
  latestAssistantMessage: Message | undefined;
  latestSemanticMessage: Message | undefined;
  latestUserMessage: Message | undefined;
  onCancelEdit: () => void;
  onCloseArticle: () => void;
  onCopy: (content: string) => void;
  onDeleteChat: (id: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onDeleteChats: (ids: readonly string[]) => void;
  onEdit: (messageId: string) => void;
  onNewChat: () => void;
  onOpenArticle: (article: NewsArticle) => void;
  onRename: (id: string, title: string) => void;
  onReset: (messageId: string) => void;
  onSaveEdit: () => void;
  onSampleQuery: (query: string) => void;
  onSearch: (event: React.FormEvent) => void;
  onSelectChat: (id: string) => void;
  onSelectVersion: (groupId: string, messageId: string) => void;
  onStop: () => void;
  onToggleSidebar: () => void;
  onToggleSource: (sourceId: string) => void;
  onToggleSteps: (messageId: string) => void;
  query: string;
  selectedArticle: NewsArticle | null;
  setEditingDraft: (value: string) => void;
  setQuery: (value: string) => void;
  sidebarCollapsed: boolean;
  thinkingSteps: ThinkingStep[];
  conversationMessages: Message[];
}

interface ResearchPageContainerProps {
  controller: ResearchPageViewProps;
}

const ResearchSidebar = (props: Readonly<ResearchPageContainerProps>) => {
  const { controller } = props;
  return (
    <div className={`${controller.sidebarCollapsed ? "w-16" : "w-60"} hidden shrink-0 border-r border-border/30 bg-background/80 transition-all duration-300 ease-in-out backdrop-blur-xl md:block`}>
      <ChatSidebar
        chats={controller.chats}
        onSelect={controller.onSelectChat}
        onNewChat={controller.onNewChat}
        onRename={controller.onRename}
        onDelete={controller.onDeleteChat}
        onDeleteMultiple={controller.onDeleteChats}
        activeId={controller.activeChatId}
        collapsed={controller.sidebarCollapsed}
        onToggle={controller.onToggleSidebar}
      />
    </div>
  );
},

 ResearchWorkspaceBody = ({
  controller,
}: Readonly<ResearchPageContainerProps>) => (
  <main className="flex h-full flex-1 flex-col overflow-hidden bg-transparent">
    {controller.isEmpty ? (
      <EmptyResearchView
        query={controller.query}
        setQuery={controller.setQuery}
        isSearching={controller.isSearching}
        inputRef={controller.inputRef}
        onSearch={controller.onSearch}
        onSampleQuery={controller.onSampleQuery}
      />
    ) : (
      <ResearchChatView
        conversationMessages={controller.conversationMessages}
        messages={controller.chatMessages}
        activeAssistantVersions={controller.activeAssistantVersions}
        editingMessageId={controller.editingMessageId}
        editingDraft={controller.editingDraft}
        setEditingDraft={controller.setEditingDraft}
        isSearching={controller.isSearching}
        expandedStepMessageIds={controller.expandedStepMessageIds}
        expandedSourceIds={controller.expandedSourceIds}
        chatScrollRef={controller.chatScrollRef}
        composerFormRef={controller.composerFormRef}
        inputRef={controller.inputRef}
        query={controller.query}
        setQuery={controller.setQuery}
        onSearch={controller.onSearch}
        onStop={controller.onStop}
        onCopy={controller.onCopy}
        onEdit={controller.onEdit}
        onReset={controller.onReset}
        onDelete={controller.onDeleteMessage}
        onSaveEdit={controller.onSaveEdit}
        onCancelEdit={controller.onCancelEdit}
        onSelectVersion={controller.onSelectVersion}
        onToggleSteps={controller.onToggleSteps}
        onOpenArticle={controller.onOpenArticle}
        thinkingSteps={controller.thinkingSteps}
        latestAssistantMessage={controller.latestAssistantMessage}
        latestUserMessage={controller.latestUserMessage}
        latestSemanticMessage={controller.latestSemanticMessage}
        groupedSources={controller.groupedSources}
        onToggleSource={controller.onToggleSource}
      />
    )}
  </main>
),

 ResearchWorkspace = ({
  controller,
}: Readonly<ResearchPageContainerProps>) =>
  (
    <div className="flex min-w-0 flex-1 flex-col">
      <WorkspaceHeader
        sidebarCollapsed={controller.sidebarCollapsed}
        onToggleSidebar={controller.onToggleSidebar}
        isEmpty={controller.isEmpty}
        activeBriefTitle={controller.activeBriefTitle}
        messageCount={controller.conversationMessages.length}
        latestAssistantMessage={controller.latestAssistantMessage}
        isSearching={controller.isSearching}
        onStop={controller.onStop}
      />
      <ResearchWorkspaceBody controller={controller} />
    </div>
  )
,

 ResearchPageView = (props: Readonly<ResearchPageContainerProps>) => {
  const {
    controller,
  } = props;

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <div className="flex h-screen bg-gradient-to-br from-background via-background to-card/20">
        <ResearchSidebar controller={controller} />
        <ResearchWorkspace controller={controller} />
      </div>

      <ArticleDetailModal
        article={controller.selectedArticle}
        isOpen={controller.isArticleModalOpen}
        onClose={controller.onCloseArticle}
      />
    </div>
  );
};

interface ResearchChatState {
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly isSearching: boolean;
  readonly setIsSearching: (value: boolean) => void;
  readonly selectedArticle: NewsArticle | null;
  readonly setSelectedArticle: (value: NewsArticle | null) => void;
  readonly isArticleModalOpen: boolean;
  readonly setIsArticleModalOpen: (value: boolean) => void;
  readonly chats: readonly ReadonlyChatSummary[];
  readonly setChats: React.Dispatch<React.SetStateAction<ChatSummary[]>>;
  readonly chatMessagesMap: Readonly<Record<string, readonly Message[]>>;
  readonly setChatMessagesMap: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>;
  readonly activeAssistantVersionMap: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly setActiveAssistantVersionMap: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  readonly activeChatId: string | null;
  readonly setActiveChatId: React.Dispatch<React.SetStateAction<string | null>>;
  readonly editingMessageId: string | null;
  readonly setEditingMessageId: (value: string | null) => void;
  readonly editingDraft: string;
  readonly setEditingDraft: (value: string) => void;
  readonly sidebarCollapsed: boolean;
  readonly setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  readonly expandedStepMessageIds: ReadonlySet<string>;
  readonly setExpandedStepMessageIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  readonly expandedSourceIds: ReadonlySet<string>;
  readonly setExpandedSourceIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  readonly inputRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly composerFormRef: React.RefObject<HTMLFormElement | null>;
  readonly chatScrollRef: React.RefObject<HTMLDivElement | null>;
  readonly isHydratingRef: React.RefObject<boolean>;
  readonly abortControllerRef: React.RefObject<AbortController | undefined>;
  readonly consumedHandoffQueryRef: React.RefObject<string | undefined>;
  readonly messages: readonly Message[];
  readonly activeAssistantVersions: Readonly<Record<string, string>>;
  readonly conversationMessages: readonly Message[];
  readonly updateChatMessages: UpdateChatMessages;
  readonly setActiveAssistantVersion: (
    chatId: string,
    groupId: string,
    messageId: string,
  ) => void;
  readonly clearMessageEditing: () => void;
}

const getChatPreview = (items: readonly Message[]): string => {
  const latest = [...items]
    .toReversed()
    .find((message) => !message.toolType && message.content.trim().length > 0);
  if (latest === undefined) {
    return "";
  }
  return latest.content.slice(0, PROMPT_PREVIEW_MAX_LENGTH);
};

type ResearchChatSearchState = Pick<
  ResearchChatState,
  "isArticleModalOpen" | "isSearching" | "query" | "selectedArticle" | "setIsArticleModalOpen" | "setIsSearching" | "setQuery" | "setSelectedArticle"
>;

const useResearchChatSearchState = (): ResearchChatSearchState => {
  const [query, setQuery] = useState(""),
   [isSearching, setIsSearching] = useState(false),
   [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null),
   [isArticleModalOpen, setIsArticleModalOpen] = useState(false);

  return {
    isArticleModalOpen,
    isSearching,
    query,
    selectedArticle,
    setIsArticleModalOpen,
    setIsSearching,
    setQuery,
    setSelectedArticle,
  };
};

type ResearchChatEditorState = Pick<
  ResearchChatState,
  "editingDraft" | "editingMessageId" | "expandedSourceIds" | "expandedStepMessageIds" | "setEditingDraft" | "setEditingMessageId" | "setExpandedSourceIds" | "setExpandedStepMessageIds" | "setSidebarCollapsed" | "sidebarCollapsed"
>;

const useResearchChatEditorState = (): ResearchChatEditorState => {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null),
   [editingDraft, setEditingDraft] = useState(""),
   [sidebarCollapsed, setSidebarCollapsed] = useState(true),
   [expandedStepMessageIds, setExpandedStepMessageIds] = useState<Set<string>>(new Set()),
   [expandedSourceIds, setExpandedSourceIds] = useState<Set<string>>(new Set());

  return {
    editingDraft,
    editingMessageId,
    expandedSourceIds,
    expandedStepMessageIds,
    setEditingDraft,
    setEditingMessageId,
    setExpandedSourceIds,
    setExpandedStepMessageIds,
    setSidebarCollapsed,
    sidebarCollapsed,
  };
};

type ResearchChatCollectionsState = Pick<
  ResearchChatState,
  "activeAssistantVersionMap" | "activeChatId" | "chatMessagesMap" | "chats" | "setActiveAssistantVersionMap" | "setActiveChatId" | "setChatMessagesMap" | "setChats"
>;

const useResearchChatCollectionsState = (): ResearchChatCollectionsState => {
  const [chats, setChats] = useState<ChatSummary[]>([]),
   [chatMessagesMap, setChatMessagesMap] = useState<Record<string, Message[]>>({}),
   [activeAssistantVersionMap, setActiveAssistantVersionMap] = useState<Record<string, Record<string, string>>>({}),
   [activeChatId, setActiveChatId] = useState<string | null>(null);

  return {
    activeAssistantVersionMap,
    activeChatId,
    chatMessagesMap,
    chats,
    setActiveAssistantVersionMap,
    setActiveChatId,
    setChatMessagesMap,
    setChats,
  };
};

type ResearchChatRefs = Pick<
  ResearchChatState,
  "abortControllerRef" | "chatScrollRef" | "composerFormRef" | "consumedHandoffQueryRef" | "inputRef" | "isHydratingRef"
>;

const useResearchChatRefs = (): ResearchChatRefs => ({
  abortControllerRef: useRef<AbortController | undefined>(void 0),
  chatScrollRef: useRef<HTMLDivElement>(null),
  composerFormRef: useRef<HTMLFormElement>(null),
  consumedHandoffQueryRef: useRef<string | undefined>(void 0),
  inputRef: useRef<HTMLTextAreaElement>(null),
  isHydratingRef: useRef(true),
});

type ResearchChatMessageState = Pick<
  ResearchChatState,
  "activeAssistantVersions" | "clearMessageEditing" | "conversationMessages" | "messages" | "setActiveAssistantVersion" | "updateChatMessages"
>;

const useChatMessageUpdater = (
  collections: Readonly<ResearchChatCollectionsState>,
): UpdateChatMessages => {
  const { setChatMessagesMap, setChats } = collections;
  return useCallback<UpdateChatMessages>((chatId, updater, options) => {
    let nextMessages: Message[] = [];
    setChatMessagesMap((previous) => {
      const current = previous[chatId] ?? [];
      nextMessages = updater(current);
      if (nextMessages === current) {
        return previous;
      }
      return { ...previous, [chatId]: nextMessages };
    });
    if (options?.syncSummary === false) {
      return;
    }
    const updatedAt = options?.updatedAt ?? new Date().toISOString(),
     lastMessage = options?.summaryPreview ?? getChatPreview(nextMessages);
    setChats((previous) => previous.map((chat) => {
      if (chat.id !== chatId) {
        return chat;
      }
      return { ...chat, lastMessage, updatedAt };
    }));
  }, [setChatMessagesMap, setChats]);
};

interface ResearchChatMessageSelectors {
  activeAssistantVersions: Record<string, string>;
  conversationMessages: Message[];
  messages: Message[];
}

const useResearchChatMessageSelectors = (
  collections: Readonly<ResearchChatCollectionsState>,
): ResearchChatMessageSelectors => {
  const { activeAssistantVersionMap, activeChatId, chatMessagesMap } = collections,
   messages = useMemo(
    () => (activeChatId === null ? [] : [...(chatMessagesMap[activeChatId] ?? [])]),
    [activeChatId, chatMessagesMap],
  ),
   activeAssistantVersions = useMemo(
    () => (activeChatId === null ? {} : activeAssistantVersionMap[activeChatId] ?? {}),
    [activeAssistantVersionMap, activeChatId],
  ),
   conversationMessages = useMemo(
    () => [...getVisibleConversationMessages(messages, activeAssistantVersions)],
    [activeAssistantVersions, messages],
  );
  return { activeAssistantVersions, conversationMessages, messages };
},

 useResearchChatVersionSelection = (
  setActiveAssistantVersionMap: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>,
): Pick<ResearchChatMessageState, "setActiveAssistantVersion"> => {
  const setActiveAssistantVersion = useCallback((chatId: string, groupId: string, messageId: string) => {
    setActiveAssistantVersionMap((previous) => ({
      ...previous,
      [chatId]: { ...previous[chatId], [groupId]: messageId },
    }));
  }, [setActiveAssistantVersionMap]);
  return { setActiveAssistantVersion };
},

 useResearchChatEditingReset = (
  editor: Readonly<ResearchChatEditorState>,
): Pick<ResearchChatMessageState, "clearMessageEditing"> => {
  const { setEditingDraft, setEditingMessageId } = editor,
   clearMessageEditing = useCallback(() => {
    setEditingMessageId(null);
    setEditingDraft("");
  }, [setEditingDraft, setEditingMessageId]);
  return { clearMessageEditing };
},

 useResearchChatMessageState = (
  collections: Readonly<ResearchChatCollectionsState>,
  editor: Readonly<ResearchChatEditorState>,
): ResearchChatMessageState => {
  const selectors = useResearchChatMessageSelectors(collections),
   updater = useChatMessageUpdater(collections),
   versionSelection = useResearchChatVersionSelection(
    collections.setActiveAssistantVersionMap,
  ),
   editingReset = useResearchChatEditingReset(editor);
  return {
    ...selectors,
    ...editingReset,
    ...versionSelection,
    updateChatMessages: updater,
  };
},

 useResearchChatState = (): ResearchChatState => {
  const search = useResearchChatSearchState(),
   editor = useResearchChatEditorState(),
   collections = useResearchChatCollectionsState(),
   refs = useResearchChatRefs(),
   messages = useResearchChatMessageState(collections, editor);

  return { ...search, ...editor, ...collections, ...refs, ...messages };
};

interface ResearchChatActions {
  handleNewChat: () => void;
  handleStop: () => void;
  toggleSidebar: () => void;
  handleSelectChat: (id: string) => void;
  handleRenameChat: (id: string, title: string) => void;
  handleDeleteChat: (id: string) => void;
  handleDeleteChats: (ids: readonly string[]) => void;
  toggleStepVisibility: (messageId: string) => void;
  toggleSourceVisibility: (sourceId: string) => void;
}

const useChatCreationAction = (
  context: Readonly<ResearchChatState>,
): Pick<ResearchChatActions, "handleNewChat"> => {
  const {
    abortControllerRef,
    clearMessageEditing,
    setActiveAssistantVersionMap,
    setActiveChatId,
    setChatMessagesMap,
    setChats,
    setIsSearching,
  } = context,
   handleNewChat = () => {
    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
     newChat: ChatSummary = {
      id,
      lastMessage: "",
      title: "Untitled research",
      updatedAt: new Date().toISOString(),
    };
    abortControllerRef.current?.abort();
    abortControllerRef.current = undefined;
    setChats((previous) => [newChat, ...previous]);
    setChatMessagesMap((previous) => ({ ...previous, [id]: [] }));
    setActiveAssistantVersionMap((previous) => ({ ...previous, [id]: {} }));
    setActiveChatId(id);
    clearMessageEditing();
    setIsSearching(false);
  };
  return { handleNewChat };
},

 useChatTransportActions = (
  context: Readonly<ResearchChatState>,
): Pick<ResearchChatActions, "handleStop"> => {
  const {
    abortControllerRef,
    activeChatId,
    setIsSearching,
    updateChatMessages,
  } = context,
   handleStop = () => {
    if (activeChatId === null) {
      return;
    }
    abortControllerRef.current?.abort();
    abortControllerRef.current = undefined;
    setIsSearching(false);
    updateChatMessages(
      activeChatId,
      (previous) => previous.map((message) => {
        if (message.isStreaming !== true) {
          return message;
        }
        return {
          ...message,
          content: message.content || "Research cancelled.",
          isStreaming: false,
          streamingStatus: undefined,
        };
      }),
      { syncSummary: false },
    );
  };
  return { handleStop };
},

 useChatSelectionActions = (
  context: Readonly<ResearchChatState>,
): Pick<ResearchChatActions, "handleRenameChat" | "handleSelectChat"> => {
  const { clearMessageEditing, setActiveChatId, setChats } = context,
   handleSelectChat = (id: string) => {
    setActiveChatId(id);
    clearMessageEditing();
  },
   handleRenameChat = (id: string, title: string) => {
    setChats((previous) => previous.map((chat) =>
      chat.id === id ? { ...chat, title } : chat,
    ));
  };
  return { handleRenameChat, handleSelectChat };
},

 removeChatMessages = (
  chatMessagesMap: Readonly<Record<string, readonly Message[]>>,
  id: string,
): Record<string, Message[]> => {
  const nextMessages: Record<string, Message[]> = {};
  Object.entries(chatMessagesMap).forEach(([chatId, messages]) => {
    if (chatId !== id) {
      nextMessages[chatId] = [...messages];
    }
  });
  return nextMessages;
},

 removeSelectedChatMessages = (
  chatMessagesMap: Readonly<Record<string, readonly Message[]>>,
  ids: readonly string[],
): Record<string, Message[]> => {
  const nextMessages: Record<string, Message[]> = {};
  Object.entries(chatMessagesMap).forEach(([chatId, messages]) => {
    nextMessages[chatId] = [...messages];
  });
  ids.forEach((id) => {
    delete nextMessages[id];
  });
  return nextMessages;
},

 useChatDeletionActions = (
  context: Readonly<ResearchChatState>,
): Pick<ResearchChatActions, "handleDeleteChat" | "handleDeleteChats"> => {
  const {
    activeChatId,
    chatMessagesMap,
    chats,
    clearMessageEditing,
    setActiveChatId,
    setChatMessagesMap,
    setChats,
  } = context,
   handleDeleteChat = (id: string) => {
    const remainingChats = chats.filter((chat) => chat.id !== id),
     nextChatId = activeChatId === id
      ? remainingChats[0]?.id ?? null
      : activeChatId;
    setChats(remainingChats);
    setChatMessagesMap(removeChatMessages(chatMessagesMap, id));
    clearMessageEditing();
    if (activeChatId === id) {
      setActiveChatId(nextChatId);
    }
  },
   handleDeleteChats = (ids: readonly string[]) => {
    const remainingChats = chats.filter((chat) => !ids.includes(chat.id)),
     nextChatId = activeChatId !== null && ids.includes(activeChatId)
      ? remainingChats[0]?.id ?? null
      : activeChatId;
    setChats(remainingChats);
    setChatMessagesMap(removeSelectedChatMessages(chatMessagesMap, ids));
    clearMessageEditing();
    if (activeChatId !== nextChatId) {
      setActiveChatId(nextChatId);
    }
  };
  return { handleDeleteChat, handleDeleteChats };
},

 toggleSetValue = <T,>(values: ReadonlySet<T>, value: T): Set<T> => {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
},

 useChatVisibilityActions = (
  context: Readonly<ResearchChatState>,
): Pick<ResearchChatActions, "toggleSidebar" | "toggleSourceVisibility" | "toggleStepVisibility"> => {
  const {
    setExpandedSourceIds,
    setExpandedStepMessageIds,
    setSidebarCollapsed,
  } = context,
   toggleSidebar = () => {
    setSidebarCollapsed((previous) => !previous);
  },
   toggleStepVisibility = (messageId: string) => {
    setExpandedStepMessageIds((previous) => toggleSetValue(previous, messageId));
  },
   toggleSourceVisibility = (sourceId: string) => {
    setExpandedSourceIds((previous) => toggleSetValue(previous, sourceId));
  };
  return { toggleSidebar, toggleSourceVisibility, toggleStepVisibility };
},

 useResearchChatActions = (
  context: Readonly<ResearchChatState>,
): ResearchChatActions => ({
  ...useChatCreationAction(context),
  ...useChatDeletionActions(context),
  ...useChatSelectionActions(context),
  ...useChatTransportActions(context),
  ...useChatVisibilityActions(context),
}),

 reviveStoredChatMessages = (
  messages: StoredChatState["messages"] | undefined,
): Record<string, Message[]> => {
  const revivedMessages: Record<string, Message[]> = {};
  Object.entries(messages ?? {}).forEach(([chatId, items]) => {
    revivedMessages[chatId] = items.map((item) => ({
      ...item,
      isStreaming: false,
      timestamp: item.timestamp.length > 0 ? new Date(item.timestamp) : new Date(),
    }));
  });
  return revivedMessages;
},

 getHydratedChatId = (
  stored: Readonly<StoredChatState>,
  revivedMessages: Readonly<Record<string, Message[]>>,
): string | null => {
  if (stored.activeChatId !== undefined && stored.activeChatId !== null && revivedMessages[stored.activeChatId] !== undefined) {
    return stored.activeChatId;
  }
  return stored.chats.length > 0 ? stored.chats[0]!.id : null;
},

 hydrateResearchChats = (context: Readonly<ResearchChatState>): void => {
  if (typeof window === "undefined") {return;}
  try {
    const stored = globalThis.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!stored) {return;}
    const parsed = JSON.parse(stored) as StoredChatState;
    if (parsed.version !== CHAT_STORAGE_VERSION) {return;}
    const revivedMessages = reviveStoredChatMessages(parsed.messages);
    context.setChats(parsed.chats);
    context.setChatMessagesMap(revivedMessages);
    context.setActiveAssistantVersionMap(parsed.activeAssistantVersionMap ?? {});
    const targetChatId = getHydratedChatId(parsed, revivedMessages);
    if (targetChatId !== null) {
      context.setActiveChatId(targetChatId);
    }
  } catch (error) {
    console.warn("Failed to hydrate chat history", error);
  } finally {
    globalThis.setTimeout(() => {
      context.isHydratingRef.current = false;
    }, 0);
  }
},

 serializeChatMessages = (
  chatMessagesMap: Readonly<Record<string, readonly Message[]>>,
): StoredChatState["messages"] => {
  const serializableMessages: StoredChatState["messages"] = {};
  Object.entries(chatMessagesMap).forEach(([chatId, items]) => {
    serializableMessages[chatId] = items.map((item) => ({
      ...item,
      timestamp:
        item.timestamp instanceof Date
          ? item.timestamp.toISOString()
          : new Date(item.timestamp).toISOString(),
    }));
  });
  return serializableMessages;
},

 persistResearchChats = (context: Readonly<ResearchChatState>): void => {
  if (typeof window === "undefined" || context.isHydratingRef.current) {return;}
  try {
    const payload: StoredChatState = {
      activeAssistantVersionMap: context.activeAssistantVersionMap,
      activeChatId: context.activeChatId,
      chats: [...context.chats],
      messages: serializeChatMessages(context.chatMessagesMap),
      version: CHAT_STORAGE_VERSION,
    };
    globalThis.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Failed to persist chat history", error);
  }
},

 useResearchChatPersistence = (
  context: Readonly<ResearchChatState>,
): void => {
  useEffect(() => { hydrateResearchChats(context); }, []);
  useEffect(() => { persistResearchChats(context); }, [
    context.activeAssistantVersionMap,
    context.activeChatId,
    context.chatMessagesMap,
    context.chats,
  ]);
};

interface ResearchStreamActions {
  startResearch: (parameters: StartResearchParameters) => Promise<void>;
}

interface ResearchStartPlan {
  assistantGroupId: string;
  assistantId: string;
  historyPayload: ReturnType<typeof buildChatHistoryPayload>;
  promptQuery: string;
  semanticToolId: string;
  visibleHistoryMessages: Message[];
}

const prepareResearchStart = (
  parameters: Readonly<StartResearchParameters>,
  activeAssistantVersions: Readonly<Record<string, Record<string, string>>>,
): ResearchStartPlan => {
  const {
    chatId,
    prompt,
    seedMessages,
    retryGroupId,
    versionSelectionOverrides,
  } = parameters,
   versionSelections = {
    ...activeAssistantVersions[chatId],
    ...versionSelectionOverrides,
  },
   visibleHistoryMessages = getVisibleConversationMessages(
    seedMessages,
    versionSelections,
  ).filter(
    (message) =>
      !retryGroupId ||
      message.type !== "assistant" ||
      getMessageVersionGroupId(message) !== retryGroupId,
  ),
   timestamp = Date.now(),
   assistantId = `assistant-${timestamp}`;
  return {
    assistantGroupId: retryGroupId ?? assistantId,
    assistantId,
    historyPayload: buildChatHistoryPayload(visibleHistoryMessages),
    promptQuery: `${prompt}

Provide a concise answer with detailed well-written prose based on the sources you have searched cited them when needed.`,
    semanticToolId: `semantic-${timestamp}`,
    visibleHistoryMessages,
  };
},

 createStreamingPlaceholder = (
  parameters: Readonly<StartResearchParameters>,
  plan: Readonly<ResearchStartPlan>,
  chats: readonly ChatSummary[],
): Message => {
  const currentChatTitle =
    parameters.newChatTitle || chats.find((chat) => chat.id === parameters.chatId)?.title;
  return {
    content: currentChatTitle ? `Topic: ${currentChatTitle}` : "",
    id: plan.assistantId,
    isStreaming: true,
    parentMessageId: parameters.parentMessageId,
    retryOfMessageId: parameters.retryGroupId,
    streamingStatus: "Starting research...",
    timestamp: new Date(),
    type: "assistant",
  };
};

interface SemanticResearchContext extends SemanticSearchMessageContext {
  readonly assistantId: string;
  readonly chatId: string;
  readonly prompt: string;
}

const startSemanticResearch = async (
  context: Readonly<SemanticResearchContext>,
): Promise<void> => {
  try {
    const response = await semanticSearch(context.prompt, { limit: STREAM_REQUEST_LIMIT });
    addSemanticSearchMessage(response, context);
  } catch (error) {
    console.warn("Semantic search unavailable:", error);
  }
};

interface ResearchStreamRunContext {
  readonly abortControllerRef: React.RefObject<AbortController | undefined>;
  readonly inputRef: React.RefObject<HTMLTextAreaElement | null>;
  readonly setAbortController: (controller: AbortController | undefined) => void;
  readonly setActiveAssistantVersion: ResearchChatState["setActiveAssistantVersion"];
  readonly setIsSearching: ResearchChatState["setIsSearching"];
  readonly updateChatMessages: UpdateChatMessages;
}

const createResearchStreamState = (): ResearchStreamState => {
  let clearStallTimeout = (): void => {},
   structuredArticles: StructuredArticlesPayload | undefined;
  const thinkingSteps: ReadonlyThinkingStep[] = [];
  return {
    addThinkingStep: (step) => {
      thinkingSteps.push(step);
    },
    get clearStallTimeout() {
      return clearStallTimeout;
    },
    setClearStallTimeout: (clear) => {
      clearStallTimeout = clear;
    },
    setStructuredArticles: (articles) => {
      structuredArticles = articles;
    },
    get structuredArticles() {
      return structuredArticles;
    },
    get thinkingSteps() {
      return thinkingSteps;
    },
  };
},

 createResearchStreamContext = (
  parameters: Readonly<StartResearchParameters>,
  plan: Readonly<ResearchStartPlan>,
  runtime: Readonly<ResearchStreamRunContext>,
): ResearchStreamContext => ({
  assistantGroupId: plan.assistantGroupId,
  assistantId: plan.assistantId,
  chatId: parameters.chatId,
  clearAbortController: () => {
    runtime.setAbortController(undefined);
  },
  focusInput: () => {
    runtime.inputRef.current?.focus();
  },
  retryGroupId: parameters.retryGroupId,
  setActiveAssistantVersion: runtime.setActiveAssistantVersion,
  setIsSearching: runtime.setIsSearching,
  streamState: createResearchStreamState(),
  updateChatMessages: runtime.updateChatMessages,
}),

 installResearchStallTimeout = (
  streamContext: ResearchStreamContext,
): ReturnType<typeof globalThis.setTimeout> => {
  const stallTimeout = globalThis.setTimeout(() => {
    updateAssistantMessage(streamContext, (message) => ({
      ...message,
      streamingStatus: "Still working. Gathering more coverage.",
    }), { syncSummary: false });
  }, SEARCH_STREAM_STALL_TIMEOUT_MS);
  streamContext.streamState.setClearStallTimeout(() =>{  globalThis.clearTimeout(stallTimeout); });
  return stallTimeout;
},

 runResearchRequest = async (
  parameters: Readonly<StartResearchParameters>,
  plan: Readonly<ResearchStartPlan>,
  runtime: Readonly<ResearchStreamRunContext>,
  chats: readonly ChatSummary[],
): Promise<void> => {
  const { chatId, prompt } = parameters;
  runtime.setIsSearching(true);
  runtime.setActiveAssistantVersion(chatId, plan.assistantGroupId, plan.assistantId);
  const streamingPlaceholder = createStreamingPlaceholder(parameters, plan, chats);
  runtime.updateChatMessages(chatId, (messages) => [...messages, streamingPlaceholder], {
    syncSummary: false,
  });
  void startSemanticResearch({
    assistantId: plan.assistantId,
    chatId,
    prompt,
    retryGroupId: parameters.retryGroupId,
    semanticToolId: plan.semanticToolId,
    updateChatMessages: runtime.updateChatMessages,
  });
  const abortController = new AbortController();
  runtime.setAbortController(abortController);
  const streamContext = createResearchStreamContext(
    parameters,
    plan,
    runtime,
  ),
   stallTimeout = installResearchStallTimeout(streamContext),
   streamUrl = buildResearchStreamUrl(plan.promptQuery, plan.historyPayload);
  await runResearchStream(streamUrl, abortController, stallTimeout, streamContext);
},

 useResearchStreamActions = (
  context: Readonly<ResearchChatState>,
): ResearchStreamActions => {
  const {
    abortControllerRef,
    activeAssistantVersionMap,
    chats,
    inputRef,
    setActiveAssistantVersion,
    setIsSearching,
    updateChatMessages,
  } = context,
   setAbortController = useCallback((controller: AbortController | undefined) => {
    abortControllerRef.current = controller;
  }, [abortControllerRef]),
   runtime = useMemo<ResearchStreamRunContext>(() => ({
    abortControllerRef,
    inputRef,
    setAbortController,
    setActiveAssistantVersion,
    setIsSearching,
    updateChatMessages,
  }), [
    abortControllerRef,
    inputRef,
    setAbortController,
    setActiveAssistantVersion,
    setIsSearching,
    updateChatMessages,
  ]),
   startResearch = useCallback(
    async (parameters: StartResearchParameters) => {
      const plan = prepareResearchStart(parameters, activeAssistantVersionMap);
      await runResearchRequest(parameters, plan, runtime, chats);
    },
    [activeAssistantVersionMap, chats, runtime],
  );

  return { startResearch };
};

interface ResearchDerivedState {
  activeBriefTitle: string;
  groupedSources: SourceGroup[];
  isEmpty: boolean;
  latestAssistantMessage: Message | undefined;
  latestSemanticMessage: Message | undefined;
  latestUserMessage: Message | undefined;
  relatedArticles: NewsArticle[];
  thinkingSteps: NonNullable<Message["thinking_steps"]>;
  handleCloseArticle: () => void;
  handleOpenArticle: (article: NewsArticle) => void;
}

const groupArticlesBySource = (articles: readonly ReadonlyNewsArticle[]): SourceGroup[] => {
  const groups = new Map<string, SourceGroup>(),
   seenKeys = new Set<string>();

  articles.forEach((article) => {
    const urlKey = getArticleText(article.url, String(article.id));
    if (seenKeys.has(urlKey)) {return;}
    seenKeys.add(urlKey);

    const sourceId = getArticleText(
      article.sourceId,
      getArticleText(article.source, "unknown"),
    );
    let group = groups.get(sourceId);
    if (group === undefined) {
      group = {
        articles: [],
        sourceId,
        sourceName: getArticleText(article.source, ARTICLE_SOURCE_FALLBACK),
      };
      groups.set(sourceId, group);
    }
    group.articles.push(article);
  });

  return [...groups.values()].toSorted(
    (a, b) => b.articles.length - a.articles.length,
  );
},

 findLatestMessage = (
  messages: readonly Message[],
  predicate: (message: Readonly<Message>) => boolean,
): Message | undefined => [...messages].toReversed().find((message) => predicate(message));

interface LatestResearchMessages {
  latestAssistantMessage: Message | undefined;
  latestSemanticMessage: Message | undefined;
  latestUserMessage: Message | undefined;
}

const useLatestResearchMessages = (
  conversationMessages: readonly Message[],
  messages: readonly Message[],
): LatestResearchMessages => ({
  latestAssistantMessage: useMemo(
    () => findLatestMessage(
      conversationMessages,
      (message) => message.type === "assistant" && !message.toolType,
    ),
    [conversationMessages],
  ),
  latestSemanticMessage: useMemo(
    () => findLatestMessage(messages, (message) => message.toolType === "semantic_search"),
    [messages],
  ),
  latestUserMessage: useMemo(
    () => findLatestMessage(conversationMessages, (message) => message.type === "user"),
    [conversationMessages],
  ),
}),

 useResearchArticleModalActions = (
  context: Readonly<Pick<ResearchChatState, "setIsArticleModalOpen" | "setSelectedArticle">>,
): Pick<ResearchDerivedState, "handleCloseArticle" | "handleOpenArticle"> => {
  const { setIsArticleModalOpen, setSelectedArticle } = context,
   handleOpenArticle = useCallback((article: NewsArticle) => {
    setSelectedArticle(article);
    setIsArticleModalOpen(true);
  }, [setIsArticleModalOpen, setSelectedArticle]),
   handleCloseArticle = useCallback(() => {
    setIsArticleModalOpen(false);
    setSelectedArticle(null);
  }, [setIsArticleModalOpen, setSelectedArticle]);
  return { handleCloseArticle, handleOpenArticle };
},

 useResearchScrollToLatest = (
  context: Readonly<Pick<ResearchChatState, "chatScrollRef" | "conversationMessages">>,
  latestAssistantMessage: Message | undefined,
): void => {
  const { chatScrollRef, conversationMessages } = context;
  useEffect(() => {
    if (!chatScrollRef.current) {
      return;
    }
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatScrollRef, conversationMessages.length, latestAssistantMessage?.isStreaming]);
};

interface ResearchArticleDerivedState {
  relatedArticles: NewsArticle[];
  groupedSources: SourceGroup[];
  thinkingSteps: NonNullable<Message["thinking_steps"]>;
}

const useResearchArticleDerivedState = (
  latestAssistantMessage: Message | undefined,
): ResearchArticleDerivedState => {
  const relatedArticles = useMemo(
    () => buildArticleEmbeds(latestAssistantMessage),
    [latestAssistantMessage],
  ),
   groupedSources = useMemo(
    () => groupArticlesBySource(relatedArticles),
    [relatedArticles],
  );
  return {
    groupedSources,
    relatedArticles,
    thinkingSteps: latestAssistantMessage?.thinking_steps ?? [],
  };
},

 getActiveBriefTitle = (
  latestUserMessage: Message | undefined,
  chats: readonly ChatSummary[],
  activeChatId: string | null,
): string => latestUserMessage?.content || chats.find((chat) => chat.id === activeChatId)?.title || "Research thread",

 useResearchDerivedState = (
  context: Readonly<ResearchChatState>,
): ResearchDerivedState => {
  const {
    activeChatId,
    chats,
    conversationMessages,
    messages,
    setIsArticleModalOpen,
    setSelectedArticle,
  } = context,
   isEmpty = messages.length === 0,
   { latestAssistantMessage, latestSemanticMessage, latestUserMessage } =
    useLatestResearchMessages(conversationMessages, messages),
   { groupedSources, relatedArticles, thinkingSteps } =
    useResearchArticleDerivedState(latestAssistantMessage),
   activeBriefTitle = getActiveBriefTitle(
    latestUserMessage,
    chats,
    activeChatId,
  );

  useResearchScrollToLatest(context, latestAssistantMessage);
  const { handleCloseArticle, handleOpenArticle } = useResearchArticleModalActions({
    setIsArticleModalOpen,
    setSelectedArticle,
  });

  return {
    activeBriefTitle,
    groupedSources,
    handleCloseArticle,
    handleOpenArticle,
    isEmpty,
    latestAssistantMessage,
    latestSemanticMessage,
    latestUserMessage,
    relatedArticles,
    thinkingSteps,
  };
};

interface ResearchMessageActionsContext {
  state: ResearchChatState;
  startResearch: ResearchStreamActions["startResearch"];
  submitPrompt: (parameters: SubmitPromptParameters) => Promise<void>;
}

interface ResearchMessageActions {
  handleCancelEditMessage: () => void;
  handleCopyMessage: (content: string) => Promise<void>;
  handleDeleteMessage: (messageId: string) => void;
  handleEditMessage: (messageId: string) => void;
  handleResetMessage: (assistantMessageId: string) => Promise<void>;
  handleSampleQuery: (sampleQuery: string) => void;
  handleSaveEditedMessage: () => Promise<void>;
  handleSearch: (event: React.FormEvent) => Promise<void>;
  handleSelectMessageVersion: (groupId: string, messageId: string) => void;
}

const useResearchMessageSearchActions = (
  context: Readonly<ResearchMessageActionsContext>,
): Pick<ResearchMessageActions, "handleSampleQuery" | "handleSearch"> => {
  const { state, submitPrompt } = context,
   { clearMessageEditing, inputRef, query, setQuery } = state,
   handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    await submitPrompt({ clearComposer: true, prompt: query });
  },
   handleSampleQuery = (sampleQuery: string) => {
    clearMessageEditing();
    setQuery(sampleQuery);
    inputRef.current?.focus();
  };
  return { handleSampleQuery, handleSearch };
},

 useResearchMessageRevisionActions = (
  context: Readonly<ResearchMessageActionsContext>,
): Pick<ResearchMessageActions, "handleResetMessage" | "handleSelectMessageVersion"> => {
  const { state, startResearch } = context,
   {
    activeChatId,
    conversationMessages,
    isSearching,
    messages,
    setActiveAssistantVersion,
  } = state,
   handleResetMessage = async (assistantMessageId: string) => {
    if (isSearching || activeChatId === null) {return;}
    const visibleAssistantIndex = conversationMessages.findIndex(
      (message) => message.id === assistantMessageId,
    );
    if (visibleAssistantIndex <= 0) {return;}
    const targetAssistant = messages.find((message) => message.id === assistantMessageId);
    if (targetAssistant?.type !== "assistant") {return;}
    const retryUserMessage = conversationMessages.slice(0, visibleAssistantIndex)
      .reverse()
      .find((message) => message.type === "user");
    if (retryUserMessage === undefined || retryUserMessage.content.trim().length === 0) {
      return;
    }
    await startResearch({
      chatId: activeChatId,
      parentMessageId: retryUserMessage.id,
      prompt: retryUserMessage.content,
      retryGroupId: getMessageVersionGroupId(targetAssistant),
      seedMessages: messages,
    });
  },
   handleSelectMessageVersion = (groupId: string, messageId: string) => {
    if (activeChatId === null) {return;}
    setActiveAssistantVersion(activeChatId, groupId, messageId);
  };
  return { handleResetMessage, handleSelectMessageVersion };
},

 useResearchMessageMutationActions = (
  context: Readonly<ResearchMessageActionsContext>,
): Pick<ResearchMessageActions, "handleCancelEditMessage" | "handleDeleteMessage" | "handleEditMessage" | "handleSaveEditedMessage"> => {
  const { state, submitPrompt } = context,
   {
    activeChatId,
    clearMessageEditing,
    editingDraft,
    editingMessageId,
    isSearching,
    messages,
    setEditingDraft,
    setEditingMessageId,
    updateChatMessages,
  } = state,
   handleDeleteMessage = (messageId: string) => {
    if (isSearching || activeChatId === null) {return;}
    if (editingMessageId === messageId) {
      clearMessageEditing();
    }
    updateChatMessages(activeChatId, (previous) =>
      previous.filter((message) => message.id !== messageId),
    );
  },
   handleEditMessage = (messageId: string) => {
    if (isSearching) {return;}
    const target = messages.find((message) => message.id === messageId);
    if (target === undefined || target.type !== "user") {return;}
    setEditingMessageId(messageId);
    setEditingDraft(target.content);
  },
   handleCancelEditMessage = () => {
    clearMessageEditing();
  },
   handleSaveEditedMessage = async () => {
    if (editingMessageId === null || editingMessageId.length === 0) {return;}
    await submitPrompt({ editingTargetId: editingMessageId, prompt: editingDraft });
  };
  return {
    handleCancelEditMessage,
    handleDeleteMessage,
    handleEditMessage,
    handleSaveEditedMessage,
  };
},

 useResearchMessageClipboardActions = (): Pick<ResearchMessageActions, "handleCopyMessage"> => {
  const handleCopyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (error) {
      console.error("Failed to copy message:", error);
    }
  };
  return { handleCopyMessage };
},

 useResearchMessageActions = (
  context: Readonly<ResearchMessageActionsContext>,
): ResearchMessageActions => ({
  ...useResearchMessageClipboardActions(),
  ...useResearchMessageMutationActions(context),
  ...useResearchMessageRevisionActions(context),
  ...useResearchMessageSearchActions(context),
});

interface ResearchPromptSubmissionContext {
  state: ResearchChatState;
  startResearch: ResearchStreamActions["startResearch"];
}

const useResearchPromptSubmission = (
  context: Readonly<ResearchPromptSubmissionContext>,
): ((parameters: SubmitPromptParameters) => Promise<void>) => {
  const {
    state,
    startResearch,
  } = context,
   {
    activeChatId,
    clearMessageEditing,
    conversationMessages,
    messages,
    setActiveAssistantVersion,
    setActiveAssistantVersionMap,
    setActiveChatId,
    setChatMessagesMap,
    setChats,
    setQuery,
    updateChatMessages,
  } = state;

  return useCallback(
    (parameters: SubmitPromptParameters) =>
      submitResearchPrompt(parameters, {
        activeChatId,
        clearMessageEditing,
        conversationMessages,
        messages,
        setActiveAssistantVersion,
        setActiveAssistantVersionMap,
        setActiveChatId,
        setChatMessagesMap,
        setChats,
        setQuery,
        startResearch,
        updateChatMessages,
      }),
    [
      activeChatId,
      clearMessageEditing,
      conversationMessages,
      messages,
      setActiveAssistantVersion,
      startResearch,
      updateChatMessages,
    ],
  );
};

interface ResearchHandoffContext {
  state: ResearchChatState;
  handoffQuery: string;
  replace: (href: string) => void;
  submitPrompt: (parameters: SubmitPromptParameters) => Promise<void>;
}

interface SearchPageRouter {
  replace: (href: string) => void;
}

export interface NewsResearchPageServices {
  useRouter: () => SearchPageRouter;
  useSearchParams: () => Pick<URLSearchParams, "get">;
}

const DEFAULT_NEWS_RESEARCH_PAGE_SERVICES: NewsResearchPageServices = {
  useRouter,
  useSearchParams,
},

 useResearchHandoff = (
  context: Readonly<ResearchHandoffContext>,
): void => {
  const {
    state,
    handoffQuery,
    replace,
    submitPrompt,
  } = context,
   {
    consumedHandoffQueryRef,
    isHydratingRef,
    isSearching,
    setQuery,
  } = state;

  useEffect(() => {
    if (isHydratingRef.current || isSearching) {return;}
    if (!handoffQuery) {return;}
    if (consumedHandoffQueryRef.current === handoffQuery) {return;}

    consumedHandoffQueryRef.current = handoffQuery;
    setQuery(handoffQuery);
    void submitPrompt({
      clearComposer: true,
      forceNewChat: true,
      prompt: handoffQuery,
    });
    replace("/search");
  }, [handoffQuery, isHydratingRef, isSearching, replace, setQuery, submitPrompt]);
};

interface ResearchPageAssemblyContext {
  actions: ResearchChatActions;
  chatState: ResearchChatState;
  derivedState: ResearchDerivedState;
  messageActions: ResearchMessageActions;
}

const createResearchPageViewProps = ({
  actions,
  chatState,
  derivedState,
  messageActions,
}: Readonly<ResearchPageAssemblyContext>): ResearchPageViewProps => ({
  activeAssistantVersions: chatState.activeAssistantVersions,
  activeBriefTitle: derivedState.activeBriefTitle,
  activeChatId: chatState.activeChatId,
  chatMessages: [...chatState.messages],
  chatScrollRef: chatState.chatScrollRef,
  chats: [...chatState.chats],
  composerFormRef: chatState.composerFormRef,
  conversationMessages: [...chatState.conversationMessages],
  editingDraft: chatState.editingDraft,
  editingMessageId: chatState.editingMessageId,
  expandedSourceIds: new Set(chatState.expandedSourceIds),
  expandedStepMessageIds: new Set(chatState.expandedStepMessageIds),
  groupedSources: derivedState.groupedSources,
  inputRef: chatState.inputRef,
  isArticleModalOpen: chatState.isArticleModalOpen,
  isEmpty: derivedState.isEmpty,
  isSearching: chatState.isSearching,
  latestAssistantMessage: derivedState.latestAssistantMessage,
  latestSemanticMessage: derivedState.latestSemanticMessage,
  latestUserMessage: derivedState.latestUserMessage,
  onCancelEdit: messageActions.handleCancelEditMessage,
  onCloseArticle: derivedState.handleCloseArticle,
  onCopy: (content) => { void messageActions.handleCopyMessage(content); },
  onDeleteChat: actions.handleDeleteChat,
  onDeleteChats: actions.handleDeleteChats,
  onDeleteMessage: messageActions.handleDeleteMessage,
  onEdit: messageActions.handleEditMessage,
  onNewChat: actions.handleNewChat,
  onOpenArticle: derivedState.handleOpenArticle,
  onRename: actions.handleRenameChat,
  onReset: (messageId) => { void messageActions.handleResetMessage(messageId); },
  onSampleQuery: messageActions.handleSampleQuery,
  onSaveEdit: () => { void messageActions.handleSaveEditedMessage(); },
  onSearch: (event) => { void messageActions.handleSearch(event); },
  onSelectChat: actions.handleSelectChat,
  onSelectVersion: messageActions.handleSelectMessageVersion,
  onStop: actions.handleStop,
  onToggleSidebar: actions.toggleSidebar,
  onToggleSource: actions.toggleSourceVisibility,
  onToggleSteps: actions.toggleStepVisibility,
  query: chatState.query,
  selectedArticle: chatState.selectedArticle,
  setEditingDraft: chatState.setEditingDraft,
  setQuery: chatState.setQuery,
  sidebarCollapsed: chatState.sidebarCollapsed,
  thinkingSteps: [...derivedState.thinkingSteps],
});

function useResearchPageController(
  services: NewsResearchPageServices,
): ResearchPageViewProps {
  const { replace } = services.useRouter(),
   searchParams = services.useSearchParams(),
   chatState = useResearchChatState(),
   handoffQuery = searchParams.get("query")?.trim() ?? "",

   actions = useResearchChatActions(chatState);

  useResearchChatPersistence(chatState);

  const derivedState = useResearchDerivedState(chatState),

   { startResearch } = useResearchStreamActions(chatState),

   submitPrompt = useResearchPromptSubmission({
    startResearch,
    state: chatState,
  });

  useResearchHandoff({
    handoffQuery,
    replace,
    state: chatState,
    submitPrompt,
  });

  const messageActions = useResearchMessageActions({
    startResearch,
    state: chatState,
    submitPrompt,
  });
  return createResearchPageViewProps({
    actions,
    chatState,
    derivedState,
    messageActions,
  });
}

const NewsResearchPageContent = ({ services }: { services: NewsResearchPageServices }) => {
  const controller = useResearchPageController(services);
  return <ResearchPageView controller={controller} />;
},

 NewsResearchPage = ({
  services = DEFAULT_NEWS_RESEARCH_PAGE_SERVICES,
}: { services?: NewsResearchPageServices } = {}) =>
  (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <NewsResearchPageContent services={services} />
    </Suspense>
  )
;

export default NewsResearchPage;
