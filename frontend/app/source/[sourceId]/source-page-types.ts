import type { NewsArticle, getSourceById } from "@/lib/api";
import type { DeepReadonly as DeepReadonlyType } from "@/lib/deep-readonly";

interface SourcePageProps {
  readonly params: Promise<{ sourceId: string }>;
}

interface SourcePageRouter {
  readonly back: () => void;
  readonly push: (href: string) => void;
}

type SourcePageSource = NonNullable<Awaited<ReturnType<typeof getSourceById>>>;
type DeepReadonly<Value> = DeepReadonlyType<Value>;
type ReadonlySourcePageSource = DeepReadonly<SourcePageSource>;

interface SourcePageLayoutProps {
  readonly source: ReadonlySourcePageSource;
  readonly websiteHostname?: string;
  readonly debugMode: boolean;
  readonly isFavorite: (sourceId: string) => boolean;
  readonly toggleFavorite: (sourceId: string) => void;
  readonly onBack: () => void;
  readonly articles: readonly NewsArticle[];
  readonly articlesLoading: boolean;
  readonly selectedArticle: Readonly<NewsArticle> | null;
  readonly modalOpen: boolean;
  readonly onArticleClick: (article: NewsArticle) => void;
  readonly onCloseModal: () => void;
}

export type {
  DeepReadonly,
  ReadonlySourcePageSource,
  SourcePageLayoutProps,
  SourcePageProps,
  SourcePageRouter,
};
