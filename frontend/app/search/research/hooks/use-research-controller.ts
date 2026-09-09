import { hasText } from "@/lib/utils";
import {
  CHAT_STORAGE_KEY,
  CHAT_STORAGE_VERSION,
  getHydratedChatId,
  parsePersistedChatState,
  reviveStoredChatMessages,
  serializeChatMessages,
} from "../state/persistence";
import type {
  DeepReadonly,
  Message,
  ReadonlyNewsArticle,
  StartResearchParameters,
  StoredChatState,
  UpdateChatMessages,
} from "../model/types";
import type { ResearchState, StateValue } from "../state/research-reducer";
import { createInitialResearchState, researchReducer } from "../state/research-reducer";
import {
  getActiveBriefTitle,
  selectLatestResearchMessages,
  selectResearchArticleData,
} from "../state/selectors";
import { getMessageVersionGroupId, getVisibleConversationMessages } from "@/lib/chat-branching";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ChatSummary } from "@/components/chat-sidebar";
import type React from "react";
import type { ResearchPageViewProps } from "../components/research-page";
import type { ResearchStreamActions } from "./use-research-transport";
import type { SourceGroup } from "../state/selectors";
import { useResearchTransport } from "./use-research-transport";

const NEW_CHAT_ID_LENGTH = 8;
const NEW_CHAT_ID_RADIX = 36;
const NEW_CHAT_ID_START = 2;
const NEW_CHAT_TITLE_WORD_COUNT = 4;
const NO_ARTICLE_INDEX = -1;
type ResearchStateSetter<T> = (value: StateValue<T>) => void;
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
  readonly setActiveAssistantVersion: (chatId: string, groupId: string, messageId: string) => void;
  readonly setActiveAssistantVersionMap: ResearchStateSetter<
    ResearchState["activeAssistantVersionMap"]
  >;
  readonly setActiveChatId: ResearchStateSetter<string | null>;
  readonly setChatMessagesMap: ResearchStateSetter<ResearchState["chatMessagesMap"]>;
  readonly setChats: ResearchStateSetter<ResearchState["chats"]>;
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

const CHAT_PREVIEW_MAX_LENGTH = 120;
const CHAT_TITLE_MAX_LENGTH = 60;
const PROMPT_PREVIEW_MAX_LENGTH = 200;
const buildNewChatSummary = (prompt: string): ChatSummary => {
    const firstSentence = (prompt.split(/[.\n]/u)[0] ?? "").trim(),
      firstWords = prompt.split(/\s+/u).slice(0, NEW_CHAT_TITLE_WORD_COUNT).join(" "),
      title = (firstSentence || firstWords || "New Chat").slice(0, CHAT_TITLE_MAX_LENGTH);
    return {
      id: `chat-${Date.now()}-${Math.random().toString(NEW_CHAT_ID_RADIX).slice(NEW_CHAT_ID_START, NEW_CHAT_ID_LENGTH)}`,
      lastMessage: prompt.slice(0, CHAT_PREVIEW_MAX_LENGTH),
      title,
      updatedAt: new Date().toISOString(),
    };
  };
const initializeNewChat = (prompt: string, context: Readonly<SubmitPromptContext>): ChatSummary => {
    const newChat = buildNewChatSummary(prompt);
    context.setChats((chats) => [newChat, ...chats]);
    context.setChatMessagesMap((messages) => ({ ...messages, [newChat.id]: [] }));
    context.setActiveAssistantVersionMap((versions) => ({ ...versions, [newChat.id]: {} }));
    context.setActiveChatId(newChat.id);
    return newChat;
  };
const resolveChatTarget = (
    parameters: Readonly<SubmitPromptParameters>,
    prompt: string,
    context: Readonly<SubmitPromptContext>,
  ): ChatTarget => {
    if (hasText(context.activeChatId) && parameters.forceNewChat !== true) {
      return { chatId: context.activeChatId };
    }
    const newChat = initializeNewChat(prompt, context);
    return { chatId: newChat.id, newChatTitle: newChat.title };
  };
const findEditingTarget = (
    parameters: Readonly<SubmitPromptParameters>,
    context: Readonly<SubmitPromptContext>,
  ): Message | undefined => {
    if (parameters.editingTargetId === undefined || parameters.editingTargetId === null) {
      return void 0;
    }
    return context.messages.find((message) => message.id === parameters.editingTargetId);
  };
