import { hasText } from "@/lib/utils";
import {
  CHAT_STORAGE_KEY,
  CHAT_STORAGE_VERSION,
  getHydratedChatId,
  parsePersistedChatState,
  reviveStoredChatMessages,
  serializeChatMessages,
} from "../state/persistence";
import type { StoredChatState } from "../model/types";
import { useEffect, useMemo } from "react";
import type { ResearchChatState } from "./research-chat-state";

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

const readPersistedResearchChats = (): StoredChatState | undefined => {
  try {
    const stored = globalThis.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!hasText(stored)) {
      return void 0;
    }
    return parsePersistedChatState(stored);
  } catch (error) {
    console.warn("Failed to read chat history", error);
    return void 0;
  }
};

const hydrateResearchChats = (context: Readonly<ResearchHydrationContext>): void => {
  const parsed = readPersistedResearchChats();
  if (parsed !== undefined) {
    const revivedMessages = reviveStoredChatMessages(parsed.messages);
    context.setChats(parsed.chats.map((chat) => ({ ...chat })));
    context.setChatMessagesMap(revivedMessages);
    context.setActiveAssistantVersionMap(parsed.activeAssistantVersionMap ?? {});
    const targetChatId = getHydratedChatId(parsed, revivedMessages);
    if (targetChatId !== null) {
      context.setActiveChatId(targetChatId);
    }
  }
  globalThis.setTimeout(context.markHydrated, 0);
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

export { useResearchChatPersistence };
