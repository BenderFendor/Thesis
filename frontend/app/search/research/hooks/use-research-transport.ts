import { hasText } from "@/lib/utils";
import type {
  Message,
  ReadonlyChatSummary,
  ReadonlyThinkingStep,
  ResearchStreamContext,
  ResearchStreamState,
  StartResearchParameters,
  StructuredArticlesPayload,
  UpdateChatMessages,
} from "../model/types";
import {
  buildChatHistoryPayload,
  buildResearchStreamUrl,
  startSemanticResearch,
} from "../stream/research-stream";
import { getMessageVersionGroupId, getVisibleConversationMessages } from "@/lib/chat-branching";
import { installResearchStallTimeout, runResearchStream } from "../stream/protocol";
import { useCallback, useEffect, useRef } from "react";

interface ResearchStreamActions {
  readonly startResearch: (parameters: StartResearchParameters) => Promise<void>;
  readonly stopResearch: () => void;
}

interface ResearchTransportContext {
  readonly activeAssistantVersionMap: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly activeChatId: string | null;
  readonly chats: readonly ReadonlyChatSummary[];
  readonly focusInput: () => void;
  readonly setActiveAssistantVersion: (chatId: string, groupId: string, messageId: string) => void;
  readonly setIsSearching: (value: boolean) => void;
  readonly updateChatMessages: UpdateChatMessages;
}

interface ResearchStartPlan {
  readonly assistantGroupId: string;
  readonly assistantId: string;
  readonly historyPayload: ReturnType<typeof buildChatHistoryPayload>;
  readonly promptQuery: string;
  readonly semanticToolId: string;
  readonly visibleHistoryMessages: readonly Message[];
}

const prepareResearchStart = (
  parameters: Readonly<StartResearchParameters>,
  activeAssistantVersions: Readonly<Record<string, Readonly<Record<string, string>>>>,
): ResearchStartPlan => {
  const { chatId, prompt, retryGroupId, seedMessages, versionSelectionOverrides } = parameters;
  const versionSelections = {
    ...activeAssistantVersions[chatId],
    ...versionSelectionOverrides,
  };
  const visibleHistoryMessages = getVisibleConversationMessages(
    seedMessages,
    versionSelections,
  ).filter(
    (message) =>
      !hasText(retryGroupId) ||
      message.type !== "assistant" ||
      getMessageVersionGroupId(message) !== retryGroupId,
  );
  const timestamp = Date.now();
  const assistantId = `assistant-${timestamp}`;
  return {
    assistantGroupId: retryGroupId ?? assistantId,
    assistantId,
    historyPayload: buildChatHistoryPayload(visibleHistoryMessages),
    promptQuery: `${prompt}

Provide a concise answer with detailed well-written prose based on the sources you have searched cited them when needed.`,
    semanticToolId: `semantic-${timestamp}`,
    visibleHistoryMessages,
  };
};

const createStreamingPlaceholder = (
  parameters: Readonly<StartResearchParameters>,
  plan: Readonly<ResearchStartPlan>,
  chats: readonly ReadonlyChatSummary[],
): Message => {
  const currentChatTitle =
    parameters.newChatTitle ?? chats.find((chat) => chat.id === parameters.chatId)?.title;
  return {
    content: (() => {
  if (hasText(currentChatTitle)) {
    return `Topic: ${currentChatTitle}`;
  }
  return "";
})(),
    id: plan.assistantId,
    isStreaming: true,
    parentMessageId: parameters.parentMessageId,
    retryOfMessageId: parameters.retryGroupId,
    streamingStatus: "Starting research...",
    timestamp: new Date(),
    type: "assistant",
  };
};

const createResearchStreamState = (): ResearchStreamState => {
  let clearStallTimeout = (): void => {};
  let structuredArticles: StructuredArticlesPayload | undefined = undefined;
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
};

const createResearchStreamContext = (
  parameters: Readonly<StartResearchParameters>,
  plan: Readonly<ResearchStartPlan>,
  context: Pick<
    ResearchTransportContext,
    "focusInput" | "setActiveAssistantVersion" | "setIsSearching" | "updateChatMessages"
  > & { readonly isCurrentRequest: () => boolean },
): ResearchStreamContext => ({
  assistantGroupId: plan.assistantGroupId,
  assistantId: plan.assistantId,
  chatId: parameters.chatId,
  focusInput: context.focusInput,
  isCurrentRequest: context.isCurrentRequest,
  retryGroupId: parameters.retryGroupId,
  setActiveAssistantVersion: context.setActiveAssistantVersion,
  setIsSearching: context.setIsSearching,
  streamState: createResearchStreamState(),
  updateChatMessages: context.updateChatMessages,
});

interface AbortControllerState {
  readonly get: () => AbortController | undefined;
  readonly set: (controller: AbortController | undefined) => void;
}

interface ResearchRequest {
  readonly abortController: AbortController;
  readonly plan: ResearchStartPlan;
  readonly streamingPlaceholder: Message;
  readonly streamContext: ResearchStreamContext;
}