const resolveEditedParentId = (
    editingTarget: Readonly<Message> | undefined,
    conversationMessages: readonly Message[],
  ): string | undefined => {
    if (editingTarget === undefined) {
      return void 0;
    }
    if (editingTarget.parentMessageId !== undefined) {
      return editingTarget.parentMessageId;
    }
    const targetIndex = conversationMessages.findIndex(
      (message) => message.id === editingTarget.id,
    );
    return conversationMessages[targetIndex + NO_ARTICLE_INDEX]?.id;
  };
const getRetryMessageGroupId = (editingTarget: Readonly<Message> | undefined): string | undefined => {
    if (editingTarget?.type !== "user") {
      return void 0;
    }
    return getMessageVersionGroupId(editingTarget);
  };
const buildUserMessage = (
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
  };
const getVersionSelectionOverrides = (
    editingTarget: Readonly<Message> | undefined,
    userMessage: Readonly<Message>,
  ): Record<string, string> | undefined => {
    if (editingTarget?.type !== "user") {
      return void 0;
    }
    return { [getMessageVersionGroupId(editingTarget)]: userMessage.id };
  };
const appendPromptMessage = (
    context: Readonly<SubmitPromptContext>,
    chatId: string,
    userMessage: Readonly<Message>,
    prompt: string,
  ): void => {
    context.updateChatMessages(chatId, (messages) => [...messages, userMessage], {
      summaryPreview: prompt.slice(0, PROMPT_PREVIEW_MAX_LENGTH),
      updatedAt: new Date().toISOString(),
    });
  };
const applyPromptStateChanges = (
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
  };
const createResearchStartParameters = (
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
  });
const submitResearchPrompt = async (
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
      };
    const editingTarget = findEditingTarget(parameters, context);
    const userMessage = buildUserMessage(
        trimmedQuery,
        editingTarget,
        context.conversationMessages.at(-1),
        context.conversationMessages,
      );
    const seedMessages = [...context.messages, userMessage];
    appendPromptMessage(context, resolvedTarget.chatId, userMessage, trimmedQuery);
    applyPromptStateChanges(parameters, context, resolvedTarget, editingTarget, userMessage);
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

interface ResearchChatState extends ResearchState {
  readonly setQuery: (value: string) => void;
  readonly setIsSearching: (value: boolean) => void;
  readonly setSelectedArticle: (value: ReadonlyNewsArticle | null) => void;
  readonly setIsArticleModalOpen: (value: boolean) => void;
  readonly setChats: ResearchStateSetter<ResearchState["chats"]>;
  readonly setChatMessagesMap: ResearchStateSetter<ResearchState["chatMessagesMap"]>;
  readonly setActiveAssistantVersionMap: ResearchStateSetter<
    ResearchState["activeAssistantVersionMap"]
  >;
  readonly setActiveChatId: ResearchStateSetter<string | null>;
  readonly setEditingMessageId: (value: string | null) => void;
  readonly setEditingDraft: (value: string) => void;
  readonly setSidebarCollapsed: ResearchStateSetter<boolean>;
  readonly setExpandedStepMessageIds: ResearchStateSetter<ReadonlySet<string>>;
  readonly setExpandedSourceIds: ResearchStateSetter<ReadonlySet<string>>;
  readonly setInputElement: React.RefCallback<HTMLTextAreaElement>;
  readonly focusInput: () => void;
  readonly setChatScrollElement: React.RefCallback<HTMLDivElement>;
  readonly scrollToLatest: () => void;
  readonly isHydrating: () => boolean;
  readonly markHydrated: () => void;
  readonly isHandoffConsumed: (query: string) => boolean;
  readonly consumeHandoffQuery: (query: string) => void;
  readonly activeAssistantVersions: Readonly<Record<string, string>>;
  readonly messages: readonly Message[];
  readonly conversationMessages: readonly Message[];
  readonly updateChatMessages: UpdateChatMessages;
  readonly setActiveAssistantVersion: (chatId: string, groupId: string, messageId: string) => void;
  readonly clearMessageEditing: () => void;
}

