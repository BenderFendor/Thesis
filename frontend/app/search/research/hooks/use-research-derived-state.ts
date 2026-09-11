import { useCallback, useEffect, useMemo } from "react";
import type { Message, ReadonlyNewsArticle } from "../model/types";
import {
  getActiveBriefTitle,
  selectLatestResearchMessages,
  selectResearchArticleData,
} from "../state/selectors";
import type { SourceGroup } from "../state/selectors";
import type { ResearchChatState } from "./research-chat-state";

interface ResearchDerivedState {
  readonly activeBriefTitle: string;
  readonly groupedSources: readonly SourceGroup[];
  readonly isEmpty: boolean;
  readonly latestAssistantMessage: Message | undefined;
  readonly latestSemanticMessage: Message | undefined;
  readonly latestUserMessage: Message | undefined;
  readonly relatedArticles: readonly ReadonlyNewsArticle[];
  readonly thinkingSteps: NonNullable<Message["thinking_steps"]>;
  readonly handleCloseArticle: () => void;
  readonly handleOpenArticle: (article: ReadonlyNewsArticle) => void;
}

const useResearchScrollEffect = (
  conversationMessages: readonly Message[],
  latestAssistantMessage: Message | undefined,
  scrollToLatest: () => void,
): void => {
  useEffect(() => {
    if (conversationMessages.length > 0 || latestAssistantMessage !== undefined) {
      scrollToLatest();
    }
  }, [conversationMessages, latestAssistantMessage, scrollToLatest]);
};

const useResearchDerivedState = (
  context: Readonly<ResearchChatState>,
): ResearchDerivedState => {
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

  useResearchScrollEffect(conversationMessages, latestAssistantMessage, scrollToLatest);

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

export { useResearchDerivedState };
export type { ResearchDerivedState };
