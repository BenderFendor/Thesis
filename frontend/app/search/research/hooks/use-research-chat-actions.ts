import type { ChatSummary } from "@/components/chat-sidebar";
import type { ResearchStreamActions } from "./use-research-transport";
import type { ResearchChatState, ResearchStateSetter } from "./research-chat-state";

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

interface ChatActionContext {
  readonly activeChatId: string | null;
  readonly chats: ResearchChatState["chats"];
  readonly clearMessageEditing: () => void;
  readonly setActiveAssistantVersionMap: ResearchChatState["setActiveAssistantVersionMap"];
  readonly setActiveChatId: ResearchChatState["setActiveChatId"];
  readonly setChatMessagesMap: ResearchChatState["setChatMessagesMap"];
  readonly setChats: ResearchChatState["setChats"];
}

const createNewChatHandler = (
  context: Readonly<ChatActionContext>,
  transport: Readonly<ResearchStreamActions>,
): (() => void) => () => {
  const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const newChat: ChatSummary = {
    id,
    lastMessage: "",
    title: "Untitled research",
    updatedAt: new Date().toISOString(),
  };
  transport.stopResearch();
  context.setChats((previous) => [newChat, ...previous]);
  context.setChatMessagesMap((previous) => ({ ...previous, [id]: [] }));
  context.setActiveAssistantVersionMap((previous) => ({ ...previous, [id]: {} }));
  context.setActiveChatId(id);
  context.clearMessageEditing();
};

const createDeleteChatHandler = (
  context: Readonly<ChatActionContext>,
): ((id: string) => void) => (id) => {
  const remainingChats = context.chats.filter((chat) => chat.id !== id);
  let nextChatId = context.activeChatId;
  if (context.activeChatId === id) {
    nextChatId = remainingChats[0]?.id ?? null;
  }
  context.setChats(remainingChats);
  context.setChatMessagesMap((previous) => {
    const next = { ...previous };
    delete next[id];
    return next;
  });
  context.clearMessageEditing();
  if (context.activeChatId === id) {
    context.setActiveChatId(nextChatId);
  }
};

const createDeleteChatsHandler = (
  context: Readonly<ChatActionContext>,
): ((ids: readonly string[]) => void) => (ids) => {
  const remainingChats = context.chats.filter((chat) => !ids.includes(chat.id));
  let nextChatId = context.activeChatId;
  if (context.activeChatId !== null && ids.includes(context.activeChatId)) {
    nextChatId = remainingChats[0]?.id ?? null;
  }
  context.setChats(remainingChats);
  context.setChatMessagesMap((previous) => {
    const next = { ...previous };
    ids.forEach((id) => {
      delete next[id];
    });
    return next;
  });
  context.clearMessageEditing();
  if (context.activeChatId !== nextChatId) {
    context.setActiveChatId(nextChatId);
  }
};

const toggleSetValue = (
  setValue: ResearchStateSetter<ReadonlySet<string>>,
  value: string,
): void => {
  setValue((previous) => {
    const next = new Set(previous);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    return next;
  });
};

const renameChat = (
  chats: readonly ChatSummary[],
  id: string,
  title: string,
): readonly ChatSummary[] =>
  chats.map((chat) => {
    if (chat.id === id) {
      return { ...chat, title };
    }
    return chat;
  });

const useResearchChatActions = (
  state: Readonly<ResearchChatState>,
  transport: Readonly<ResearchStreamActions>,
): ResearchChatActions => {
  const context: ChatActionContext = {
    activeChatId: state.activeChatId,
    chats: state.chats,
    clearMessageEditing: state.clearMessageEditing,
    setActiveAssistantVersionMap: state.setActiveAssistantVersionMap,
    setActiveChatId: state.setActiveChatId,
    setChatMessagesMap: state.setChatMessagesMap,
    setChats: state.setChats,
  };
  return {
    handleDeleteChat: createDeleteChatHandler(context),
    handleDeleteChats: createDeleteChatsHandler(context),
    handleNewChat: createNewChatHandler(context, transport),
    handleRenameChat: (id: string, title: string) => {
      context.setChats((previous) => renameChat(previous, id, title));
    },
    handleSelectChat: (id: string) => {
      context.setActiveChatId(id);
      context.clearMessageEditing();
    },
    handleStop: transport.stopResearch,
    toggleSidebar: () => {
      state.setSidebarCollapsed((previous) => !previous);
    },
    toggleSourceVisibility: (sourceId: string) => {
      toggleSetValue(state.setExpandedSourceIds, sourceId);
    },
    toggleStepVisibility: (messageId: string) => {
      toggleSetValue(state.setExpandedStepMessageIds, messageId);
    },
  };
};

export { useResearchChatActions };
export type { ResearchChatActions };