const useResearchChatState = (): ResearchChatState => {
  const [state, dispatch] = useReducer(researchReducer, undefined, createInitialResearchState);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const isHydratingRef = useRef(true);
  const consumedHandoffQueryRef = useRef<string | undefined>(void 0);
  const setInputElement = useCallback<React.RefCallback<HTMLTextAreaElement>>((element) => {
    inputRef.current = element;
  }, []);
  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);
  const setChatScrollElement = useCallback<React.RefCallback<HTMLDivElement>>((element) => {
    chatScrollRef.current = element;
  }, []);
  const scrollToLatest = useCallback(() => {
    const element = chatScrollRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, []);
  const isHydrating = useCallback(() => isHydratingRef.current, []);
  const markHydrated = useCallback(() => {
    isHydratingRef.current = false;
  }, []);
  const isHandoffConsumed = useCallback(
    (query: string) => consumedHandoffQueryRef.current === query,
    [],
  );
  const consumeHandoffQuery = useCallback((query: string) => {
    consumedHandoffQueryRef.current = query;
  }, []);
  const setQuery = useCallback((value: string) => {
    dispatch({ type: "set-query", value });
  }, []);
  const setIsSearching = useCallback((value: boolean) => {
    dispatch({ type: "set-searching", value });
  }, []);
  const setSelectedArticle = useCallback((value: ReadonlyNewsArticle | null) => {
    dispatch({ type: "set-selected-article", value });
  }, []);
  const setIsArticleModalOpen = useCallback((value: boolean) => {
    dispatch({ type: "set-article-modal-open", value });
  }, []);
  const setChats = useCallback((value: StateValue<ResearchState["chats"]>) => {
    dispatch({ type: "set-chats", value });
  }, []);
  const setChatMessagesMap = useCallback((value: StateValue<ResearchState["chatMessagesMap"]>) => {
    dispatch({ type: "set-chat-messages-map", value });
  }, []);
  const setActiveAssistantVersionMap = useCallback(
    (value: StateValue<ResearchState["activeAssistantVersionMap"]>) => {
      dispatch({ type: "set-active-assistant-version-map", value });
    },
    [],
  );
  const setActiveChatId = useCallback((value: StateValue<string | null>) => {
    dispatch({ type: "set-active-chat-id", value });
  }, []);
  const setEditingMessageId = useCallback((value: string | null) => {
    dispatch({ type: "set-editing-message-id", value });
  }, []);
  const setEditingDraft = useCallback((value: string) => {
    dispatch({ type: "set-editing-draft", value });
  }, []);
  const setSidebarCollapsed = useCallback((value: StateValue<boolean>) => {
    dispatch({ type: "set-sidebar-collapsed", value });
  }, []);
  const setExpandedStepMessageIds = useCallback((value: StateValue<ReadonlySet<string>>) => {
    dispatch({ type: "set-expanded-step-message-ids", value });
  }, []);
  const setExpandedSourceIds = useCallback((value: StateValue<ReadonlySet<string>>) => {
    dispatch({ type: "set-expanded-source-ids", value });
  }, []);
  const updateChatMessages = useCallback<UpdateChatMessages>((chatId, updater, options) => {
    dispatch({ chatId, options, type: "update-chat-messages", updater });
  }, []);
  const setActiveAssistantVersion = useCallback(
    (chatId: string, groupId: string, messageId: string) => {
      dispatch({ chatId, groupId, messageId, type: "set-active-assistant-version" });
    },
    [],
  );
  const clearMessageEditing = useCallback(() => {
    dispatch({ type: "clear-message-editing" });
  }, []);
  const messages = useMemo(
    () =>
      (() => {
  if (state.activeChatId === null) {
    return [];
  }
  return [...(state.chatMessagesMap[state.activeChatId] ?? [])];
})(),
    [state.activeChatId, state.chatMessagesMap],
  );
  const activeAssistantVersions = useMemo(
    () =>
      (() => {
  if (state.activeChatId === null) {
    return {};
  }
  return state.activeAssistantVersionMap[state.activeChatId] ?? {};
})(),
    [state.activeAssistantVersionMap, state.activeChatId],
  );
  const conversationMessages = useMemo(
    () => [...getVisibleConversationMessages(messages, activeAssistantVersions)],
    [activeAssistantVersions, messages],
  );
  return {
    ...state,
    activeAssistantVersions,
    clearMessageEditing,
    consumeHandoffQuery,
    conversationMessages,
    focusInput,
    isHandoffConsumed,
    isHydrating,
    markHydrated,
    messages,
    scrollToLatest,
    setActiveAssistantVersion,
    setActiveAssistantVersionMap,
    setActiveChatId,
    setChatMessagesMap,
    setChatScrollElement,
    setChats,
    setEditingDraft,
    setEditingMessageId,
    setExpandedSourceIds,
    setExpandedStepMessageIds,
    setInputElement,
    setIsArticleModalOpen,
    setIsSearching,
    setQuery,
    setSelectedArticle,
    setSidebarCollapsed,
    updateChatMessages,
  };
};
interface ResearchChatActions {
  readonly handleNewChat: () => void;
  readonly handleStop: () => void;
  readonly toggleSidebar: () => void;
  readonly handleSelectChat: (id: string) => void;
  readonly handleRenameChat: (id: string, title: string) => void;
  readonly handleDeleteChat: (id: string) => void;
  readonly handleDeleteChats: (ids: readonly string[]) => void;
  readonly toggleStepVisibility: (messageId: string) => void;
  readonly toggleSourceVisibility: (sourceId: string) => void;
}

