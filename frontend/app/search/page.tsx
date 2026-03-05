"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Loader2,
  Home,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Cpu,
  Filter,
  Clock,
  Square,
} from "lucide-react";
import {
  API_BASE_URL,
  ThinkingStep,
  type NewsArticle,
  semanticSearch,
  type SemanticSearchResult,
  type SearchSuggestion,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ArticleDetailModal } from "@/components/article-detail-modal";
import ChatSidebar, { ChatSummary } from "@/components/chat-sidebar";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { SearchSuggestions } from "@/components/search-suggestions";
import { VerificationPanel } from "@/components/verification-panel";

interface ReferencedArticlePayload {
  title?: string;
  source?: string;
  description?: string;
  image?: string;
  published?: string;
  category?: string;
  link?: string;
  tags?: string[];
  [key: string]: unknown;
}

interface StructuredArticleSummary {
  title?: string;
  summary?: string;
  url?: string;
  source?: string;
  image?: string;
  published?: string;
  author?: string;
  category?: string;
  description?: string;
  link?: string;
  [key: string]: unknown;
}

interface StructuredArticlesPayload {
  articles?: StructuredArticleSummary[];
  clusters?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface ResearchResult {
  success: boolean;
  query: string;
  answer: string;
  thinking_steps: ThinkingStep[];
  articles_searched: number;
  referenced_articles?: ReferencedArticlePayload[];
  structured_articles?: StructuredArticlesPayload;
  error?: string;
}

interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  thinking_steps?: ThinkingStep[];
  articles_searched?: number;
  referenced_articles?: NewsArticle[];
  structured_articles_json?: StructuredArticlesPayload; // New: Parsed JSON articles for grid display
  timestamp: Date;
  error?: boolean;
  isStreaming?: boolean;
  streamingStatus?: string;
  toolType?: "semantic_search";
  semanticResults?: SemanticSearchResult[];
}

type StatusMessage = { type: "status"; message: string };
type ThinkingStepMessage = { type: "thinking_step"; step: ThinkingStep };
type ArticlesJsonMessage = { type: "articles_json"; data: string };
type ReferencedArticlesMessage = {
  type: "referenced_articles";
  articles?: ReferencedArticlePayload[];
};
type CompleteMessage = { type: "complete"; result: ResearchResult };
type ErrorMessage = { type: "error"; message?: string };
type UnknownMessage = { type: string; [key: string]: unknown };

type ResearchStreamMessage =
  | StatusMessage
  | ThinkingStepMessage
  | ArticlesJsonMessage
  | ReferencedArticlesMessage
  | CompleteMessage
  | ErrorMessage
  | UnknownMessage;

const isStatusMessage = (
  message: ResearchStreamMessage,
): message is StatusMessage => message.type === "status";
const isThinkingStepMessage = (
  message: ResearchStreamMessage,
): message is ThinkingStepMessage => message.type === "thinking_step";
const isArticlesJsonMessage = (
  message: ResearchStreamMessage,
): message is ArticlesJsonMessage => message.type === "articles_json";
const isReferencedArticlesMessage = (
  message: ResearchStreamMessage,
): message is ReferencedArticlesMessage =>
  message.type === "referenced_articles";
const isCompleteMessage = (
  message: ResearchStreamMessage,
): message is CompleteMessage => message.type === "complete";
const isErrorMessage = (
  message: ResearchStreamMessage,
): message is ErrorMessage => message.type === "error";

const CHAT_STORAGE_KEY = "news-research.chat-state";
const CHAT_STORAGE_VERSION = 1;

interface StoredChatState {
  version: number;
  activeChatId?: string | null;
  chats: ChatSummary[];
  messages: Record<
    string,
    (Omit<Message, "timestamp"> & { timestamp: string })[]
  >;
}

