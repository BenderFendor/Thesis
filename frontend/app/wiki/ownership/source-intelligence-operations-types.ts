import type {
  CacheStatus,
  LlmLogEntry,
  SourceStats,
  WikiIndexStatus,
  WikiSourceProfile,
} from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type workspaceSupport from "./source-intelligence-support";

type WorkspaceTab = (typeof workspaceSupport.tabs)[number]["id"];

interface ParserResult {
  readonly success?: boolean;
  readonly error?: string;
  readonly parse_time_seconds?: number;
  readonly image_url?: string;
  readonly status?: { readonly entries_count?: number };
}

interface NormalizedErrorEvent {
  readonly key: string;
  readonly service: string;
  readonly errorType: string;
  readonly message: string;
}

interface ParserTestRequest {
  readonly url: string;
  readonly endpoint: string;
  readonly failureMessage: string;
  readonly parseResponse: (response: Response) => Promise<ParserResult | undefined>;
  readonly setTesting: (value: boolean) => void;
  readonly setResult: (value: ParserResult | null) => void;
}

interface SourceIndexRequest {
  readonly sourceName: string | null;
  readonly setIndexing: (value: boolean) => void;
  readonly onSourceProfileRefresh: () => Promise<void>;
  readonly onRefreshAll: () => void;
}

interface OperationsPanelProps {
  readonly activeTab: WorkspaceTab;
  readonly onTabChange: (tab: WorkspaceTab) => void;
  readonly tabs: readonly { readonly id: WorkspaceTab; readonly label: string }[];
  readonly sourceStats: readonly SourceStats[];
  readonly cacheStatus: CacheStatus | null;
  readonly wikiIndexStatus: WikiIndexStatus | undefined;
  readonly selectedSourceName: string | null;
  readonly selectedSourceProfile: DeepReadonly<WikiSourceProfile> | null;
  readonly onRefreshAll: () => void;
  readonly onSourceProfileRefresh: () => Promise<void>;
}

interface OperationsContentProps {
  readonly activeTab: WorkspaceTab;
  readonly articleResult: ParserResult | null;
  readonly articleUrl: string;
  readonly averageArticles: number;
  readonly cacheStatus: CacheStatus | null;
  readonly errors: readonly NormalizedErrorEvent[];
  readonly failureCount: number;
  readonly indexingSource: boolean;
  readonly latencyValues: readonly (number | undefined)[];
  readonly llmEntries: readonly LlmLogEntry[];
  readonly onArticleUrlChange: (value: string) => void;
  readonly onIndex: () => void;
  readonly onRefreshAll: () => void;
  readonly onRssUrlChange: (value: string) => void;
  readonly onTestArticle: () => void;
  readonly onTestFeed: () => void;
  readonly problematicSources: readonly SourceStats[];
  readonly rssResult: ParserResult | null;
  readonly rssUrl: string;
  readonly sourceName: string | null;
  readonly sourceProfile: DeepReadonly<WikiSourceProfile> | null;
  readonly sourceStats: readonly SourceStats[];
  readonly successCount: number;
  readonly testingArticle: boolean;
  readonly testingFeed: boolean;
  readonly wikiIndexStatus: WikiIndexStatus | undefined;
}

export type {
  NormalizedErrorEvent,
  OperationsContentProps,
  OperationsPanelProps,
  ParserResult,
  ParserTestRequest,
  SourceIndexRequest,
  WorkspaceTab,
};
