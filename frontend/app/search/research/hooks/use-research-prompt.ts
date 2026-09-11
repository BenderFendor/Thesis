import { getMessageVersionGroupId } from "@/lib/chat-branching";
import { hasText } from "@/lib/utils";
import type { ChatSummary } from "@/components/chat-sidebar";
import { useCallback } from "react";
import type {
  Message,
  StartResearchParameters,
  UpdateChatMessages,
} from "../model/types";
import type { ResearchState } from "../state/research-reducer";
import type { ResearchStreamActions } from "./use-research-transport";
import type { ResearchChatState, ResearchStateSetter } from "./research-chat-state";

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

const NEW_CHAT_ID_LENGTH = 8;
const NEW_CHAT_ID_RADIX = 36;
const NEW_CHAT_ID_START = 2;
const NEW_CHAT_TITLE_WORD_COUNT = 4;
const CHAT_PREVIEW_MAX_LENGTH = 120;
const CHAT_TITLE_MAX_LENGTH = 60;
const PROMPT_PREVIEW_MAX_LENGTH = 200;

const buildNewChatSummary = (prompt: string): ChatSummary => {
  const firstSentence = (prompt.split(/[.\n]/u)[0] ?? "").trim();
  const firstWords = prompt.split(/\s+/u).slice(0, NEW_CHAT_TITLE_WORD_COUNT).join(" ");
  const title = (firstSentence || firstWords || "New Chat").slice(0, CHAT_TITLE_MAX_LENGTH);
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
  return conversationMessages[targetIndex - 1]?.id;
};

const getParentMessageId = (
  editingTarget: Readonly<Message> | undefined,
  latestVisibleMessage: Readonly<Message> | undefined,
  conversationMessages: readonly Message[],
): string | undefined => {
  if (editingTarget === undefined) {
    return latestVisibleMessage?.id;
  }
  return resolveEditedParentId(editingTarget, conversationMessages);
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
): Message => ({
  content: prompt,
  id: `user-${Date.now()}`,
  parentMessageId: getParentMessageId(editingTarget, latestVisibleMessage, conversationMessages),
  retryOfMessageId: getRetryMessageGroupId(editingTarget),
  timestamp: new Date(),
  type: "user",
});

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
): StartResearchParameters => {
  let versionSelectionOverrides: Record<string, string> | undefined = undefined;
  if (editingTarget?.type === "user") {
    versionSelectionOverrides = { [getMessageVersionGroupId(editingTarget)]: userMessage.id };
  }
  return {
    chatId: target.chatId,
    newChatTitle: target.newChatTitle,
    parentMessageId: userMessage.id,
    prompt,
    seedMessages: [...seedMessages],
    versionSelectionOverrides,
  };
};

interface PromptSubmission {
  readonly target: ResolvedChatTarget;
  readonly editingTarget: Message | undefined;
  readonly userMessage: Message;
  readonly seedMessages: readonly Message[];
}

const createPromptSubmission = (
  parameters: Readonly<SubmitPromptParameters>,
  prompt: string,
  context: Readonly<SubmitPromptContext>,
): PromptSubmission | undefined => {
  const target = resolveChatTarget(parameters, prompt, context);
  if (target.chatId === null) {
    return void 0;
  }
  const editingTarget = findEditingTarget(parameters, context);
  const userMessage = buildUserMessage(
    prompt,
    editingTarget,
    context.conversationMessages.at(-1),
    context.conversationMessages,
  );
  return {
    editingTarget,
    seedMessages: [...context.messages, userMessage],
    target: { chatId: target.chatId, newChatTitle: target.newChatTitle },
    userMessage,
  };
};

const submitResearchPrompt = async (
  parameters: Readonly<SubmitPromptParameters>,
  context: Readonly<SubmitPromptContext>,
): Promise<void> => {
  const prompt = parameters.prompt.trim();
  if (!prompt) {
    return;
  }
  const submission = createPromptSubmission(parameters, prompt, context);
  if (submission === undefined) {
    return;
  }
  appendPromptMessage(context, submission.target.chatId, submission.userMessage, prompt);
  applyPromptStateChanges(
    parameters,
    context,
    submission.target,
    submission.editingTarget,
    submission.userMessage,
  );
  await context.startResearch(
    createResearchStartParameters(
      submission.target,
      prompt,
      submission.userMessage,
      submission.seedMessages,
      submission.editingTarget,
    ),
  );
};

interface ResearchPromptSubmissionContext {
  readonly state: ResearchChatState;
  readonly startResearch: ResearchStreamActions["startResearch"];
}

const useResearchPromptSubmission = (
  context: Readonly<ResearchPromptSubmissionContext>,
): ((parameters: SubmitPromptParameters) => Promise<void>) => {
  const { state, startResearch } = context;
  const {
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

export { submitResearchPrompt, useResearchPromptSubmission };
export type { SubmitPromptParameters };