const useResearchChatActions = (
  context: Readonly<ResearchChatState>,
  transport: Readonly<ResearchStreamActions>,
): ResearchChatActions => {
  const {
    activeChatId,
    chats,
    clearMessageEditing,
    setActiveAssistantVersionMap,
    setActiveChatId,
    setChatMessagesMap,
    setChats,
    setExpandedSourceIds,
    setExpandedStepMessageIds,
    setSidebarCollapsed,
  } = context;
  const handleNewChat = useCallback(() => {
    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newChat: ChatSummary = {
      id,
      lastMessage: "",
      title: "Untitled research",
      updatedAt: new Date().toISOString(),
    };
    transport.stopResearch();
    setChats((previous) => [newChat, ...previous]);
    setChatMessagesMap((previous) => ({ ...previous, [id]: [] }));
    setActiveAssistantVersionMap((previous) => ({ ...previous, [id]: {} }));
    setActiveChatId(id);
    clearMessageEditing();
  }, [
    clearMessageEditing,
    setActiveAssistantVersionMap,
    setActiveChatId,
    setChatMessagesMap,
    setChats,
    transport,
  ]);
  const handleStop = useCallback(() => {
    transport.stopResearch();
  }, [transport]);
  const handleSelectChat = useCallback(
    (id: string) => {
      setActiveChatId(id);
      clearMessageEditing();
    },
    [clearMessageEditing, setActiveChatId],
  );
  const handleRenameChat = useCallback(
    (id: string, title: string) => {
      setChats((previous) => previous.map((chat) => ((() => {
  if (chat.id === id) {
    return {
      ...chat,
      title
    };
  }
  return chat;
})())));
    },
    [setChats],
  );
  const handleDeleteChat = useCallback(
    (id: string) => {
      const remainingChats = chats.filter((chat) => chat.id !== id);
      const nextChatId = (() => {
  if (activeChatId === id) {
    return remainingChats[0]?.id ?? null;
  }
  return activeChatId;
})();
      setChats(remainingChats);
      setChatMessagesMap((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      clearMessageEditing();
      if (activeChatId === id) {
        setActiveChatId(nextChatId);
      }
    },
    [activeChatId, chats, clearMessageEditing, setActiveChatId, setChatMessagesMap, setChats],
  );
  const handleDeleteChats = useCallback(
    (ids: readonly string[]) => {
      const remainingChats = chats.filter((chat) => !ids.includes(chat.id));
      const nextChatId =
        (() => {
  if (activeChatId !== null && ids.includes(activeChatId)) {
    return remainingChats[0]?.id ?? null;
  }
  return activeChatId;
})();
      setChats(remainingChats);
      setChatMessagesMap((previous) => {
        const next = { ...previous };
        ids.forEach((id) => {
          delete next[id];
        });
        return next;
      });
      clearMessageEditing();
      if (activeChatId !== nextChatId) {
        setActiveChatId(nextChatId);
      }
    },
    [activeChatId, chats, clearMessageEditing, setActiveChatId, setChatMessagesMap, setChats],
  );
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((previous) => !previous);
  }, [setSidebarCollapsed]);
  const toggleStepVisibility = useCallback(
    (messageId: string) => {
      setExpandedStepMessageIds((previous) => {
        const next = new Set(previous);
        if (next.has(messageId)) {
          next.delete(messageId);
        } else {
          next.add(messageId);
        }
        return next;
      });
    },
    [setExpandedStepMessageIds],
  );
  const toggleSourceVisibility = useCallback(
    (sourceId: string) => {
      setExpandedSourceIds((previous) => {
        const next = new Set(previous);
        if (next.has(sourceId)) {
          next.delete(sourceId);
        } else {
          next.add(sourceId);
        }
        return next;
      });
    },
    [setExpandedSourceIds],
  );
  return {
    handleDeleteChat,
    handleDeleteChats,
    handleNewChat,
    handleRenameChat,
    handleSelectChat,
    handleStop,
    toggleSidebar,
    toggleSourceVisibility,
    toggleStepVisibility,
  };
};
type ResearchHydrationContext = Pick<
  ResearchChatState,
  | "markHydrated"
  | "setActiveAssistantVersionMap"
  | "setActiveChatId"
  | "setChatMessagesMap"
  | "setChats"
