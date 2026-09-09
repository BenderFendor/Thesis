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

const useResearchTransport = (
  context: Readonly<ResearchTransportContext>,
): ResearchStreamActions => {
  const {
    activeAssistantVersionMap,
    activeChatId,
    chats,
    focusInput,
    setActiveAssistantVersion,
    setIsSearching,
    updateChatMessages,
  } = context;
  const abortControllerRef = useRef<AbortController | undefined>(void 0);
  const stopResearch = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = undefined;
    if (activeChatId === null) {
      return;
    }
    setIsSearching(false);
    updateChatMessages(
      activeChatId,
      (previous) =>
        previous.map((message) =>
          (() => {
  if (message.isStreaming === true) {
    return {
      ...message,
      content: message.content || "Research cancelled.",
      isStreaming: false,
      streamingStatus: undefined
    };
  }
  return message;
})(),
        ),
      { syncSummary: false },
    );
  }, [activeChatId, setIsSearching, updateChatMessages]);
  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = undefined;
    },
    [],
  );
  const startResearch = useCallback(
    async (parameters: StartResearchParameters) => {
      const plan = prepareResearchStart(parameters, activeAssistantVersionMap);
      const streamingPlaceholder = createStreamingPlaceholder(parameters, plan, chats);
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const streamContext = createResearchStreamContext(parameters, plan, {
        focusInput,
        isCurrentRequest: () => abortControllerRef.current === abortController,
        setActiveAssistantVersion,
        setIsSearching,
        updateChatMessages,
      });
      setIsSearching(true);
      setActiveAssistantVersion(parameters.chatId, plan.assistantGroupId, plan.assistantId);
      updateChatMessages(parameters.chatId, (messages) => [...messages, streamingPlaceholder], {
        syncSummary: false,
      });
      void startSemanticResearch({
        assistantId: plan.assistantId,
        chatId: parameters.chatId,
        prompt: parameters.prompt,
        retryGroupId: parameters.retryGroupId,
        semanticToolId: plan.semanticToolId,
        updateChatMessages,
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
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = undefined;
        }
      }
    },
    [
      activeAssistantVersionMap,
      chats,
      focusInput,
      setActiveAssistantVersion,
      setIsSearching,
      updateChatMessages,
    ],
  );
  return { startResearch, stopResearch };
};
export { useResearchTransport };
export type { ResearchStreamActions };
