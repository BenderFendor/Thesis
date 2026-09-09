import type { ReactNode } from "react";
import type { NewsArticle, ReadingShelf, ReadonlyNewsArticle } from "@/lib/api";
import type { SavedArticle } from "@/app/saved/saved-workspace-model";
import type { SavedWorkspaceController } from "@/app/saved/use-saved-workspace-controller";
import type { DeepReadonly } from "@/lib/deep-readonly";

interface IconProps {
  readonly className?: string;
}

type IconComponent = (props: IconProps) => ReactNode;

type SavedController = DeepReadonly<SavedWorkspaceController>;
type SavedNewsArticle = NewsArticle;
type SavedReadonlyNewsArticle = ReadonlyNewsArticle;

interface ControllerProps {
  readonly controller: SavedController;
}

interface EmptyStateCardProps {
  readonly cardClassName?: string;
  readonly description: string;
  readonly icon: IconComponent;
  readonly showBrowseLink?: boolean;
  readonly title: string;
}

type ResearchShelvesCardProps = DeepReadonly<{
  isPending: boolean;
  newShelfName: string;
  onCreateShelf: () => void;
  onNewShelfNameChange: (name: string) => void;
  shelves: readonly ReadingShelf[] | undefined;
  shelvesLoading: boolean;
}>;

interface ArticleActionProps {
  readonly article: ReadonlyNewsArticle;
  readonly bookmarkIds: ReadonlySet<number>;
  readonly inQueue: boolean;
  readonly likedIds: ReadonlySet<number>;
  readonly onBookmark: (articleId: number) => Promise<void>;
  readonly onLike: (articleId: number) => Promise<void>;
  readonly onRead: (article: NewsArticle) => void;
  readonly onToggleQueue: (article: NewsArticle) => void;
}

interface ArticleCardProps extends ArticleActionProps {
  readonly article: Readonly<SavedArticle>;
  readonly index?: number;
  readonly isExpanded: boolean;
  readonly onToggleExpanded: (articleUrl?: string) => void;
}

interface ArticleListProps {
  readonly articles: readonly SavedArticle[];
  readonly controller: SavedController;
}

interface SavedTabProps {
  readonly articles: readonly NewsArticle[];
  readonly controller: SavedController;
  readonly description: string;
  readonly icon: IconComponent;
  readonly kind: "bookmark" | "liked";
  readonly title: string;
}

type ShelfListProps = DeepReadonly<{
  shelves: readonly ReadingShelf[] | undefined;
  loading: boolean;
}>;

interface ArticleKindIconProps {
  readonly kind: SavedArticle["type"];
}

interface ExpandIndicatorProps {
  readonly expanded: boolean;
}

interface ArticleCardHeaderProps {
  readonly article: Readonly<SavedArticle>;
  readonly isExpanded: boolean;
}

interface ExpandedArticleContentProps extends ArticleActionProps {
  readonly isExpanded: boolean;
}

interface LoadingStateProps {
  readonly label: string;
}

interface QueuePreviewItemProps {
  readonly article: ReadonlyNewsArticle;
  readonly controller: SavedController;
  readonly position: number;
}

interface LibraryStatProps {
  readonly icon: IconComponent;
  readonly label: string;
  readonly value: number;
}

interface QueueArticleProps {
  readonly article: ReadonlyNewsArticle;
  readonly controller: SavedController;
  readonly index: number;
}

interface WorkspaceTabDefinition {
  readonly count: number;
  readonly icon: IconComponent;
  readonly label: string;
  readonly value: string;
}

export type {
  ArticleActionProps,
  ArticleCardHeaderProps,
  ArticleCardProps,
  ArticleListProps,
  ArticleKindIconProps,
  ControllerProps,
  EmptyStateCardProps,
  ExpandIndicatorProps,
  ExpandedArticleContentProps,
  IconComponent,
  LibraryStatProps,
  LoadingStateProps,
  QueueArticleProps,
  QueuePreviewItemProps,
  ResearchShelvesCardProps,
  SavedController,
  SavedNewsArticle,
  SavedReadonlyNewsArticle,
  SavedTabProps,
  ShelfListProps,
  WorkspaceTabDefinition,
};