export default function NewsResearchPage() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(
    null,
  );
  const [isArticleModalOpen, setIsArticleModalOpen] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatMessagesMap, setChatMessagesMap] = useState<
    Record<string, Message[]>
  >({});
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [expandedStepMessageIds, setExpandedStepMessageIds] = useState<
    Set<string>
  >(new Set());
  const [expandedSourceIds, setExpandedSourceIds] = useState<Set<string>>(
    new Set(),
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const isHydratingRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleNewChat = () => {
    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newChat: ChatSummary = {
      id,
      title: "Untitled research",
      lastMessage: "",
      updatedAt: new Date().toISOString(),
    };
    // Abort any running stream when switching to a fresh chat
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setChats((prev) => [newChat, ...prev]);
    setChatMessagesMap((prev) => ({ ...prev, [id]: [] }));
    setActiveChatId(id);
    setMessages([]);
    setIsSearching(false);
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSearching(false);
    // Mark the current streaming message as stopped
    setMessages((prev) =>
      prev.map((msg) =>
        msg.isStreaming
          ? {
              ...msg,
              isStreaming: false,
              streamingStatus: undefined,
              content: msg.content || "[Stopped]",
            }
          : msg,
      ),
    );
  };

  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);

  const handleSelectChat = (id: string) => {
    setActiveChatId(id);
    setMessages(chatMessagesMap[id] || []);
  };

  const handleRenameChat = (id: string, title: string) => {
    setChats((prev) =>
      prev.map((chat) => (chat.id === id ? { ...chat, title } : chat)),
    );
  };

  const handleDeleteChat = (id: string) => {
    const remainingChats = chats.filter((chat) => chat.id !== id);
    const nextChatId =
      activeChatId === id ? (remainingChats[0]?.id ?? null) : activeChatId;
    const { [id]: _removed, ...restMessages } = chatMessagesMap;

    setChats(remainingChats);
    setChatMessagesMap(restMessages);

    if (activeChatId === id) {
      setActiveChatId(nextChatId || null);
      setMessages(nextChatId ? restMessages[nextChatId] || [] : []);
    }
  };

  const handleDeleteChats = (ids: string[]) => {
    const remainingChats = chats.filter((chat) => !ids.includes(chat.id));

    // If active chat is deleted, switch to the first available remaining chat
    let nextChatId = activeChatId;
    if (activeChatId && ids.includes(activeChatId)) {
      nextChatId = remainingChats[0]?.id ?? null;
    }

    // Remove messages for deleted chats
    const newChatMessagesMap = { ...chatMessagesMap };
    ids.forEach((id) => {
      delete newChatMessagesMap[id];
    });

    setChats(remainingChats);
    setChatMessagesMap(newChatMessagesMap);

    if (
      activeChatId !== nextChatId ||
      (activeChatId && ids.includes(activeChatId))
    ) {
      setActiveChatId(nextChatId || null);
      setMessages(nextChatId ? newChatMessagesMap[nextChatId] || [] : []);
    }
  };

  const toggleStepVisibility = (messageId: string) => {
    setExpandedStepMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const toggleSourceVisibility = (sourceId: string) => {
    setExpandedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  // Hydrate chats from localStorage on first load
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = window.localStorage.getItem(CHAT_STORAGE_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as StoredChatState;
      if (!parsed || typeof parsed !== "object") {
        return;
      }

      if (parsed.version !== CHAT_STORAGE_VERSION) {
        // Future migration logic can go here; for now, ignore incompatible versions
        return;
      }

      const revivedMessages: Record<string, Message[]> = {};
      Object.entries(parsed.messages || {}).forEach(([chatId, items]) => {
        revivedMessages[chatId] = items.map((item) => ({
          ...item,
          timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
          isStreaming: false,
        }));
      });

      setChats(parsed.chats || []);
      setChatMessagesMap(revivedMessages);

      const targetChatId =
        parsed.activeChatId && revivedMessages[parsed.activeChatId]
          ? parsed.activeChatId
          : parsed.chats && parsed.chats.length > 0
            ? parsed.chats[0].id
            : null;

      if (targetChatId) {
        setActiveChatId(targetChatId);
        setMessages(revivedMessages[targetChatId] || []);
      }
    } catch (error) {
      console.warn("Failed to hydrate chat history", error);
    } finally {
      // Allow dependent effects to run on the next tick to avoid treating hydration updates as user edits
      window.setTimeout(() => {
        isHydratingRef.current = false;
      }, 0);
    }
  }, []);

  // Persist current messages into the active chat and update chat summary
  useEffect(() => {
    if (!activeChatId || isHydratingRef.current) return;
    setChatMessagesMap((prev) => ({ ...prev, [activeChatId]: messages }));
    setChats((prev) =>
      prev.map((c) =>
        c.id === activeChatId
          ? {
              ...c,
              lastMessage: messages.length
                ? messages[messages.length - 1].content.slice(0, 200)
                : "",
              updatedAt: new Date().toISOString(),
            }
          : c,
      ),
    );
  }, [messages, activeChatId]);

  // Persist chats & messages to localStorage whenever they change (post-hydration)
  useEffect(() => {
    if (typeof window === "undefined" || isHydratingRef.current) return;

    try {
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

      const payload: StoredChatState = {
        version: CHAT_STORAGE_VERSION,
        activeChatId,
        chats,
        messages: serializableMessages,
      };

      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn("Failed to persist chat history", error);
    }
  }, [chats, chatMessagesMap, activeChatId]);

  const buildChatHistoryPayload = (items: Message[]) =>
    items
      .filter(
        (message) =>
          (message.type === "user" || message.type === "assistant") &&
          !message.toolType &&
          !message.isStreaming,
      )
      .map((message) => ({
        type: message.type,
        content: message.content,
      }))
      .filter((entry) => entry.content && entry.content.trim().length > 0);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    const historyPayload = buildChatHistoryPayload(messages);
    const promptQuery = `${trimmedQuery}\n\nProvide a concise answer with detailed well-written prose based on the sources you have searched cited them when needed.`;

    // If there's no active chat, create one automatically and name it from the prompt.
    let newChatTitle: string | undefined = undefined;
    if (!activeChatId) {
      // Prefer first sentence; fallback to first 4 words
      const firstSentence = (trimmedQuery.split(/[\.\n]/)[0] || "").trim();
      const firstFour = trimmedQuery.split(/\s+/).slice(0, 4).join(" ");
      const titleBase = firstSentence || firstFour || "New Chat";
      const title = titleBase.slice(0, 60);
      const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newChat = {
        id,
        title,
        lastMessage: trimmedQuery.slice(0, 120),
        updatedAt: new Date().toISOString(),
      };
      // add the chat; seed an empty array — messages state (below) will be persisted into the chat via useEffect
      setChats((prev) => [newChat, ...prev]);
      setChatMessagesMap((prev) => ({ ...prev, [id]: [] }));
      setActiveChatId(id);
      newChatTitle = title;
    }

    const timestamp = Date.now();
    const assistantId = `assistant-${timestamp}`;
    const semanticToolId = `semantic-${timestamp}`;

    const userMessage: Message = {
      id: `user-${timestamp}`,
      type: "user",
      content: trimmedQuery,
      timestamp: new Date(),
    };

    const thinkingSteps: ThinkingStep[] = [];
    let structuredArticles: StructuredArticlesPayload | undefined;
    let finalResult: ResearchResult | undefined;

    setMessages((prev) => [...prev, userMessage]);
    setQuery("");
    setIsSearching(true);

    // Include chat title in the initial assistant placeholder to give context (saves tokens vs re-requesting)
    const currentChatTitle =
      newChatTitle ||
      chats.find((c) => c.id === activeChatId)?.title ||
      undefined;
    const streamingPlaceholder: Message = {
      id: assistantId,
      type: "assistant",
      content: currentChatTitle ? `Topic: ${currentChatTitle}` : "",
      timestamp: new Date(),
      isStreaming: true,
      streamingStatus: "Starting research...",
    };

    setMessages((prev) => [...prev, streamingPlaceholder]);

    semanticSearch(trimmedQuery, { limit: 3 })
      .then((response) => {
        const relevant = response.results
          .filter((result: SemanticSearchResult) => {
            const { article, similarityScore } = result;
            if (!article?.summary) return false;
            if (typeof similarityScore === "number") {
              return similarityScore >= 0.55;
            }
            return true;
          })
          .slice(0, 5);

        if (relevant.length === 0) {
          return;
        }

        const toolMessage: Message = {
          id: semanticToolId,
          type: "assistant",
          content: "Semantic search surfaced related coverage.",
          timestamp: new Date(),
          toolType: "semantic_search",
          semanticResults: relevant,
        };

        setMessages((prev) => {
          const withoutExisting = prev.filter(
            (msg) => msg.id !== semanticToolId,
          );
          const insertAt = withoutExisting.findIndex(
            (msg) => msg.id === assistantId,
          );

          if (insertAt === -1) {
            return [...withoutExisting, toolMessage];
          }

          const next = [...withoutExisting];
          next.splice(insertAt, 0, toolMessage);
          return next;
        });
      })
      .catch((error) => {
        console.warn("Semantic search unavailable:", error);
      });

    try {
      const streamUrl = new URL(`${API_BASE_URL}/api/news/research/stream`);
      streamUrl.searchParams.set("query", promptQuery);
      streamUrl.searchParams.set("include_thinking", "true");
      if (historyPayload.length > 0) {
        streamUrl.searchParams.set("history", JSON.stringify(historyPayload));
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const stallTimeout = window.setTimeout(() => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  streamingStatus: "Still working — gathering more coverage...",
                }
              : msg,
          ),
        );
      }, 30000);

      const processEvent = (line: string) => {
        if (!line.startsWith("data: ")) return;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") return;
        try {
          const data = JSON.parse(raw) as ResearchStreamMessage;

          if (isStatusMessage(data)) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id !== assistantId
                  ? msg
                  : { ...msg, streamingStatus: data.message },
              ),
            );
          } else if (isThinkingStepMessage(data)) {
            thinkingSteps.push(data.step);
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id !== assistantId
                  ? msg
                  : {
                      ...msg,
                      thinking_steps: [...thinkingSteps],
                      streamingStatus: `Processing: ${data.step.type}...`,
                    },
              ),
            );
          } else if (isArticlesJsonMessage(data)) {
            try {
              let parsed: StructuredArticlesPayload | null = null;
              try {
                parsed = JSON.parse(data.data) as StructuredArticlesPayload;
              } catch {
                const jsonMatch = data.data.match(
                  /```json:articles\n([\s\S]*?)\n```/,
                );
                if (jsonMatch)
                  parsed = JSON.parse(
                    jsonMatch[1],
                  ) as StructuredArticlesPayload;
              }
              if (parsed) {
                structuredArticles = parsed;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id !== assistantId
                      ? msg
                      : {
                          ...msg,
                          structured_articles_json: structuredArticles,
                          streamingStatus: "Received article data...",
                        },
                  ),
                );
              }
            } catch (jsonError) {
              console.error("Failed to parse structured articles:", jsonError);
            }
          } else if (isReferencedArticlesMessage(data)) {
            const referencedArticlesPayload: ReferencedArticlePayload[] =
              Array.isArray(data.articles) ? data.articles : [];
            const referencedArticles: NewsArticle[] =
              referencedArticlesPayload.map((article) => {
                const tags = [article.category, article.source].filter(
                  (value): value is string => Boolean(value),
                );
                return {
                  id: Date.now() + Math.random(),
                  title: article.title || "No title",
                  source: article.source || "Unknown",
                  sourceId: (article.source || "unknown")
                    .toLowerCase()
                    .replace(/\s+/g, "-"),
                  country: "United States",
                  credibility: "medium" as const,
                  bias: "center" as const,
                  summary: article.description || "No description",
                  content: article.description || "No description",
                  image: article.image || "/placeholder.svg",
                  publishedAt: article.published || new Date().toISOString(),
                  category: article.category || "general",
                  url: article.link || "",
                  tags,
                  originalLanguage: "en",
                  translated: false,
                };
              });
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id !== assistantId
                  ? msg
                  : {
                      ...msg,
                      referenced_articles: referencedArticles,
                      streamingStatus: "Processing articles...",
                    },
              ),
            );
          } else if (isCompleteMessage(data)) {
            window.clearTimeout(stallTimeout);
            finalResult = data.result;
            const referencedArticles: NewsArticle[] = (
              finalResult.referenced_articles ?? []
            ).map((article) => {
              const tags = [article.category, article.source].filter(
                (value): value is string => Boolean(value),
              );
              return {
                id: Date.now() + Math.random(),
                title: article.title || "No title",
                source: article.source || "Unknown",
                sourceId: (article.source || "unknown")
                  .toLowerCase()
                  .replace(/\s+/g, "-"),
                country: "United States",
                credibility: "medium" as const,
                bias: "center" as const,
                summary: article.description || "No description",
                content: article.description || "No description",
                image: article.image || "/placeholder.svg",
                publishedAt: article.published || new Date().toISOString(),
                category: article.category || "general",
                url: article.link || "",
                tags,
                originalLanguage: "en",
                translated: false,
              };
            });
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id !== assistantId
                  ? msg
                  : {
                      ...msg,
                      content: finalResult?.answer || "No answer returned.",
                      thinking_steps: [...thinkingSteps],
                      articles_searched: finalResult?.articles_searched,
                      referenced_articles: referencedArticles,
                      structured_articles_json:
                        structuredArticles ?? msg.structured_articles_json,
                      isStreaming: false,
                      streamingStatus: undefined,
                      error: !finalResult?.success,
                    },
              ),
            );
            setIsSearching(false);
            abortControllerRef.current = null;
            inputRef.current?.focus();
          } else if (isErrorMessage(data)) {
            window.clearTimeout(stallTimeout);
            let errorMessage =
              data.message || "The research agent encountered an error.";
            const lowered = errorMessage.toLowerCase();
            if (
              lowered.includes("rate limit") ||
              lowered.includes("quota") ||
              lowered.includes("429")
            ) {
              errorMessage =
                "API Rate Limit: The AI service has reached its rate limit. Please wait a moment and try again.";
            }
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id !== assistantId
                  ? msg
                  : {
                      ...msg,
                      content: errorMessage,
                      error: true,
                      isStreaming: false,
                      streamingStatus: undefined,
                    },
              ),
            );
            setIsSearching(false);
            abortControllerRef.current = null;
          }
        } catch (parseError) {
          console.error("Failed to parse research stream message:", parseError);
        }
      };

      const response = await fetch(streamUrl.toString(), {
        signal: abortController.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Stream request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            processEvent(line);
          }
        }
        // Process any remaining buffered data
        if (buffer) processEvent(buffer);
      } finally {
        reader.releaseLock();
        window.clearTimeout(stallTimeout);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        // User stopped the request — message already updated by handleStop
        return;
      }
      console.error("Failed to start research stream:", error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                content:
                  error instanceof Error
                    ? error.message
                    : "An error occurred while starting the research stream.",
                error: true,
                isStreaming: false,
                streamingStatus: undefined,
              }
            : msg,
        ),
      );
      setIsSearching(false);
    }
  };

  const handleResetMessage = (assistantMessageId: string) => {
    if (isSearching) return;

    const assistantIndex = messages.findIndex(
      (message) => message.id === assistantMessageId,
    );
    if (assistantIndex <= 0) return;

    const contextMessages = messages.slice(0, assistantIndex);
    const retryUserMessage = [...contextMessages]
      .reverse()
      .find((message) => message.type === "user");
    if (!retryUserMessage || !retryUserMessage.content.trim()) return;

    setMessages(contextMessages);
    setQuery(retryUserMessage.content);

    window.setTimeout(() => {
      composerFormRef.current?.requestSubmit();
    }, 0);
  };

  const sampleQueries = [
    "What are the different perspectives on climate change?",
    "Compare how different sources cover technology news",
    "Summarize the latest political developments",
    "Which sources have covered AI recently?",
    "Analyze bias in coverage of international conflicts",
  ];

  const handleSampleQuery = (sampleQuery: string) => {
    setQuery(sampleQuery);
    inputRef.current?.focus();
  };

  const extractUrls = (text: string): string[] => {
    // Enhanced regex to capture URLs including those in parentheses and markdown links
    const urlRegex = /https?:\/\/[^\s\)]+/gi;
    const matches = text.match(urlRegex) || [];
    // de-duplicate and clean up
    return Array.from(new Set(matches.map((url) => url.replace(/[,\.]$/, ""))));
  };

  const formatShortDate = (date: string) => {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return date;
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const renderContentWithEmbeds = (
    content: string,
    articles: NewsArticle[],
  ) => {
    // Remove parentheses around standalone URLs (not markdown links)
    // Match patterns like " (https://...)" or "(https://...)" but not "[text](url)"
    const cleanedContent = content.replace(
      /(?<!\])\(https?:\/\/[^\)]+\)/gi,
      (match) => {
        return match.slice(1, -1); // Remove the surrounding parentheses
      },
    );

    if (!articles || articles.length === 0) {
      // No articles, just render text
      return (
        <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              strong: ({ node, ...props }) => (
                <span className="font-semibold text-foreground" {...props} />
              ),
              a: ({ node, href, children, ...props }) => {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline decoration-primary/30 underline-offset-2"
                    {...props}
                  >
                    {children}
                  </a>
                );
              },
              h1: ({ node, ...props }) => (
                <h1
                  className="text-xl font-semibold text-foreground mt-6 mb-3"
                  {...props}
                />
              ),
              h2: ({ node, ...props }) => (
                <h2
                  className="text-lg font-semibold text-foreground mt-5 mb-2"
                  {...props}
                />
              ),
              h3: ({ node, ...props }) => (
                <h3
                  className="text-base font-medium text-foreground mt-4 mb-2"
                  {...props}
                />
              ),
              ul: ({ node, ...props }) => (
                <ul className="my-3 space-y-1" {...props} />
              ),
              li: ({ node, ...props }) => (
                <li className="text-foreground/80" {...props} />
              ),
              p: ({ node, ...props }) => (
                <p className="text-foreground/80 leading-7 mb-4" {...props} />
              ),
            }}
          >
            {cleanedContent}
          </ReactMarkdown>
        </div>
      );
    }

    // Create a URL to article mapping for quick lookup
    const urlToArticleMap = new Map<string, NewsArticle>();
    articles.forEach((article) => {
      if (article.url) {
        urlToArticleMap.set(article.url, article);
        // Also add without trailing slash
        urlToArticleMap.set(article.url.replace(/\/$/, ""), article);
      }
    });

    return (
      <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            strong: ({ node, ...props }) => (
              <span className="font-semibold text-foreground" {...props} />
            ),
            h1: ({ node, ...props }) => (
              <h1
                className="text-xl font-semibold text-foreground mt-6 mb-3"
                {...props}
              />
            ),
            h2: ({ node, ...props }) => (
              <h2
                className="text-lg font-semibold text-foreground mt-5 mb-2"
                {...props}
              />
            ),
            h3: ({ node, ...props }) => (
              <h3
                className="text-base font-medium text-foreground mt-4 mb-2"
                {...props}
              />
            ),
            ul: ({ node, ...props }) => (
              <ul className="my-3 space-y-1" {...props} />
            ),
            li: ({ node, ...props }) => (
              <li className="text-foreground/80" {...props} />
            ),
            p: ({ node, ...props }) => (
              <p className="text-foreground/80 leading-7 mb-4" {...props} />
            ),
            a: ({ node, href, children, ...props }) => {
              // Check if this URL matches one of our articles
              const article = href
                ? urlToArticleMap.get(href) ||
                  urlToArticleMap.get(href.replace(/\/$/, ""))
                : null;

              if (article) {
                // Replace the link with an inline article card
                return (
                  <button
                    onClick={() => {
                      setSelectedArticle(article);
                      setIsArticleModalOpen(true);
                    }}
                    className="not-prose group relative block w-full my-6 overflow-hidden rounded-xl border border-border/50 bg-[var(--news-bg-primary)]/40 hover:bg-[var(--news-bg-primary)]/60 transition-all duration-300 text-left hover:shadow-2xl hover:shadow-black/40 hover:-translate-y-0.5"
                  >
                    <div className="flex flex-col sm:flex-row gap-4 p-4">
                      {article.image && (
                        <div className="h-48 sm:h-24 sm:w-32 flex-shrink-0 overflow-hidden rounded-lg bg-[var(--news-bg-secondary)]">
                          <img
                            src={article.image}
                            alt={article.title}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        </div>
                      )}
                      <div className="flex flex-col justify-between py-1 min-w-0 flex-1">
                        <div>
                          <h4 className="font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors text-base">
                            {article.title}
                          </h4>
                          <p className="mt-2 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                            {article.summary}
                          </p>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          <span className="text-primary/80">
                            {article.source}
                          </span>
                          <span>•</span>
                          <span>
                            {new Date(article.publishedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              }

              // Regular link (not an article)
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline decoration-primary/30 underline-offset-2"
                  {...props}
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {cleanedContent}
        </ReactMarkdown>
      </div>
    );
  };

  const buildArticleEmbeds = (message?: Message | null): NewsArticle[] => {
    if (!message) return [];

    const structuredArticles = message.structured_articles_json?.articles ?? [];
    const structuredFallback: NewsArticle[] = structuredArticles.map(
      (article) => {
        const tags = [article.category, article.source].filter(
          (value): value is string => Boolean(value),
        );
        const link =
          typeof article.link === "string" && article.link
            ? article.link
            : typeof article.url === "string"
              ? article.url
              : "";
        const description =
          article.summary || article.description || "No description";

        return {
          id: Date.now() + Math.random(),
          title: article.title || "No title",
          source: article.source || "Unknown",
          sourceId: (article.source || "unknown")
            .toLowerCase()
            .replace(/\s+/g, "-"),
          country: "United States",
          credibility: "medium" as const,
          bias: "center" as const,
          summary: description,
          content: description,
          image: article.image || "/placeholder.svg",
          publishedAt: article.published || new Date().toISOString(),
          category: article.category || "general",
          url: link,
          tags,
          originalLanguage: "en",
          translated: false,
        };
      },
    );

    if (message.referenced_articles && message.referenced_articles.length > 0) {
      return message.referenced_articles;
    }

    return structuredFallback;
  };

  const isEmpty = messages.length === 0;
  const latestUserMessage = useMemo(
    () => [...messages].reverse().find((message) => message.type === "user"),
    [messages],
  );
  const latestAssistantMessage = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((message) => message.type === "assistant" && !message.toolType),
    [messages],
  );
  const latestSemanticMessage = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((message) => message.toolType === "semantic_search"),
    [messages],
  );
  const relatedArticles = useMemo(
    () => buildArticleEmbeds(latestAssistantMessage),
    [latestAssistantMessage],
  );
  const sourcePreviewLimit = 5;
  const groupedSources = useMemo(() => {
    const groups = new Map<
      string,
      { sourceId: string; sourceName: string; articles: NewsArticle[] }
    >();
    const seenKeys = new Set<string>();

    relatedArticles.forEach((article) => {
      const urlKey = article.url || String(article.id);
      if (seenKeys.has(urlKey)) return;
      seenKeys.add(urlKey);

      const sourceId = article.sourceId || article.source || "unknown";
      if (!groups.has(sourceId)) {
        groups.set(sourceId, {
          sourceId,
          sourceName: article.source || "Unknown",
          articles: [],
        });
      }
      groups.get(sourceId)!.articles.push(article);
    });

    return Array.from(groups.values()).sort(
      (a, b) => b.articles.length - a.articles.length,
    );
  }, [relatedArticles]);
  const thinkingSteps = latestAssistantMessage?.thinking_steps ?? [];
  const conversationMessages = useMemo(
    () =>
      messages.filter(
        (message) =>
          message.type === "user" ||
          (message.type === "assistant" && !message.toolType),
      ),
    [messages],
  );
  const recentQueries = useMemo(
    () =>
      messages
        .filter((message) => message.type === "user")
        .slice(-6)
        .reverse(),
    [messages],
  );

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [conversationMessages.length, latestAssistantMessage?.isStreaming]);

  return (
    <div className="h-screen bg-[var(--news-bg-primary)] text-foreground overflow-hidden">
      <div className="flex h-screen">
        <div
          className={`${sidebarCollapsed ? "w-16" : "w-[240px]"} shrink-0 hidden md:block transition-all duration-300 ease-in-out border-r border-border/10 bg-[var(--news-bg-primary)]`}
        >
          <ChatSidebar
            chats={chats}
            onSelect={handleSelectChat}
            onNewChat={handleNewChat}
            onRename={handleRenameChat}
            onDelete={handleDeleteChat}
            onDeleteMultiple={handleDeleteChats}
            activeId={activeChatId}
            collapsed={sidebarCollapsed}
            onToggle={toggleSidebar}
          />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-20 border-b border-border/10 bg-[var(--news-bg-primary)]/90 backdrop-blur">
            <div className="w-full flex items-start justify-between px-6 py-5">
              <div className="flex flex-col gap-6 w-full min-w-0">
                <div className="flex items-center gap-4 min-w-0">
                  <button
                    onClick={toggleSidebar}
                    className="p-2 rounded-lg border border-border/20 text-muted-foreground hover:bg-[var(--news-bg-secondary)]/30 hover:text-foreground transition-all shrink-0 bg-[var(--news-bg-secondary)]/10"
                  >
                    {sidebarCollapsed ? (
                      <ChevronRight size={16} />
                    ) : (
                      <ChevronLeft size={16} />
                    )}
                  </button>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <h1 className="text-base font-semibold text-foreground leading-none shrink-0">
                      Scoop Research
                    </h1>
                    <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60 hidden sm:inline shrink-0">
                      WORKSPACE
                    </span>
                    <span className="text-muted-foreground/30 hidden sm:inline mx-2 shrink-0">
                      /
                    </span>
                    <span className="text-sm font-serif text-muted-foreground/80 truncate max-w-[300px] sm:max-w-[400px]">
                      {activeChatId
                        ? chats.find((c) => c.id === activeChatId)?.title ||
                          "Untitled research"
                        : "Untitled research"}
                    </span>
                  </div>
                </div>

                {!isEmpty && (
                  <div className="flex flex-col gap-2 w-full">
                    <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/50">
                      ACTIVE BRIEFING
                    </p>
                    <div className="flex items-start justify-between gap-6">
                      <h2 className="text-[26px] font-serif font-medium text-foreground/90 leading-tight">
                        {latestUserMessage?.content || "Research thread"}
                      </h2>
                      {(isSearching || latestAssistantMessage?.isStreaming) && (
                        <div className="flex items-center gap-2 text-[11px] text-primary/80 bg-primary/5 border border-primary/10 px-3 py-1.5 rounded-full shrink-0">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span className="font-mono uppercase tracking-widest">
                            {latestAssistantMessage?.streamingStatus ||
                              "Running..."}
                          </span>
                          <button
                            type="button"
                            onClick={handleStop}
                            className="ml-2 flex items-center justify-center rounded-full hover:bg-primary/20 p-1 transition-colors"
                            title="Stop generation"
                          >
                            <Square className="w-2.5 h-2.5 fill-current" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-5 mt-1">
                      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60 flex items-center gap-1.5">
                        <span className="text-foreground/80 font-semibold">
                          {conversationMessages.length}
                        </span>{" "}
                        MESSAGES
                      </div>
                      {latestAssistantMessage?.articles_searched && (
                        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60 flex items-center gap-1.5">
                          <span className="text-foreground/80 font-semibold">
                            {latestAssistantMessage.articles_searched}
                          </span>{" "}
                          SOURCES SEARCHED
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 pl-4 shrink-0">
                <Link href="/">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border/20 text-muted-foreground hover:text-foreground bg-transparent hover:bg-[var(--news-bg-secondary)]/30 rounded-full px-4"
                  >
                    <Home className="w-3.5 h-3.5 mr-2" />
                    Back to News
                  </Button>
                </Link>
              </div>
            </div>
          </header>

          <main className="flex-1 flex flex-col bg-[var(--news-bg-primary)] h-[calc(100vh-60px)] overflow-hidden">
            {!isEmpty && (
              <div className="w-full px-6 pt-5 pb-3 border-b border-border/10 bg-[var(--news-bg-primary)]/90 backdrop-blur z-10 shrink-0">
                <div className="flex flex-col gap-1 w-full max-w-[1400px] mx-auto">
                  <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/50">
                    ACTIVE BRIEFING
                  </p>
                  <div className="flex items-start justify-between gap-6">
                    <h2 className="text-2xl font-serif font-medium text-foreground/90 leading-tight truncate">
                      {latestUserMessage?.content || "Research thread"}
                    </h2>
                    {(isSearching || latestAssistantMessage?.isStreaming) && (
                      <div className="flex items-center gap-2 text-[11px] text-primary/80 bg-primary/5 border border-primary/10 px-3 py-1.5 rounded-full shrink-0">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span className="font-mono uppercase tracking-widest hidden sm:inline">
                          {latestAssistantMessage?.streamingStatus ||
                            "Running..."}
                        </span>
                        <button
                          type="button"
                          onClick={handleStop}
                          className="ml-1 flex items-center justify-center rounded-full hover:bg-primary/20 p-1 transition-colors"
                          title="Stop generation"
                        >
                          <Square className="w-2.5 h-2.5 fill-current" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-5 mt-1 shrink-0">
                    <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60 flex items-center gap-1.5">
                      <span className="text-foreground/80 font-semibold">
                        {conversationMessages.length}
                      </span>{" "}
                      MESSAGES
                    </div>
                    {latestAssistantMessage?.articles_searched && (
                      <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60 flex items-center gap-1.5">
                        <span className="text-foreground/80 font-semibold">
                          {latestAssistantMessage.articles_searched}
                        </span>{" "}
                        SOURCES SEARCHED
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {isEmpty ? (
              <div className="flex-1 flex flex-col p-4 lg:p-8">
                <div className="flex-1 max-w-2xl mx-auto w-full flex flex-col justify-center -mt-16">
                  <div className="mb-6 animate-in fade-in-0 duration-300">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/20">
                        <Cpu className="w-4 h-4 text-primary" />
                      </div>
                      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                        Research Workspace
                      </h1>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Ask a focused question to start a multi-source research
                      brief.
                    </p>
                  </div>

                  <div className="relative group w-full">
                    <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition duration-500 blur"></div>
                    <div className="relative rounded-2xl border border-border/20 bg-transparent p-1 focus-within:border-border/40 transition-all">
                      <form onSubmit={handleSearch}>
                        <textarea
                          ref={inputRef}
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSearch(e);
                            }
                          }}
                          placeholder="Ask a question about coverage, bias, or context..."
                          className="w-full bg-transparent text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none text-base font-sans px-3 min-h-[70px] py-2"
                        />
                        {query.length >= 3 && (
                          <SearchSuggestions
                            query={query}
                            onSuggestionClick={(suggestion) => {
                              setQuery(suggestion.label);
                              inputRef.current?.focus();
                            }}
                            className="mt-2 pt-2 border-t border-border/40"
                          />
                        )}
                        <div className="flex justify-between items-center mt-1 px-3 pt-2 pb-1 border-t border-border/10">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="p-2 hover:bg-[var(--news-bg-primary)] rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Filter className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              className="p-2 hover:bg-[var(--news-bg-primary)] rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Clock className="w-4 h-4" />
                            </button>
                          </div>
                          <button
                            type="submit"
                            disabled={!query.trim() || isSearching}
                            className="bg-primary/20 hover:bg-primary text-primary hover:text-primary-foreground px-4 py-1.5 rounded text-sm font-medium transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSearching ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                Start Research{" "}
                                <ArrowRight className="w-4 h-4" />
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>

                  <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
                    {sampleQueries.slice(0, 3).map((q) => (
                      <button
                        key={q}
                        onClick={() => handleSampleQuery(q)}
                        className="text-left p-5 rounded-xl bg-[var(--news-bg-secondary)]/30 border border-border/20 hover:bg-[var(--news-bg-secondary)] hover:border-primary/30 transition-all duration-300 group"
                      >
                        <p className="text-sm text-muted-foreground/70 leading-relaxed group-hover:text-foreground transition-colors">
                          {q}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col lg:flex-row min-h-0 h-full">
                <section className="flex-1 min-w-0 flex flex-col">
                  <div className="flex-1 min-h-0">
                    <div className="max-w-[1400px] mx-auto w-full h-full flex flex-col px-6">
                      <div
                        ref={chatScrollRef}
                        className="flex-1 min-h-0 overflow-y-auto py-6 space-y-6 custom-scrollbar px-2"
                      >
                        {conversationMessages.length === 0 ? (
                          <div className="rounded-xl border border-border/10 bg-[var(--news-bg-secondary)]/70 p-6 text-sm text-muted-foreground">
                            Start a query to build a multi-turn session.
                          </div>
                        ) : (
                          conversationMessages.map((message) => {
                            const isAssistant = message.type === "assistant";
                            const stepCount =
                              message.thinking_steps?.length ?? 0;
                            const stepsExpanded = expandedStepMessageIds.has(
                              message.id,
                            );
                            const messageClass =
                              message.type === "user"
                                ? "border-border/5 bg-[var(--news-bg-secondary)]/30 ml-20"
                                : message.error
                                  ? "border-border/5 bg-destructive/5 mr-12"
                                  : "border-transparent bg-transparent pl-0 pr-0 mt-2 mr-4";
                            return (
                              <div
                                key={message.id}
                                className={`rounded-2xl border px-5 py-3.5 ${messageClass}`}
                              >
                                <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.3em] text-muted-foreground">
                                  <span>
                                    {isAssistant ? "Assistant" : "You"}
                                  </span>
                                  <span>
                                    {message.timestamp.toLocaleTimeString(
                                      "en-US",
                                      { hour: "2-digit", minute: "2-digit" },
                                    )}
                                  </span>
                                </div>
                                <div className="mt-3 text-base text-foreground/90">
                                  {isAssistant ? (
                                    message.isStreaming ? (
                                      <div className="flex items-center gap-2 text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                                        <span>
                                          {message.streamingStatus ||
                                            "Working..."}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={handleStop}
                                          className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-border/40 transition-colors"
                                          title="Stop generation"
                                        >
                                          <Square className="h-3 w-3" />
                                          Stop
                                        </button>
                                      </div>
                                    ) : (
                                      renderContentWithEmbeds(
                                        message.content,
                                        buildArticleEmbeds(message),
                                      )
                                    )
                                  ) : (
                                    <p>{message.content}</p>
                                  )}
                                </div>

                                {isAssistant &&
                                  !message.isStreaming &&
                                  stepCount > 0 && (
                                    <div className="mt-3">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          toggleStepVisibility(message.id)
                                        }
                                        className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                                      >
                                        {stepsExpanded ? (
                                          <ChevronUp className="w-4 h-4" />
                                        ) : (
                                          <ChevronDown className="w-4 h-4" />
                                        )}
                                        {stepsExpanded
                                          ? "Hide steps"
                                          : `Show steps (${stepCount})`}
                                      </button>
                                      {stepsExpanded && (
                                        <div className="mt-3 space-y-2">
                                          {message.thinking_steps?.map(
                                            (step, idx) => (
                                              <div
                                                key={`${message.id}-step-${idx}`}
                                                className="rounded-lg border border-border/10 bg-[var(--news-bg-primary)]/40 p-3"
                                              >
                                                <div className="text-[10px] font-mono uppercase tracking-[0.05em] text-muted-foreground/70">
                                                  Step {idx + 1}:{" "}
                                                  {step.type.replace("_", " ")}
                                                </div>
                                                <p className="mt-2 text-xs text-muted-foreground">
                                                  {step.content}
                                                </p>
                                              </div>
                                            ),
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                {isAssistant &&
                                  !message.isStreaming &&
                                  message.error && (
                                    <div className="mt-3">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          handleResetMessage(message.id)
                                        }
                                        disabled={isSearching}
                                        className="border-border/10"
                                      >
                                        Reset
                                      </Button>
                                    </div>
                                  )}
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="bg-[var(--news-bg-primary)] p-4">
                        <form
                          ref={composerFormRef}
                          onSubmit={handleSearch}
                          className="space-y-2"
                        >
                          <div className="rounded-2xl border border-border/20 bg-[var(--news-bg-secondary)]/30 p-2 pl-4 focus-within:border-primary/40 focus-within:bg-[var(--news-bg-secondary)]/60 transition-all shadow-md flex items-center gap-2">
                            <textarea
                              ref={inputRef}
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  handleSearch(e);
                                }
                              }}
                              placeholder="Ask a question and press Enter..."
                              className="w-full h-[40px] bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 resize-none focus:outline-none py-2 px-1"
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
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap gap-2">
                              {/* Hide sample queries in active mode to preserve vertical space */}
                            </div>
                            <Button
                              type="submit"
                              size="sm"
                              disabled={!query.trim() || isSearching}
                              className="h-10 px-6 rounded-full bg-primary/90 hover:bg-primary text-primary-foreground transition-all"
                            >
                              {isSearching ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  Send <ArrowRight className="w-4 h-4 ml-1" />
                                </>
                              )}
                            </Button>
                          </div>
                        </form>
                      </div>
                    </div>
                  </div>
                </section>

                <aside className="w-full lg:w-[320px] shrink-0 border-t border-border/10 lg:border-l lg:border-t-0 bg-[var(--news-bg-primary)]/95 overflow-hidden flex flex-col h-full">
                  <div className="flex-1 overflow-y-auto custom-scrollbar h-full">
                    <div className="p-5 space-y-2">
                      <div className="border-b border-border/10 pb-4 pt-1 mb-2 last:border-0">
                        <div className="flex items-center justify-between">
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/80">
                            Research Log
                          </h3>
                          <span className="text-xs text-muted-foreground">
                            {thinkingSteps.length} steps
                          </span>
                        </div>
                        <div className="mt-3 space-y-3 text-sm">
                          {thinkingSteps.length > 0 ? (
                            thinkingSteps.slice(-6).map((step, idx) => (
                              <div
                                key={`${step.type}-${idx}`}
                                className="border-l-2 border-primary/20 pl-3 py-1 ml-0.5 mt-1"
                              >
                                <div className="text-[10px] font-mono uppercase tracking-[0.05em] text-muted-foreground/70">
                                  {step.type.replace("_", " ")}
                                </div>
                                <p className="mt-1 text-[11px] text-muted-foreground/80 leading-relaxed">
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
                      </div>

                      {latestAssistantMessage &&
                        !latestAssistantMessage.isStreaming &&
                        latestAssistantMessage.content && (
                          <VerificationPanel
                            query={latestUserMessage?.content || ""}
                            mainAnswer={latestAssistantMessage.content}
                            className="rounded-xl"
                          />
                        )}

                      {latestSemanticMessage?.semanticResults &&
                        latestSemanticMessage.semanticResults.length > 0 && (
                          <div className="border-b border-border/10 pb-4 pt-1 mb-2 last:border-0">
                            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/80">
                              Related Coverage
                            </h3>
                            <div className="mt-3 space-y-2">
                              {latestSemanticMessage.semanticResults.map(
                                ({ article, similarityScore }) => (
                                  <button
                                    key={`semantic-${article.url || article.id}`}
                                    onClick={() => {
                                      setSelectedArticle(article);
                                      setIsArticleModalOpen(true);
                                    }}
                                    className="w-full text-left rounded-lg border border-border/10 bg-[var(--news-bg-primary)]/50 p-3 hover:border-primary/40 transition-colors"
                                  >
                                    <div className="text-[13px] font-serif font-medium text-foreground/90 line-clamp-2">
                                      {article.title}
                                    </div>
                                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                                      <span>{article.source}</span>
                                      {typeof similarityScore === "number" && (
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--news-bg-primary)] text-muted-foreground border border-border/10">
                                          {Math.round(similarityScore * 100)}%
                                          match
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                ),
                              )}
                            </div>
                          </div>
                        )}

                      {groupedSources.length > 0 && (
                        <div className="border-b border-border/10 pb-4 pt-1 mb-2 last:border-0">
                          <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/80">
                            Sources Used
                          </h3>
                          <div className="mt-3 space-y-4">
                            {groupedSources.map((group) => {
                              const isExpanded = expandedSourceIds.has(
                                group.sourceId,
                              );
                              const visibleArticles = isExpanded
                                ? group.articles
                                : group.articles.slice(0, sourcePreviewLimit);

                              return (
                                <div
                                  key={group.sourceId}
                                  className="rounded-xl border border-border/20 bg-[var(--news-bg-secondary)]/20 p-4"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-medium text-foreground">
                                        {group.sourceName}
                                      </div>
                                      <div className="text-[9px] font-mono uppercase tracking-[0.1em] text-muted-foreground/70 mt-1.5">
                                        {group.articles.length} articles
                                      </div>
                                    </div>
                                    {group.articles.length >
                                      sourcePreviewLimit && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          toggleSourceVisibility(group.sourceId)
                                        }
                                        className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary hover:underline"
                                      >
                                        {isExpanded
                                          ? "Collapse"
                                          : `Show all (${group.articles.length})`}
                                      </button>
                                    )}
                                  </div>
                                  <div className="mt-3 space-y-2">
                                    {visibleArticles.map((article) => (
                                      <button
                                        key={`${group.sourceId}-${article.url || article.id}`}
                                        onClick={() => {
                                          setSelectedArticle(article);
                                          setIsArticleModalOpen(true);
                                        }}
                                        className="w-full text-left rounded-lg bg-[var(--news-bg-primary)]/40 hover:bg-[var(--news-bg-secondary)] px-3 py-2.5 text-xs transition-colors"
                                      >
                                        <div className="text-[13px] font-serif font-medium text-foreground/90 line-clamp-2">
                                          {article.title}
                                        </div>
                                        <div className="mt-2.5 flex items-center justify-between text-[9px] font-mono uppercase tracking-[0.1em] text-muted-foreground/60">
                                          <span>{article.source}</span>
                                          <span>
                                            {formatShortDate(
                                              article.publishedAt,
                                            )}
                                          </span>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="border-b border-border/10 pb-4 pt-1 mb-2 last:border-0">
                        <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/80">
                          Recent Queries
                        </h3>
                        <div className="mt-3 space-y-2">
                          {recentQueries.length > 0 ? (
                            recentQueries.map((message) => (
                              <button
                                key={message.id}
                                onClick={() =>
                                  handleSampleQuery(message.content)
                                }
                                className="w-full text-left rounded-lg border border-border/10 bg-[var(--news-bg-primary)]/50 px-3 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
                              >
                                {message.content}
                              </button>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Run a query to build a history.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            )}
          </main>
        </div>
      </div>

      <ArticleDetailModal
        article={selectedArticle}
        isOpen={isArticleModalOpen}
        onClose={() => {
          setIsArticleModalOpen(false);
          setSelectedArticle(null);
        }}
      />
    </div>
  );
}