type ResearchRequestDependencies = Pick<
  ResearchTransportContext,
  "focusInput" | "setActiveAssistantVersion" | "setIsSearching" | "updateChatMessages"
>;

const createResearchRequest = (
  parameters: Readonly<StartResearchParameters>,
  activeAssistantVersionMap: Readonly<ResearchTransportContext["activeAssistantVersionMap"]>,
  chats: readonly ReadonlyChatSummary[],
  abortControllerState: Readonly<AbortControllerState>,
  context: Readonly<ResearchRequestDependencies>,
): ResearchRequest => {
  const plan = prepareResearchStart(parameters, activeAssistantVersionMap);
  const streamingPlaceholder = createStreamingPlaceholder(parameters, plan, chats);
  abortControllerState.get()?.abort();
  const abortController = new AbortController();
  abortControllerState.set(abortController);
  const streamContext = createResearchStreamContext(parameters, plan, {
    ...context,
    isCurrentRequest: () => abortControllerState.get() === abortController,
  });
  return { abortController, plan, streamContext, streamingPlaceholder };
};

interface ResearchStartDependencies extends ResearchRequestDependencies {
  readonly activeAssistantVersionMap: ResearchTransportContext["activeAssistantVersionMap"];
  readonly chats: ResearchTransportContext["chats"];
}

const runResearchRequest = async (
  parameters: Readonly<StartResearchParameters>,
  context: Readonly<ResearchStartDependencies>,
  abortControllerState: Readonly<AbortControllerState>,
): Promise<void> => {
  const { abortController, plan, streamContext, streamingPlaceholder } = createResearchRequest(
    parameters,
    context.activeAssistantVersionMap,
    context.chats,
    abortControllerState,
    context,
  );
  context.setIsSearching(true);
  context.setActiveAssistantVersion(parameters.chatId, plan.assistantGroupId, plan.assistantId);
  context.updateChatMessages(parameters.chatId, (messages) => [...messages, streamingPlaceholder], {
    syncSummary: false,
  });
  void startSemanticResearch({
    assistantId: plan.assistantId,
    chatId: parameters.chatId,
    prompt: parameters.prompt,
    retryGroupId: parameters.retryGroupId,
    semanticToolId: plan.semanticToolId,
    updateChatMessages: context.updateChatMessages,
  });
  const stallTimeout = installResearchStallTimeout(streamContext);
  try {
    await runResearchStream(
      buildResearchStreamUrl(plan.promptQuery, plan.historyPayload),
      abortController,
      stallTimeout,
      streamContext,
    );
  } finally {
    if (abortControllerState.get() === abortController) {
      abortControllerState.set(undefined);
    }
  }
};

const cancelStreamingMessage = (message: Message): Message => {
  if (message.isStreaming !== true) {
    return message;
  }
  return {
    ...message,
    content: message.content || "Research cancelled.",
    isStreaming: false,
    streamingStatus: undefined,
  };
};

const useResearchStop = (
  activeChatId: string | null,
  setIsSearching: (value: boolean) => void,
  updateChatMessages: UpdateChatMessages,
  abortControllerState: Readonly<AbortControllerState>,
): (() => void) =>
  useCallback(() => {
    abortControllerState.get()?.abort();
    abortControllerState.set(undefined);
    if (activeChatId === null) {
      return;
    }
    setIsSearching(false);
    updateChatMessages(
      activeChatId,
      (previous) => previous.map((message) => cancelStreamingMessage(message)),
      { syncSummary: false },
    );
  }, [abortControllerState, activeChatId, setIsSearching, updateChatMessages]);

const useResearchAbortCleanup = (
  abortControllerState: Readonly<AbortControllerState>,
): void => {
  useEffect(
    () => () => {
      abortControllerState.get()?.abort();
      abortControllerState.set(undefined);
    },
    [abortControllerState],
  );
};

const useResearchStart = (
  context: Readonly<ResearchStartDependencies>,
  abortControllerState: Readonly<AbortControllerState>,
): ResearchStreamActions["startResearch"] =>
  useCallback(
    (parameters: StartResearchParameters) =>
      runResearchRequest(parameters, context, abortControllerState),
    [abortControllerState, context],
  );

const useResearchTransport = (
  context: Readonly<ResearchTransportContext>,
): ResearchStreamActions => {
  const abortControllerRef = useRef<AbortController | undefined>(void 0);
  const abortControllerState: AbortControllerState = {
    get: () => abortControllerRef.current,
    set: (controller) => {
      abortControllerRef.current = controller;
    },
  };
  const stopResearch = useResearchStop(
    context.activeChatId,
    context.setIsSearching,
    context.updateChatMessages,
    abortControllerState,
  );
  useResearchAbortCleanup(abortControllerState);
  const startResearch = useResearchStart(context, abortControllerState);
  return { startResearch, stopResearch };
};
export { useResearchTransport };
export type { ResearchStreamActions };
