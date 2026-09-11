import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useResearchChatActions } from "./use-research-chat-actions";
import { useResearchChatPersistence } from "./use-research-chat-persistence";
import { useResearchChatState } from "./research-chat-state";
import { useResearchDerivedState } from "./use-research-derived-state";
import { useResearchMessageActions } from "./use-research-message-actions";
import { useResearchPromptSubmission } from "./use-research-prompt";
import { useResearchTransport } from "./use-research-transport";
import { createResearchPageViewProps } from "./research-page-view-props";

interface ResearchHandoffContext {
  readonly state: ReturnType<typeof useResearchChatState>;
  readonly handoffQuery: string;
  readonly replace: (href: string) => void;
  readonly submitPrompt: ReturnType<typeof useResearchPromptSubmission>;
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
};

const useResearchHandoff = (context: Readonly<ResearchHandoffContext>): void => {
  const { state, handoffQuery, replace, submitPrompt } = context;
  const { consumeHandoffQuery, isHandoffConsumed, isHydrating, isSearching, setQuery } = state;

  useEffect(() => {
    if (isHydrating() || isSearching || !handoffQuery || isHandoffConsumed(handoffQuery)) {
      return;
    }
    consumeHandoffQuery(handoffQuery);
    setQuery(handoffQuery);
    void submitPrompt({ clearComposer: true, forceNewChat: true, prompt: handoffQuery });
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

const getResearchNavigation = (services: NewsResearchPageServices) => ({
  handoffQuery: services.getSearchParams().get("query")?.trim() ?? "",
  replace: services.getRouter().replace,
});

const useResearchPageController = (services: NewsResearchPageServices) => {
  const { handoffQuery, replace } = getResearchNavigation(services);
  const chatState = useResearchChatState();
  const transport = useResearchTransport({
    activeAssistantVersionMap: chatState.activeAssistantVersionMap,
    activeChatId: chatState.activeChatId,
    chats: chatState.chats,
    focusInput: chatState.focusInput,
    setActiveAssistantVersion: chatState.setActiveAssistantVersion,
    setIsSearching: chatState.setIsSearching,
    updateChatMessages: chatState.updateChatMessages,
  });
  const actions = useResearchChatActions(chatState, transport);
  useResearchChatPersistence(chatState);
  const derivedState = useResearchDerivedState(chatState);
  const submitPrompt = useResearchPromptSubmission({
    startResearch: transport.startResearch,
    state: chatState,
  });
  useResearchHandoff({ handoffQuery, replace, state: chatState, submitPrompt });
  const messageActions = useResearchMessageActions({
    startResearch: transport.startResearch,
    state: chatState,
    submitPrompt,
  });
  return createResearchPageViewProps({ actions, chatState, derivedState, messageActions });
};

export { DEFAULT_NEWS_RESEARCH_PAGE_SERVICES, useResearchPageController };
export type { NewsResearchPageServices };
