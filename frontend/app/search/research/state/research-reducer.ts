import type { ChatMessageUpdateOptions, Message, ReadonlyNewsArticle } from "../model/types";
import type { ChatSummary } from "@/components/chat-sidebar";

const CHAT_PREVIEW_MAX_LENGTH = 120;

type ResearchChats = readonly Readonly<ChatSummary>[];
type ResearchChatMessagesMap = Readonly<Record<string, readonly Message[]>>;
type ResearchAssistantVersionMap = Readonly<Record<string, Readonly<Record<string, string>>>>;

interface ResearchState {
  readonly query: string;
  readonly isSearching: boolean;
  readonly selectedArticle: ReadonlyNewsArticle | null;
  readonly isArticleModalOpen: boolean;
  readonly chats: ResearchChats;
  readonly chatMessagesMap: ResearchChatMessagesMap;
  readonly activeAssistantVersionMap: ResearchAssistantVersionMap;
  readonly activeChatId: string | null;
  readonly editingMessageId: string | null;
  readonly editingDraft: string;
  readonly sidebarCollapsed: boolean;
  readonly expandedStepMessageIds: ReadonlySet<string>;
  readonly expandedSourceIds: ReadonlySet<string>;
}

type StateValue<Value> = Value | ((previous: Value) => Value);

type ResearchAction =
  | { readonly type: "set-query"; readonly value: string }
  | { readonly type: "set-searching"; readonly value: boolean }
  | { readonly type: "set-selected-article"; readonly value: ReadonlyNewsArticle | null }
  | { readonly type: "set-article-modal-open"; readonly value: boolean }
  | { readonly type: "set-chats"; readonly value: StateValue<ResearchChats> }
  | { readonly type: "set-chat-messages-map"; readonly value: StateValue<ResearchChatMessagesMap> }
  | {
      readonly type: "set-active-assistant-version-map";
      readonly value: StateValue<ResearchAssistantVersionMap>;
    }
  | { readonly type: "set-active-chat-id"; readonly value: StateValue<string | null> }
  | { readonly type: "set-editing-message-id"; readonly value: string | null }
  | { readonly type: "set-editing-draft"; readonly value: string }
  | { readonly type: "set-sidebar-collapsed"; readonly value: StateValue<boolean> }
  | {
      readonly type: "set-expanded-step-message-ids";
      readonly value: StateValue<ReadonlySet<string>>;
    }
  | { readonly type: "set-expanded-source-ids"; readonly value: StateValue<ReadonlySet<string>> }
  | {
      readonly type: "update-chat-messages";
      readonly chatId: string;
      readonly updater: (previous: readonly Readonly<Message>[]) => readonly Readonly<Message>[];
      readonly options?: Readonly<ChatMessageUpdateOptions>;
    }
  | {
      readonly type: "set-active-assistant-version";
      readonly chatId: string;
      readonly groupId: string;
      readonly messageId: string;
    }
  | { readonly type: "clear-message-editing" }
  | { readonly type: "toggle-step-visibility"; readonly messageId: string }
  | { readonly type: "toggle-source-visibility"; readonly sourceId: string };

function isStateUpdater<Value>(value: StateValue<Value>): value is (previous: Value) => Value {
  return typeof value === "function";
}

function resolveStateValue<Value>(value: StateValue<Value>, previous: Value): Value {
  if (isStateUpdater(value)) {
    return value(previous);
  }
  return value;
}

const getChatPreview = (items: readonly Message[]): string => {
  const latest = items
    .toReversed()
    .find((message) => !message.toolType && message.content.trim().length > 0);
  return latest?.content.slice(0, CHAT_PREVIEW_MAX_LENGTH) ?? "";
};

const updateChatSummary = (
  chats: readonly Readonly<ChatSummary>[],
  chatId: string,
  messages: readonly Message[],
  options?: Readonly<ChatMessageUpdateOptions>,
): readonly Readonly<ChatSummary>[] => {
  const updatedAt = options?.updatedAt ?? new Date().toISOString();
  const lastMessage = options?.summaryPreview ?? getChatPreview(messages);
  return chats.map((chat) => {
    if (chat.id !== chatId) {
      return chat;
    }
    let title = chat.title;
    const question = messages.find((message) => message.type === "user")?.content.trim() ?? "";
    if (title === "Untitled research" && question.length > 0) {
      title = question.slice(0, 60);
    }
    return { ...chat, lastMessage, title, updatedAt };
  });
};

