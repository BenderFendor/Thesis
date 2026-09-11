import type { Message, ReadonlyChatSummary, ReadonlyNewsArticle } from "../model/types";
import { buildArticleEmbeds, getArticleText } from "../model/articles";

const ARTICLE_SOURCE_FALLBACK = "Unknown";

interface SourceGroup {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly articles: readonly ReadonlyNewsArticle[];
}

interface MutableSourceGroup {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly articles: ReadonlyNewsArticle[];
}

const groupArticlesBySource = (articles: readonly ReadonlyNewsArticle[]): SourceGroup[] => {
  const groups = new Map<string, MutableSourceGroup>();
  const seenKeys = new Set<string>();
  articles.forEach((article) => {
    const urlKey = getArticleText(article.url, String(article.id));
    if (seenKeys.has(urlKey)) {
      return;
    }
    seenKeys.add(urlKey);
    const sourceId = getArticleText(article.sourceId, getArticleText(article.source, "unknown"));
    let group = groups.get(sourceId);
    if (group === undefined) {
      group = {
        articles: [],
        sourceId,
        sourceName: getArticleText(article.source, ARTICLE_SOURCE_FALLBACK),
      };
      groups.set(sourceId, group);
    }
    group.articles.push(article);
  });
  return [...groups.values()].toSorted(
    (left, right) => right.articles.length - left.articles.length,
  );
};

const findLatestMessage = (
  messages: readonly Message[],
  predicate: (message: Readonly<Message>) => boolean,
): Message | undefined => [...messages].toReversed().find((message) => predicate(message));

interface LatestResearchMessages {
  readonly latestAssistantMessage: Message | undefined;
  readonly latestSemanticMessage: Message | undefined;
  readonly latestUserMessage: Message | undefined;
}
interface ResearchArticleData {
  readonly groupedSources: SourceGroup[];
  readonly relatedArticles: ReadonlyNewsArticle[];
  readonly thinkingSteps: NonNullable<Message["thinking_steps"]>;
}

const selectLatestResearchMessages = (
  conversationMessages: readonly Message[],
  messages: readonly Message[],
): LatestResearchMessages => ({
  latestAssistantMessage: findLatestMessage(
    conversationMessages,
    (message) => message.type === "assistant" && !message.toolType,
  ),
  latestSemanticMessage: findLatestMessage(
    messages,
    (message) => message.toolType === "semantic_search",
  ),
  latestUserMessage: findLatestMessage(conversationMessages, (message) => message.type === "user"),
});

const selectResearchArticleData = (
  latestAssistantMessage: Message | undefined,
): ResearchArticleData => {
  const relatedArticles = buildArticleEmbeds(latestAssistantMessage);
  return {
    groupedSources: groupArticlesBySource(relatedArticles),
    relatedArticles,
    thinkingSteps: latestAssistantMessage?.thinking_steps ?? [],
  };
};

const getActiveBriefTitle = (
  latestUserMessage: Message | undefined,
  chats: readonly ReadonlyChatSummary[],
  activeChatId: string | null,
): string => {
  const title = latestUserMessage?.content ?? chats.find((chat) => chat.id === activeChatId)?.title;
  if (title === undefined || title === "") {
    return "Research thread";
  }
  return title;
};
export { selectLatestResearchMessages, selectResearchArticleData, getActiveBriefTitle };
export type { SourceGroup };