>;

type ResearchPersistenceContext = Pick<
  ResearchChatState,
  "activeAssistantVersionMap" | "activeChatId" | "chatMessagesMap" | "chats" | "isHydrating"
>;
const hydrateResearchChats = (context: Readonly<ResearchHydrationContext>): void => {
  try {
    const stored = globalThis.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!hasText(stored)) {
      return;
    }
    const parsed = parsePersistedChatState(stored);
    if (parsed === undefined) {
      return;
    }
    const revivedMessages = reviveStoredChatMessages(parsed.messages);
    context.setChats(parsed.chats.map((chat) => ({ ...chat })));
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
      context.markHydrated();
    }, 0);
  }
};

const persistResearchChats = (context: Readonly<ResearchPersistenceContext>): void => {
  if (context.isHydrating()) {
    return;
  }
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
};

const useResearchChatPersistence = (context: Readonly<ResearchChatState>): void => {
  const hydrationContext = useMemo(
    () => ({
      markHydrated: context.markHydrated,
      setActiveAssistantVersionMap: context.setActiveAssistantVersionMap,
      setActiveChatId: context.setActiveChatId,
      setChatMessagesMap: context.setChatMessagesMap,
      setChats: context.setChats,
    }),
    [
      context.markHydrated,
      context.setActiveAssistantVersionMap,
      context.setActiveChatId,
      context.setChatMessagesMap,
      context.setChats,
    ],
  );
  const persistenceContext = useMemo(
    () => ({
      activeAssistantVersionMap: context.activeAssistantVersionMap,
      activeChatId: context.activeChatId,
      chatMessagesMap: context.chatMessagesMap,
      chats: context.chats,
      isHydrating: context.isHydrating,
    }),
    [
      context.activeAssistantVersionMap,
      context.activeChatId,
      context.chatMessagesMap,
      context.chats,
      context.isHydrating,
    ],
  );
  useEffect(() => {
    hydrateResearchChats(hydrationContext);
  }, [hydrationContext]);
  useEffect(() => {
    persistResearchChats(persistenceContext);
  }, [persistenceContext]);
};
const useResearchStreamActions = (context: Readonly<ResearchChatState>): ResearchStreamActions =>
  useResearchTransport({
    activeAssistantVersionMap: context.activeAssistantVersionMap,
    activeChatId: context.activeChatId,
    chats: context.chats,
    focusInput: context.focusInput,
    setActiveAssistantVersion: context.setActiveAssistantVersion,
    setIsSearching: context.setIsSearching,
    updateChatMessages: context.updateChatMessages,
  });

interface ResearchDerivedState {
  readonly activeBriefTitle: string;
  readonly groupedSources: SourceGroup[];
  readonly isEmpty: boolean;
  readonly latestAssistantMessage: Message | undefined;
  readonly latestSemanticMessage: Message | undefined;
  readonly latestUserMessage: Message | undefined;
  readonly relatedArticles: ReadonlyNewsArticle[];
  readonly thinkingSteps: NonNullable<Message["thinking_steps"]>;
  readonly handleCloseArticle: () => void;
  readonly handleOpenArticle: (article: ReadonlyNewsArticle) => void;
}