const DIRECT_STATE_ACTION_TYPES = [
  "set-query",
  "set-searching",
  "set-selected-article",
  "set-article-modal-open",
  "set-editing-message-id",
  "set-editing-draft",
  "clear-message-editing",
] as const satisfies readonly ResearchAction["type"][];
const CHAT_STATE_ACTION_TYPES = [
  "set-chats",
  "set-chat-messages-map",
  "set-active-assistant-version-map",
  "set-active-chat-id",
] as const satisfies readonly ResearchAction["type"][];
const VIEW_STATE_ACTION_TYPES = [
  "set-sidebar-collapsed",
  "set-expanded-step-message-ids",
  "set-expanded-source-ids",
] as const satisfies readonly ResearchAction["type"][];
const VISIBILITY_ACTION_TYPES = [
  "toggle-step-visibility",
  "toggle-source-visibility",
] as const satisfies readonly ResearchAction["type"][];

type DirectStateAction = Extract<
  ResearchAction,
  { readonly type: (typeof DIRECT_STATE_ACTION_TYPES)[number] }
>;
type ChatStateAction = Extract<
  ResearchAction,
  { readonly type: (typeof CHAT_STATE_ACTION_TYPES)[number] }
>;
type ViewStateAction = Extract<
  ResearchAction,
  {
    readonly type: (typeof VIEW_STATE_ACTION_TYPES)[number];
  }
>;
type ChatMessagesAction = Extract<ResearchAction, { readonly type: "update-chat-messages" }>;
type AssistantVersionAction = Extract<
  ResearchAction,
  {
    readonly type: "set-active-assistant-version";
  }
>;
type VisibilityAction = Extract<
  ResearchAction,
  {
    readonly type: (typeof VISIBILITY_ACTION_TYPES)[number];
  }
>;

function isActionType<ActionTypes extends readonly ResearchAction["type"][]>(
  action: ResearchAction,
  types: ActionTypes,
): action is Extract<ResearchAction, { readonly type: ActionTypes[number] }> {
  return types.some((candidate) => candidate === action.type);
}

const isDirectStateAction = (action: ResearchAction): action is DirectStateAction =>
  isActionType(action, DIRECT_STATE_ACTION_TYPES);
const isChatStateAction = (action: ResearchAction): action is ChatStateAction =>
  isActionType(action, CHAT_STATE_ACTION_TYPES);
const isViewStateAction = (action: ResearchAction): action is ViewStateAction =>
  isActionType(action, VIEW_STATE_ACTION_TYPES);
const isVisibilityAction = (action: ResearchAction): action is VisibilityAction =>
  isActionType(action, VISIBILITY_ACTION_TYPES);

const reduceDirectStateAction = (
  state: ResearchState,
  action: DirectStateAction,
): ResearchState => {
  switch (action.type) {
    case "set-query": {
      return { ...state, query: action.value };
    }
    case "set-searching": {
      return { ...state, isSearching: action.value };
    }
    case "set-selected-article": {
      return { ...state, selectedArticle: action.value };
    }
    case "set-article-modal-open": {
      return { ...state, isArticleModalOpen: action.value };
    }
    case "set-editing-message-id": {
      return { ...state, editingMessageId: action.value };
    }
    case "set-editing-draft": {
      return { ...state, editingDraft: action.value };
    }
    case "clear-message-editing": {
      return { ...state, editingDraft: "", editingMessageId: null };
    }
    default: {
      return state;
    }
  }
};

const reduceChatStateAction = (state: ResearchState, action: ChatStateAction): ResearchState => {
  switch (action.type) {
    case "set-chats": {
      return { ...state, chats: resolveStateValue(action.value, state.chats) };
    }
    case "set-chat-messages-map": {
      return {
        ...state,
        chatMessagesMap: resolveStateValue(action.value, state.chatMessagesMap),
      };
    }
    case "set-active-assistant-version-map": {
      return {
        ...state,
        activeAssistantVersionMap: resolveStateValue(action.value, state.activeAssistantVersionMap),
      };
    }
    case "set-active-chat-id": {
      return { ...state, activeChatId: resolveStateValue(action.value, state.activeChatId) };
    }
    default: {
      return state;
    }
  }
};

