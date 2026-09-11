import { getMessageVersionGroupId } from "@/lib/chat-branching";
import type { Message, StartResearchParameters } from "../model/types";
import type { ResearchChatState } from "./research-chat-state";
import type { ResearchStreamActions } from "./use-research-transport";
import type { SubmitPromptParameters } from "./use-research-prompt";

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

const deleteMessage = (state: ResearchChatState, messageId: string): void => {
  if (state.isSearching || state.activeChatId === null) {
    return;
  }
  if (state.editingMessageId === messageId) {
    state.clearMessageEditing();
  }
  state.updateChatMessages(state.activeChatId, (previous) =>
    previous.filter((message) => message.id !== messageId),
  );
};

const editMessage = (state: ResearchChatState, messageId: string): void => {
  if (state.isSearching) {
    return;
  }
  const target = state.messages.find((message) => message.id === messageId);
  if (target?.type !== "user") {
    return;
  }
  state.setEditingMessageId(messageId);
  state.setEditingDraft(target.content);
};

const saveEditedMessage = async (
  state: ResearchChatState,
  submitPrompt: ResearchMessageActionsContext["submitPrompt"],
): Promise<void> => {
  if (state.editingMessageId === null || state.editingMessageId.length === 0) {
    return;
  }
  await submitPrompt({ editingTargetId: state.editingMessageId, prompt: state.editingDraft });
};

interface RetryContext {
  readonly targetAssistant: Message;
  readonly retryUserMessage: Message;
}

const findRetryContext = (
  state: ResearchChatState,
  assistantMessageId: string,
): RetryContext | undefined => {
  if (state.isSearching || state.activeChatId === null) {
    return void 0;
  }
  const visibleAssistantIndex = state.conversationMessages.findIndex(
    (message) => message.id === assistantMessageId,
  );
  const targetAssistant = state.messages.find((message) => message.id === assistantMessageId);
  if (visibleAssistantIndex <= 0 || targetAssistant?.type !== "assistant") {
    return void 0;
  }
  const retryUserMessage = state.conversationMessages
    .slice(0, visibleAssistantIndex)
    .toReversed()
    .find((message) => message.type === "user");
  if (retryUserMessage === undefined || retryUserMessage.content.trim().length === 0) {
    return void 0;
  }
  return { retryUserMessage, targetAssistant };
};

const createRetryParameters = (
  state: ResearchChatState,
  assistantMessageId: string,
): StartResearchParameters | undefined => {
  const retryContext = findRetryContext(state, assistantMessageId);
  if (retryContext === undefined || state.activeChatId === null) {
    return void 0;
  }
  return {
    chatId: state.activeChatId,
    parentMessageId: retryContext.retryUserMessage.id,
    prompt: retryContext.retryUserMessage.content,
    retryGroupId: getMessageVersionGroupId(retryContext.targetAssistant),
    seedMessages: state.messages,
  };
};

const useResearchMessageMutationActions = (
  context: Readonly<ResearchMessageActionsContext>,
): Pick<
  ResearchMessageActions,
  "handleCancelEditMessage" | "handleDeleteMessage" | "handleEditMessage" | "handleSaveEditedMessage"
> => ({
  handleCancelEditMessage: context.state.clearMessageEditing,
  handleDeleteMessage: (messageId) => {
    deleteMessage(context.state, messageId);
  },
  handleEditMessage: (messageId) => {
    editMessage(context.state, messageId);
  },
  handleSaveEditedMessage: () => saveEditedMessage(context.state, context.submitPrompt),
});

const useResearchMessageRevisionActions = (
  context: Readonly<ResearchMessageActionsContext>,
): Pick<ResearchMessageActions, "handleResetMessage" | "handleSelectMessageVersion"> => ({
  handleResetMessage: async (assistantMessageId) => {
    const parameters = createRetryParameters(context.state, assistantMessageId);
    if (parameters !== undefined) {
      await context.startResearch(parameters);
    }
  },
  handleSelectMessageVersion: (groupId, messageId) => {
    if (context.state.activeChatId !== null) {
      context.state.setActiveAssistantVersion(context.state.activeChatId, groupId, messageId);
    }
  },
});

const useResearchMessageSearchActions = (
  context: Readonly<ResearchMessageActionsContext>,
): Pick<ResearchMessageActions, "handleSampleQuery" | "handleSearch"> => ({
  handleSampleQuery: (sampleQuery) => {
    context.state.clearMessageEditing();
    context.state.setQuery(sampleQuery);
    context.state.focusInput();
  },
  handleSearch: () => context.submitPrompt({ clearComposer: true, prompt: context.state.query }),
});

const handleCopyMessage = async (content: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(content);
  } catch (error) {
    console.error("Failed to copy message:", error);
  }
};

const useResearchMessageActions = (
  context: Readonly<ResearchMessageActionsContext>,
): ResearchMessageActions => ({
  handleCopyMessage,
  ...useResearchMessageMutationActions(context),
  ...useResearchMessageRevisionActions(context),
  ...useResearchMessageSearchActions(context),
});

export { useResearchMessageActions };
export type { ResearchMessageActions };