const useResearchDerivedState = (context: Readonly<ResearchChatState>): ResearchDerivedState => {
  const {
    activeChatId,
    chats,
    conversationMessages,
    messages,
    scrollToLatest,
    setIsArticleModalOpen,
    setSelectedArticle,
  } = context;
  const isEmpty = messages.length === 0;
  const { latestAssistantMessage, latestSemanticMessage, latestUserMessage } = useMemo(
    () => selectLatestResearchMessages(conversationMessages, messages),
    [conversationMessages, messages],
  );
  const { groupedSources, relatedArticles, thinkingSteps } = useMemo(
    () => selectResearchArticleData(latestAssistantMessage),
    [latestAssistantMessage],
  );
  const activeBriefTitle = getActiveBriefTitle(latestUserMessage, chats, activeChatId);
  const handleOpenArticle = useCallback(
    (article: ReadonlyNewsArticle) => {
      setSelectedArticle(article);
      setIsArticleModalOpen(true);
    },
    [setIsArticleModalOpen, setSelectedArticle],
  );
  const handleCloseArticle = useCallback(() => {
    setIsArticleModalOpen(false);
    setSelectedArticle(null);
  }, [setIsArticleModalOpen, setSelectedArticle]);

  useEffect(() => {
    const hasMessages = conversationMessages.length > 0 || latestAssistantMessage !== undefined;
    if (hasMessages) {
      scrollToLatest();
    }
  }, [conversationMessages, latestAssistantMessage, scrollToLatest]);

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
  readonly state: ResearchChatState;
  readonly startResearch: ResearchStreamActions["startResearch"];
  readonly submitPrompt: (parameters: SubmitPromptParameters) => Promise<void>;
}

interface ResearchMessageActions {
  readonly handleCancelEditMessage: () => void;
  readonly handleCopyMessage: (content: string) => Promise<void>;
  readonly handleDeleteMessage: (messageId: string) => void;
  readonly handleEditMessage: (messageId: string) => void;
  readonly handleResetMessage: (assistantMessageId: string) => Promise<void>;
  readonly handleSampleQuery: (sampleQuery: string) => void;
  readonly handleSaveEditedMessage: () => Promise<void>;
  readonly handleSearch: () => Promise<void>;
  readonly handleSelectMessageVersion: (groupId: string, messageId: string) => void;
}

const useResearchMessageMutationActions = (
    context: Readonly<ResearchMessageActionsContext>,
  ): Pick<
    ResearchMessageActions,
    | "handleCancelEditMessage"
    | "handleDeleteMessage"
    | "handleEditMessage"
    | "handleSaveEditedMessage"
  > => {
    const { state, submitPrompt } = context;
    const {
        activeChatId,
        clearMessageEditing,
        editingDraft,
        editingMessageId,
        isSearching,
        messages,
        setEditingDraft,
        setEditingMessageId,
        updateChatMessages,
      } = state;
    const handleDeleteMessage = (messageId: string) => {
        if (isSearching || activeChatId === null) {
          return;
        }
        if (editingMessageId === messageId) {
          clearMessageEditing();
        }
        updateChatMessages(activeChatId, (previous) =>
          previous.filter((message) => message.id !== messageId),
        );
      };
    const handleEditMessage = (messageId: string) => {
        if (isSearching) {
          return;
        }
        const target = messages.find((message) => message.id === messageId);
        if (target === undefined || target.type !== "user") {
          return;
        }
        setEditingMessageId(messageId);
        setEditingDraft(target.content);
      };
    const handleCancelEditMessage = () => {
        clearMessageEditing();
      };
    const handleSaveEditedMessage = async () => {
        if (editingMessageId === null || editingMessageId.length === 0) {
          return;
        }
        await submitPrompt({ editingTargetId: editingMessageId, prompt: editingDraft });
      };
    return {
      handleCancelEditMessage,
      handleDeleteMessage,
      handleEditMessage,
      handleSaveEditedMessage,
    };
  },
  useResearchMessageRevisionActions = (
    context: Readonly<ResearchMessageActionsContext>,
  ): Pick<ResearchMessageActions, "handleResetMessage" | "handleSelectMessageVersion"> => {
    const { state, startResearch } = context,
      { activeChatId, conversationMessages, isSearching, messages, setActiveAssistantVersion } =
        state,
      handleResetMessage = async (assistantMessageId: string) => {
        if (isSearching || activeChatId === null) {
          return;
        }
        const visibleAssistantIndex = conversationMessages.findIndex(
          (message) => message.id === assistantMessageId,
        );
        if (visibleAssistantIndex <= 0) {
          return;
        }
        const targetAssistant = messages.find((message) => message.id === assistantMessageId);
        if (targetAssistant?.type !== "assistant") {
          return;
        }
        const retryUserMessage = conversationMessages
          .slice(0, visibleAssistantIndex)
          .toReversed()
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
        if (activeChatId === null) {
          return;
        }
        setActiveAssistantVersion(activeChatId, groupId, messageId);
      };
    return { handleResetMessage, handleSelectMessageVersion };
  },
  useResearchMessageSearchActions = (
    context: Readonly<ResearchMessageActionsContext>,
  ): Pick<ResearchMessageActions, "handleSampleQuery" | "handleSearch"> => {
    const { state, submitPrompt } = context;
    const { clearMessageEditing, focusInput, query, setQuery } = state;
    const handleSearch = async () => {
        await submitPrompt({ clearComposer: true, prompt: query });
      };
    const handleSampleQuery = (sampleQuery: string) => {
        clearMessageEditing();
        setQuery(sampleQuery);
        focusInput();
      };
    return { handleSampleQuery, handleSearch };
  };

