import { getVisibleConversationMessages } from "@/lib/chat-branching";
import { useCallback, useMemo, useReducer, useRef } from "react";
import type React from "react";
import type { Message, ReadonlyNewsArticle, UpdateChatMessages } from "../model/types";
import type { ResearchState, StateValue } from "../state/research-reducer";
import { createInitialResearchState, researchReducer } from "../state/research-reducer";

type ResearchStateSetter<Value> = (value: StateValue<Value>) => void;
type ResearchDispatch = (action: Parameters<typeof researchReducer>[1]) => void;

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

const createChatDispatchActions = (dispatch: ResearchDispatch) => ({
  clearMessageEditing: (): void => {
    dispatch({ type: "clear-message-editing" });
  },
  setActiveAssistantVersion: (chatId: string, groupId: string, messageId: string): void => {
    dispatch({ chatId, groupId, messageId, type: "set-active-assistant-version" });
  },
  setActiveAssistantVersionMap: (
    value: StateValue<ResearchState["activeAssistantVersionMap"]>,
  ): void => {
    dispatch({ type: "set-active-assistant-version-map", value });
  },
  setActiveChatId: (value: StateValue<string | null>): void => {
    dispatch({ type: "set-active-chat-id", value });
  },
  setChatMessagesMap: (value: StateValue<ResearchState["chatMessagesMap"]>): void => {
    dispatch({ type: "set-chat-messages-map", value });
  },
  setChats: (value: StateValue<ResearchState["chats"]>): void => {
    dispatch({ type: "set-chats", value });
  },
  setEditingDraft: (value: string): void => {
    dispatch({ type: "set-editing-draft", value });
  },
  setEditingMessageId: (value: string | null): void => {
    dispatch({ type: "set-editing-message-id", value });
  },
});

const createViewDispatchActions = (dispatch: ResearchDispatch) => ({
  setExpandedSourceIds: (value: StateValue<ReadonlySet<string>>): void => {
    dispatch({ type: "set-expanded-source-ids", value });
  },
  setExpandedStepMessageIds: (value: StateValue<ReadonlySet<string>>): void => {
    dispatch({ type: "set-expanded-step-message-ids", value });
  },
  setIsArticleModalOpen: (value: boolean): void => {
    dispatch({ type: "set-article-modal-open", value });
  },
  setIsSearching: (value: boolean): void => {
    dispatch({ type: "set-searching", value });
  },
  setQuery: (value: string): void => {
    dispatch({ type: "set-query", value });
  },
  setSelectedArticle: (value: ReadonlyNewsArticle | null): void => {
    dispatch({ type: "set-selected-article", value });
  },
  setSidebarCollapsed: (value: StateValue<boolean>): void => {
    dispatch({ type: "set-sidebar-collapsed", value });
  },
  updateChatMessages: (
    chatId: string,
    updater: Parameters<UpdateChatMessages>[1],
    options?: Parameters<UpdateChatMessages>[2],
  ): void => {
    dispatch({ chatId, options, type: "update-chat-messages", updater });
  },
});

interface ResearchDomRefActions {
  readonly focusInput: () => void;
  readonly scrollToLatest: () => void;
  readonly setChatScrollElement: React.RefCallback<HTMLDivElement>;
  readonly setInputElement: React.RefCallback<HTMLTextAreaElement>;
}

interface ResearchHydrationRefActions {
  readonly consumeHandoffQuery: (query: string) => void;
  readonly isHandoffConsumed: (query: string) => boolean;
  readonly isHydrating: () => boolean;
  readonly markHydrated: () => void;
}

const useResearchDomRefActions = (): ResearchDomRefActions => {
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusInput = useCallback((): void => {
    inputRef.current?.focus();
  }, [inputRef]);
  const scrollToLatest = useCallback((): void => {
    const element = chatScrollRef.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, [chatScrollRef]);
  const setChatScrollElement = useCallback<React.RefCallback<HTMLDivElement>>(
    (element) => {
      chatScrollRef.current = element;
    },
    [chatScrollRef],
  );
  const setInputElement = useCallback<React.RefCallback<HTMLTextAreaElement>>(
    (element) => {
      inputRef.current = element;
    },
    [inputRef],
  );
  return {
    focusInput,
    scrollToLatest,
    setChatScrollElement,
    setInputElement,
  };
};

const useResearchHydrationRefActions = (): ResearchHydrationRefActions => {
  const consumedHandoffQueryRef = useRef<string | undefined>(void 0);
  const isHydratingRef = useRef(true);
  const consumeHandoffQuery = useCallback((query: string): void => {
    consumedHandoffQueryRef.current = query;
  }, [consumedHandoffQueryRef]);
  const isHandoffConsumed = useCallback(
    (query: string): boolean => consumedHandoffQueryRef.current === query,
    [consumedHandoffQueryRef],
  );
  const isHydrating = useCallback((): boolean => isHydratingRef.current, [isHydratingRef]);
  const markHydrated = useCallback((): void => {
    isHydratingRef.current = false;
  }, [isHydratingRef]);
  return { consumeHandoffQuery, isHandoffConsumed, isHydrating, markHydrated };
};

const useResearchRefActions = (): ResearchDomRefActions & ResearchHydrationRefActions => {
  const domActions = useResearchDomRefActions();
  const hydrationActions = useResearchHydrationRefActions();
  return {
    consumeHandoffQuery: hydrationActions.consumeHandoffQuery,
    focusInput: domActions.focusInput,
    isHandoffConsumed: hydrationActions.isHandoffConsumed,
    isHydrating: hydrationActions.isHydrating,
    markHydrated: hydrationActions.markHydrated,
    scrollToLatest: domActions.scrollToLatest,
    setChatScrollElement: domActions.setChatScrollElement,
    setInputElement: domActions.setInputElement,
  };
};

const getActiveMessages = (state: Readonly<ResearchState>): readonly Message[] => {
  if (state.activeChatId === null) {
    return [];
  }
  return [...(state.chatMessagesMap[state.activeChatId] ?? [])];
};

const getActiveAssistantVersions = (
  state: Readonly<ResearchState>,
): Readonly<Record<string, string>> => {
  if (state.activeChatId === null) {
    return {};
  }
  return state.activeAssistantVersionMap[state.activeChatId] ?? {};
};

const useResearchChatState = (): ResearchChatState => {
  const [state, dispatch] = useReducer(researchReducer, undefined, createInitialResearchState);
  const dispatchActions = useMemo(
    () => ({ ...createChatDispatchActions(dispatch), ...createViewDispatchActions(dispatch) }),
    [dispatch],
  );
  const refActions = useResearchRefActions();
  const messages = useMemo(() => getActiveMessages(state), [state]);
  const activeAssistantVersions = useMemo(() => getActiveAssistantVersions(state), [state]);
  const conversationMessages = useMemo(
    () => [...getVisibleConversationMessages(messages, activeAssistantVersions)],
    [activeAssistantVersions, messages],
  );
  return {
    ...state,
    ...dispatchActions,
    ...refActions,
    activeAssistantVersions,
    conversationMessages,
    messages,
  };
};

export { useResearchChatState };
export type { ResearchChatState, ResearchStateSetter };
