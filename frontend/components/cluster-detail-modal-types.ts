import type {
  AllCluster,
  BreakingCluster,
  ClusterArticle,
  TrendingCluster,
  fetchClusterDetail,
} from "@/lib/api";
import type { ComparisonSourceOption } from "@/lib/cluster-comparison";
import type { DeepReadonly as ReadonlyDeep } from "@/lib/deep-readonly";
import type { RefObject } from "react";

interface GdeltContextLike {
  readonly total_events?: number;
  readonly top_cameo?:
    | readonly {
        readonly code?: string | null;
        readonly label?: string | null;
        readonly count: number;
      }[]
    | null;
  readonly goldstein_avg?: number | null;
  readonly goldstein_min?: number | null;
  readonly goldstein_max?: number | null;
  readonly goldstein_bucket?: string | null;
  readonly tone_avg?: number | null;
  readonly tone_delta_vs_cluster?: number | null;
}

interface GdeltContextStripProps {
  readonly context: GdeltContextLike;
  readonly cameoSummary: string | null;
  readonly toneAvg: number | null;
  readonly toneDelta: number | null;
}

interface ClusterDetailModalProps {
  readonly cluster: (TrendingCluster | BreakingCluster | AllCluster) | null;
  readonly isBreaking: boolean;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

type ComparisonArticle = Omit<ClusterArticle, "source_id"> & {
  readonly source_id?: string;
};

interface ComparisonData {
  readonly similarity: {
    readonly content_similarity: number;
    readonly title_similarity: number;
    readonly overall_match_percent: number;
  };
  readonly entities: {
    readonly source_1: {
      readonly persons: readonly string[];
      readonly organizations: readonly string[];
      readonly locations: readonly string[];
      readonly dates: readonly string[];
    };
    readonly source_2: {
      readonly persons: readonly string[];
      readonly organizations: readonly string[];
      readonly locations: readonly string[];
      readonly dates: readonly string[];
    };
    readonly comparison: {
      readonly common_entities: {
        readonly persons: readonly string[];
        readonly organizations: readonly string[];
        readonly locations: readonly string[];
        readonly dates: readonly string[];
      };
      readonly unique_to_source_1: {
        readonly persons: readonly string[];
        readonly organizations: readonly string[];
        readonly locations: readonly string[];
        readonly dates: readonly string[];
      };
      readonly unique_to_source_2: {
        readonly persons: readonly string[];
        readonly organizations: readonly string[];
        readonly locations: readonly string[];
        readonly dates: readonly string[];
      };
    };
  };
  readonly keywords: {
    readonly source_1_top: readonly { readonly word: string; readonly count: number }[];
    readonly source_2_top: readonly { readonly word: string; readonly count: number }[];
    readonly comparison: {
      readonly common_keywords: readonly {
        readonly keyword: string;
        readonly source_1_freq: number;
        readonly source_2_freq: number;
        readonly difference: number;
        readonly emphasis: string;
      }[];
      readonly unique_to_source_1: readonly {
        readonly keyword: string;
        readonly frequency: number;
      }[];
      readonly unique_to_source_2: readonly {
        readonly keyword: string;
        readonly frequency: number;
      }[];
    };
  };
  readonly diff: {
    readonly added: readonly {
      readonly index: number;
      readonly text: string;
      readonly type: string;
    }[];
    readonly removed: readonly {
      readonly index: number;
      readonly text: string;
      readonly type: string;
    }[];
    readonly similar: readonly {
      readonly source_1_index: number;
      readonly source_2_index: number;
      readonly source_1_text: string;
      readonly source_2_text: string;
      readonly similarity: number;
    }[];
  };
  readonly summary: {
    readonly common_entities_count: number;
    readonly unique_entities_source_1: number;
    readonly unique_entities_source_2: number;
    readonly common_keywords_count: number;
    readonly unique_keywords_source_1: number;
    readonly unique_keywords_source_2: number;
  };
}

interface ClusterDetailModalContentProps {
  readonly cluster: TrendingCluster | BreakingCluster | AllCluster;
  readonly isBreaking: boolean;
  readonly onClose: () => void;
}

type ClusterDetailResponse = ReadonlyDeep<Awaited<ReturnType<typeof fetchClusterDetail>>>;
type ClusterDetailCluster = TrendingCluster | BreakingCluster | AllCluster;

type ArticleContentLoader = (article: Pick<ClusterArticle, "id" | "url">) => Promise<string | null>;

interface ComparisonTabProps {
  readonly comparisonMode: boolean;
  readonly comparisonSourceOptions: readonly ComparisonSourceOption<ComparisonArticle>[];
  readonly comparisonArticles: readonly ComparisonArticle[];
  readonly comparisonError: string | null;
  readonly comparisonData: ComparisonData | null;
  readonly comparisonLoading: boolean;
  readonly articleContents: ReadonlyMap<number, string | null>;
  readonly loadingArticle: number | null;
  readonly detailArticleCount: number | null;
  readonly onSourceChange: (sourceId: string, articleId: string) => void;
}

interface ClusterDetailViewProps {
  readonly cluster: ClusterDetailCluster;
  readonly isBreaking: boolean;
  readonly label: string;
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
  readonly onClose: () => void;
  readonly context: GdeltContextStripProps | null;
  readonly loading: boolean;
  readonly clusterDetail: ClusterDetailResponse | undefined;
  readonly loadError: string | null;
  readonly resolvedActiveArticleId: string | null;
  readonly activeContent: string | null | undefined;
  readonly loadingArticle: number | null;
  readonly likedIds: ReadonlySet<number>;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly contentRef: Readonly<RefObject<HTMLDivElement | null>>;
  readonly onLike: (articleId: number) => void;
  readonly onQueueToggle: (article: ClusterArticle) => void;
  readonly onTabChange: (value: string) => void;
  readonly onOpenComparison: () => void;
  readonly comparison: Readonly<ComparisonTabProps>;
}

export type {
  ArticleContentLoader,
  ClusterDetailCluster,
  ClusterDetailModalContentProps,
  ClusterDetailModalProps,
  ClusterDetailResponse,
  ClusterDetailViewProps,
  ComparisonArticle,
  ComparisonData,
  ComparisonTabProps,
  GdeltContextLike,
  GdeltContextStripProps,
};