const useResearchMessageActions = (
  context: Readonly<ResearchMessageActionsContext>,
): ResearchMessageActions => {
  const handleCopyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (error) {
      console.error("Failed to copy message:", error);
    }
  };
  return {
    handleCopyMessage,
    ...useResearchMessageMutationActions(context),
    ...useResearchMessageRevisionActions(context),
    ...useResearchMessageSearchActions(context),
  };
};

interface ResearchPromptSubmissionContext {
  readonly state: ResearchChatState;
  readonly startResearch: ResearchStreamActions["startResearch"];
}

const useResearchPromptSubmission = (
  context: Readonly<ResearchPromptSubmissionContext>,
): ((parameters: SubmitPromptParameters) => Promise<void>) => {
  const { state, startResearch } = context,
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
      setActiveAssistantVersionMap,
      setActiveChatId,
      setChatMessagesMap,
      setChats,
      setQuery,
      startResearch,
      updateChatMessages,
    ],
  );
};

interface ResearchHandoffContext {
  readonly state: ResearchChatState;
  readonly handoffQuery: string;
  readonly replace: (href: string) => void;
  readonly submitPrompt: (parameters: SubmitPromptParameters) => Promise<void>;
}

interface SearchPageRouter {
  readonly replace: (href: string) => void;
}

interface NewsResearchPageServices {
  readonly getRouter: () => SearchPageRouter;
  readonly getSearchParams: () => Pick<URLSearchParams, "get">;
}

const DEFAULT_NEWS_RESEARCH_PAGE_SERVICES: NewsResearchPageServices = {
    getRouter: useRouter,
    getSearchParams: useSearchParams,
  },
  useResearchHandoff = (context: Readonly<ResearchHandoffContext>): void => {
    const { state, handoffQuery, replace, submitPrompt } = context,
      { consumeHandoffQuery, isHandoffConsumed, isHydrating, isSearching, setQuery } = state;

    useEffect(() => {
      if (isHydrating() || isSearching) {
        return;
      }
      if (!handoffQuery) {
        return;
      }
      if (isHandoffConsumed(handoffQuery)) {
        return;
      }

      consumeHandoffQuery(handoffQuery);
      setQuery(handoffQuery);
      void submitPrompt({
        clearComposer: true,
        forceNewChat: true,
        prompt: handoffQuery,
      });
      replace("/search");
    }, [
      consumeHandoffQuery,
      handoffQuery,
      isHandoffConsumed,
      isHydrating,
      isSearching,
      replace,
      setQuery,
      submitPrompt,
    ]);
  };
interface ResearchPageAssemblyContext {
  readonly actions: ResearchChatActions;
  readonly chatState: ResearchChatState;
  readonly derivedState: ResearchDerivedState;
  readonly messageActions: ResearchMessageActions;
}

