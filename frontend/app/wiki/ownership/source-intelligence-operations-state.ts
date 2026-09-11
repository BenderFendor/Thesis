import { fetchDebugErrors, fetchLlmLogs } from "@/lib/api";
import type { DebugErrorsResponse, LlmLogResponse, LlmLogEntry, SourceStats } from "@/lib/api";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  EMPTY_LLM_ENTRIES,
  averageSourceArticles,
  buildRecentErrorEvents,
  countSuccessfulLogs,
  indexSource,
  parseArticleParserResponse,
  parseRssParserResponse,
  runParserTest,
} from "./source-intelligence-operations-helpers";
import type {
  OperationsContentProps,
  OperationsPanelProps,
  ParserResult,
  WorkspaceTab,
} from "./source-intelligence-operations-types";

interface OperationsQueryState {
  readonly topSources: SourceStats[];
  readonly problematicSources: SourceStats[];
  readonly averageArticles: number;
  readonly llmEntries: readonly LlmLogEntry[];
  readonly latencyValues: readonly (number | undefined)[];
  readonly modelSuccessCount: number;
  readonly modelFailureCount: number;
  readonly recentErrorEvents: ReturnType<typeof buildRecentErrorEvents>;
}

interface OperationsHandlerState {
  readonly handleIndex: () => void;
  readonly handleTestArticle: () => void;
  readonly handleTestFeed: () => void;
}

interface OperationsViewState {
  readonly activeTab: WorkspaceTab;
  readonly onTabChange: OperationsPanelProps["onTabChange"];
  readonly tabs: OperationsPanelProps["tabs"];
  readonly content: OperationsContentProps;
}

const useParserState = () => {
  const [rssUrl, setRssUrl] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [rssResult, setRssResult] = useState<ParserResult | null>(null);
  const [articleResult, setArticleResult] = useState<ParserResult | null>(null);
  const [testingFeed, setTestingFeed] = useState(false);
  const [testingArticle, setTestingArticle] = useState(false);
  const [indexingSource, setIndexingSource] = useState(false);
  return {
    articleResult,
    articleUrl,
    indexingSource,
    rssResult,
    rssUrl,
    setArticleResult,
    setArticleUrl,
    setIndexingSource,
    setRssResult,
    setRssUrl,
    setTestingArticle,
    setTestingFeed,
    testingArticle,
    testingFeed,
  };
};

type ParserState = Readonly<ReturnType<typeof useParserState>>;

const useOperationsQueries = (
  activeTab: WorkspaceTab,
  sourceStats: readonly SourceStats[],
): OperationsQueryState => {
  const llmLogsQuery = useQuery<LlmLogResponse>({
    enabled: activeTab === "llm",
    queryFn: () => fetchLlmLogs({ limit: 12 }),
    queryKey: ["source-intelligence-llm"],
    retry: 1,
  });
  const errorsQuery = useQuery<DebugErrorsResponse>({
    enabled: activeTab === "errors",
    queryFn: () => fetchDebugErrors({ includeRequestStreamEvents: true, limit: 12 }),
    queryKey: ["source-intelligence-errors"],
    retry: 1,
  });
  const llmEntries = llmLogsQuery.data?.entries ?? EMPTY_LLM_ENTRIES;
  const latencyValues = useMemo(() => llmEntries.map((entry) => entry.duration_ms), [llmEntries]);
  return {
    averageArticles: averageSourceArticles(sourceStats),
    latencyValues,
    llmEntries,
    modelFailureCount: countSuccessfulLogs(llmEntries, false),
    modelSuccessCount: countSuccessfulLogs(llmEntries, true),
    problematicSources: sourceStats.filter((source) => source.status !== "success").slice(0, 6),
    recentErrorEvents: buildRecentErrorEvents(errorsQuery.data),
    topSources: sourceStats.slice(0, 10),
  };
};

const useOperationsHandlers = ({
  selectedSourceName,
  onRefreshAll,
  onSourceProfileRefresh,
  articleUrl,
  rssUrl,
  parser,
}: Readonly<{
  selectedSourceName: string | null;
  onRefreshAll: () => void;
  onSourceProfileRefresh: () => Promise<void>;
  articleUrl: string;
  rssUrl: string;
  parser: Readonly<ParserState>;
}>): OperationsHandlerState => {
  const { setArticleResult, setTestingArticle, setRssResult, setTestingFeed, setIndexingSource } =
    parser;
  const handleIndex = useCallback(() => {
    void indexSource({
      onRefreshAll,
      onSourceProfileRefresh,
      setIndexing: setIndexingSource,
      sourceName: selectedSourceName,
    });
  }, [onRefreshAll, onSourceProfileRefresh, selectedSourceName, setIndexingSource]);
  const handleTestArticle = useCallback(() => {
    void runParserTest({
      endpoint: "/debug/parser/test/article",
      failureMessage: "Article test failed",
      parseResponse: parseArticleParserResponse,
      setResult: setArticleResult,
      setTesting: setTestingArticle,
      url: articleUrl,
    });
  }, [articleUrl, setArticleResult, setTestingArticle]);
  const handleTestFeed = useCallback(() => {
    void runParserTest({
      endpoint: "/debug/parser/test/rss",
      failureMessage: "Feed test failed",
      parseResponse: parseRssParserResponse,
      setResult: setRssResult,
      setTesting: setTestingFeed,
      url: rssUrl,
    });
  }, [rssUrl, setRssResult, setTestingFeed]);
  return { handleIndex, handleTestArticle, handleTestFeed };
};

const useOperationsState = (props: Readonly<OperationsPanelProps>): OperationsViewState => {
  const parser = useParserState();
  const queries = useOperationsQueries(props.activeTab, props.sourceStats);
  const handlers = useOperationsHandlers({
    articleUrl: parser.articleUrl,
    onRefreshAll: props.onRefreshAll,
    onSourceProfileRefresh: props.onSourceProfileRefresh,
    parser,
    rssUrl: parser.rssUrl,
    selectedSourceName: props.selectedSourceName,
  });
  return {
    activeTab: props.activeTab,
    content: {
      activeTab: props.activeTab,
      articleResult: parser.articleResult,
      articleUrl: parser.articleUrl,
      averageArticles: queries.averageArticles,
      cacheStatus: props.cacheStatus,
      errors: queries.recentErrorEvents,
      failureCount: queries.modelFailureCount,
      indexingSource: parser.indexingSource,
      latencyValues: queries.latencyValues,
      llmEntries: queries.llmEntries,
      onArticleUrlChange: parser.setArticleUrl,
      onIndex: handlers.handleIndex,
      onRefreshAll: props.onRefreshAll,
      onRssUrlChange: parser.setRssUrl,
      onTestArticle: handlers.handleTestArticle,
      onTestFeed: handlers.handleTestFeed,
      problematicSources: queries.problematicSources,
      rssResult: parser.rssResult,
      rssUrl: parser.rssUrl,
      sourceName: props.selectedSourceName,
      sourceProfile: props.selectedSourceProfile,
      sourceStats: queries.topSources,
      successCount: queries.modelSuccessCount,
      testingArticle: parser.testingArticle,
      testingFeed: parser.testingFeed,
      wikiIndexStatus: props.wikiIndexStatus,
    },
    onTabChange: props.onTabChange,
    tabs: props.tabs,
  };
};

export { useOperationsState };