const reduceViewStateAction = (state: ResearchState, action: ViewStateAction): ResearchState => {
  switch (action.type) {
    case "set-sidebar-collapsed": {
      return {
        ...state,
        sidebarCollapsed: resolveStateValue(action.value, state.sidebarCollapsed),
      };
    }
    case "set-expanded-step-message-ids": {
      return {
        ...state,
        expandedStepMessageIds: resolveStateValue(action.value, state.expandedStepMessageIds),
      };
    }
    case "set-expanded-source-ids": {
      return {
        ...state,
        expandedSourceIds: resolveStateValue(action.value, state.expandedSourceIds),
      };
    }
    default: {
      return state;
    }
  }
};

const reduceChatMessagesAction = (
  state: ResearchState,
  action: ChatMessagesAction,
): ResearchState => {
  const current = state.chatMessagesMap[action.chatId] ?? [];
  const nextMessages = action.updater(current);
  if (nextMessages === current) {
    return state;
  }
  const chatMessagesMap = {
    ...state.chatMessagesMap,
    [action.chatId]: nextMessages,
  };
  if (action.options?.syncSummary === false) {
    return { ...state, chatMessagesMap };
  }
  return {
    ...state,
    chatMessagesMap,
    chats: updateChatSummary(state.chats, action.chatId, nextMessages, action.options),
  };
};

const reduceAssistantVersionAction = (
  state: ResearchState,
  action: AssistantVersionAction,
): ResearchState => ({
  ...state,
  activeAssistantVersionMap: {
    ...state.activeAssistantVersionMap,
    [action.chatId]: {
      ...state.activeAssistantVersionMap[action.chatId],
      [action.groupId]: action.messageId,
    },
  },
});

const toggleSetValue = (values: ReadonlySet<string>, value: string): ReadonlySet<string> => {
  const nextValues = new Set(values);
  if (nextValues.has(value)) {
    nextValues.delete(value);
  } else {
    nextValues.add(value);
  }
  return nextValues;
};

const reduceVisibilityAction = (state: ResearchState, action: VisibilityAction): ResearchState => {
  switch (action.type) {
    case "toggle-step-visibility": {
      return {
        ...state,
        expandedStepMessageIds: toggleSetValue(state.expandedStepMessageIds, action.messageId),
      };
    }
    case "toggle-source-visibility": {
      return {
        ...state,
        expandedSourceIds: toggleSetValue(state.expandedSourceIds, action.sourceId),
      };
    }
    default: {
      return state;
    }
  }
};

const reduceOtherAction = (state: ResearchState, action: ResearchAction): ResearchState => {
  if (action.type === "update-chat-messages") {
    return reduceChatMessagesAction(state, action);
  }
  if (action.type === "set-active-assistant-version") {
    return reduceAssistantVersionAction(state, action);
  }
  if (isVisibilityAction(action)) {
    return reduceVisibilityAction(state, action);
  }
  return state;
};

const createInitialResearchState = (): ResearchState => ({
  activeAssistantVersionMap: {},
  activeChatId: null,
  chatMessagesMap: {},
  chats: [],
  editingDraft: "",
  editingMessageId: null,
  expandedSourceIds: new Set(),
  expandedStepMessageIds: new Set(),
  isArticleModalOpen: false,
  isSearching: false,
  query: "",
  selectedArticle: null,
  sidebarCollapsed: true,
});

const researchReducer = (state: ResearchState, action: ResearchAction): ResearchState => {
  if (isDirectStateAction(action)) {
    return reduceDirectStateAction(state, action);
  }
  if (isChatStateAction(action)) {
    return reduceChatStateAction(state, action);
  }
  if (isViewStateAction(action)) {
    return reduceViewStateAction(state, action);
  }
  return reduceOtherAction(state, action);
};

export { createInitialResearchState, researchReducer, type ResearchState, type StateValue };