const createResearchPageViewProps = ({
  actions,
  chatState,
  derivedState,
  messageActions,
}: DeepReadonly<ResearchPageAssemblyContext>): ResearchPageViewProps => ({
  articleModal: {
    article: chatState.selectedArticle,
    isOpen: chatState.isArticleModalOpen,
    onClose: derivedState.handleCloseArticle,
  },
  sidebar: {
    activeChatId: chatState.activeChatId,
    chats: [...chatState.chats],
    collapsed: chatState.sidebarCollapsed,
    onDelete: actions.handleDeleteChat,
    onDeleteMultiple: actions.handleDeleteChats,
    onNew: actions.handleNewChat,
    onRename: actions.handleRenameChat,
    onSelect: actions.handleSelectChat,
    onToggle: actions.toggleSidebar,
  },
  workspace: {
    activeBriefTitle: derivedState.activeBriefTitle,
    chat: {
      activeAssistantVersions: chatState.activeAssistantVersions,
      chatScrollRef: chatState.setChatScrollElement,
      conversationMessages: [...chatState.conversationMessages],
      editingDraft: chatState.editingDraft,
      editingMessageId: chatState.editingMessageId,
      expandedSourceIds: new Set(chatState.expandedSourceIds),
      expandedStepMessageIds: new Set(chatState.expandedStepMessageIds),
      groupedSources: derivedState.groupedSources,
      inputRef: chatState.setInputElement,
      isSearching: chatState.isSearching,
      latestAssistantMessage: derivedState.latestAssistantMessage,
      latestSemanticMessage: derivedState.latestSemanticMessage,
      latestUserMessage: derivedState.latestUserMessage,
      messages: [...chatState.messages],
      onCancelEdit: messageActions.handleCancelEditMessage,
      onCopy: (content) => {
        void messageActions.handleCopyMessage(content);
      },
      onDelete: messageActions.handleDeleteMessage,
      onEdit: messageActions.handleEditMessage,
      onFocusInput: chatState.focusInput,
      onOpenArticle: derivedState.handleOpenArticle,
      onReset: (messageId) => {
        void messageActions.handleResetMessage(messageId);
      },
      onSaveEdit: () => {
        void messageActions.handleSaveEditedMessage();
      },
      onSearch: () => {
        void messageActions.handleSearch();
      },
      onSelectVersion: messageActions.handleSelectMessageVersion,
      onStop: actions.handleStop,
      onToggleSource: actions.toggleSourceVisibility,
      onToggleSteps: actions.toggleStepVisibility,
      query: chatState.query,
      setEditingDraft: chatState.setEditingDraft,
      setQuery: chatState.setQuery,
      thinkingSteps: [...derivedState.thinkingSteps],
    },
    collapsed: chatState.sidebarCollapsed,
    empty: {
      inputRef: chatState.setInputElement,
      isSearching: chatState.isSearching,
      onFocusInput: chatState.focusInput,
      onSampleQuery: messageActions.handleSampleQuery,
      onSearch: () => {
        void messageActions.handleSearch();
      },
      query: chatState.query,
      setQuery: chatState.setQuery,
    },
    isEmpty: derivedState.isEmpty,
    isSearching: chatState.isSearching,
    latestAssistantMessage: derivedState.latestAssistantMessage,
    messageCount: chatState.conversationMessages.length,
    onStop: actions.handleStop,
    onToggleSidebar: actions.toggleSidebar,
  },
});

const useResearchPageController = (services: NewsResearchPageServices): ResearchPageViewProps => {
  const { replace } = services.getRouter();
  const searchParams = services.getSearchParams();
  const chatState = useResearchChatState();
  const handoffQuery = searchParams.get("query")?.trim() ?? "";
  const transport = useResearchStreamActions(chatState);
  const actions = useResearchChatActions(chatState, transport);

  useResearchChatPersistence(chatState);

  const derivedState = useResearchDerivedState(chatState);
  const { startResearch } = transport;

  const submitPrompt = useResearchPromptSubmission({
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
};

export { DEFAULT_NEWS_RESEARCH_PAGE_SERVICES, useResearchPageController };
export type { NewsResearchPageServices };
