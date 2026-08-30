import type { ComponentProps, CSSProperties } from "react";
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Heart,
  Inbox,
  List,
  Loader2,
  MinusCircle,
  Newspaper,
  PlusCircle,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

import { ArticleDetailModal } from "@/components/article-detail-modal";
import { HighlightsView } from "@/components/highlights-view";
import { SafeImage } from "@/components/safe-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { NewsArticle, ReadingShelf } from "@/lib/api";
import { hasRealImage } from "@/app/saved/saved-workspace-model";
import type { SavedArticle } from "@/app/saved/saved-workspace-model";
import type { SavedWorkspaceController } from "@/app/saved/use-saved-workspace-controller";

const CARD_OFFSET_STEP_PX = 4;
const CARD_OFFSET_LIMIT_PX = 16;
const CARD_OVERLAP_PX = -8;
const LIST_POSITION_OFFSET = 1;
const QUEUE_PREVIEW_LIMIT = 5;
const ARTICLE_THUMBNAIL_SIZE = 64;
const QUEUE_THUMBNAIL_SIZE = 80;

interface EmptyStateCardProps {
  readonly cardClassName?: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly showBrowseLink?: boolean;
  readonly title: string;
}

interface ResearchShelvesCardProps {
  readonly isPending: boolean;
  readonly newShelfName: string;
  readonly onCreateShelf: () => void;
  readonly onNewShelfNameChange: (name: string) => void;
  readonly shelves: readonly ReadingShelf[] | undefined;
  readonly shelvesLoading: boolean;
}

interface ArticleActionProps {
  readonly article: Readonly<NewsArticle>;
  readonly bookmarkIds: ReadonlySet<number>;
  readonly inQueue: boolean;
  readonly likedIds: ReadonlySet<number>;
  readonly onBookmark: (articleId: number) => Promise<void>;
  readonly onLike: (articleId: number) => Promise<void>;
  readonly onRead: (article: Readonly<NewsArticle>) => void;
  readonly onToggleQueue: (article: Readonly<NewsArticle>) => void;
}

interface ArticleCardProps extends ArticleActionProps {
  readonly article: Readonly<SavedArticle>;
  readonly index?: number;
  readonly isExpanded: boolean;
  readonly onToggleExpanded: (articleUrl: string | undefined) => void;
}

interface ArticleListProps {
  readonly articles: readonly SavedArticle[];
  readonly controller: SavedWorkspaceController;
}

interface SavedTabProps {
  readonly articles: readonly NewsArticle[];
  readonly controller: SavedWorkspaceController;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly kind: "bookmark" | "liked";
  readonly title: string;
}

const getCardFrameStyle = (isExpanded: boolean): CSSProperties => {
  if (isExpanded) {
    return {
      backgroundColor: "var(--news-bg-secondary)",
      borderColor: "var(--primary)",
      outlineColor: "var(--primary)",
      outlineOffset: "0px",
      outlineWidth: "2px",
    };
  }
  return {
    backgroundColor: "var(--card)",
    borderColor: "var(--border)",
    outlineOffset: "0px",
    outlineWidth: "0px",
  };
};

const getArticleStackStyle = (index?: number): CSSProperties => {
  if (index === undefined) {
    return {};
  }
  return {
    marginLeft: `${Math.min(index * CARD_OFFSET_STEP_PX, CARD_OFFSET_LIMIT_PX)}px`,
    marginTop: index > 0 ? `${CARD_OVERLAP_PX}px` : "0px",
  };
};

const articleKey = (article: Readonly<NewsArticle>): string =>
  `${article.id}:${article.url}`;

const EmptyStateCard = ({
  cardClassName = "",
  description,
  icon: Icon,
  showBrowseLink = false,
  title,
}: Readonly<EmptyStateCardProps>) => (
  <Card
    className={`border-dashed border-white/20 bg-[var(--news-bg-secondary)]/50 ${cardClassName}`}
  >
    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="mb-4 h-12 w-12 text-muted-foreground" />
      <h3 className="mb-2 font-serif text-lg font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {showBrowseLink && (
        <Link href="/" className="mt-4">
          <Button>Browse News</Button>
        </Link>
      )}
    </CardContent>
  </Card>
);

const ShelfList = ({
  shelves,
  loading,
}: Readonly<{
  shelves: readonly ReadingShelf[] | undefined;
  loading: boolean;
}>) => {
  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading shelves...</p>;
  }
  if (shelves === undefined || shelves.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Create shelves for topics, open questions, and claim trails.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {shelves.map((shelf) => (
        <div
          key={shelf.id ?? shelf.name}
          className="rounded-md border border-white/10 bg-[var(--news-bg-primary)]/50 px-3 py-2"
        >
          <div className="text-sm font-medium">{shelf.name}</div>
          {(shelf.description?.trim().length ?? 0) > 0 && (
            <div className="text-xs text-muted-foreground">{shelf.description}</div>
          )}
        </div>
      ))}
    </div>
  );
};

const ResearchShelvesCard = ({
  isPending,
  newShelfName,
  onCreateShelf,
  onNewShelfNameChange,
  shelves,
  shelvesLoading,
}: Readonly<ResearchShelvesCardProps>) => {
  const handleChange: NonNullable<ComponentProps<"input">["onChange"]> = (event) => {
    onNewShelfNameChange(event.target.value);
  };
  const handleKeyDown: NonNullable<ComponentProps<"input">["onKeyDown"]> = (event) => {
    if (event.key === "Enter") {
      onCreateShelf();
    }
  };
  return (
    <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif text-lg font-bold">Research Shelves</h3>
          <Badge>{shelves?.length ?? 0}</Badge>
        </div>
        <div className="mb-3 flex gap-2">
          <input
            value={newShelfName}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="New shelf"
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-[var(--news-bg-primary)] px-3 py-2 text-sm text-foreground"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={onCreateShelf}
            disabled={isPending || newShelfName.trim().length === 0}
          >
            <PlusCircle className="h-4 w-4" />
          </Button>
        </div>
        <ShelfList shelves={shelves} loading={shelvesLoading} />
      </CardContent>
    </Card>
  );
};

const ArticleKindIcon = ({ kind }: Readonly<{ kind: SavedArticle["type"] }>) => {
  if (kind === "liked") {
    return <Heart className="h-3.5 w-3.5 fill-current" />;
  }
  return <Bookmark className="h-3.5 w-3.5 fill-current" />;
};

const ExpandIndicator = ({ expanded }: Readonly<{ expanded: boolean }>) => {
  if (expanded) {
    return <ChevronDown className="h-5 w-5 text-muted-foreground" />;
  }
  return <ChevronRight className="h-5 w-5 text-muted-foreground" />;
};

const ArticleCardHeader = ({
  article,
  isExpanded,
}: Readonly<{
  article: Readonly<SavedArticle>;
  isExpanded: boolean;
}>) => {
  const showImage = hasRealImage(article.image);
  const readTime = article._queueData?.readingTimeMinutes;
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        <ArticleKindIcon kind={article.type} />
      </div>
      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            "font-serif font-bold leading-tight transition-colors group-hover:text-primary",
            isExpanded && "text-base",
            !isExpanded && "line-clamp-2 text-sm",
          )}
        >
          {article.title}
        </h3>
        <div className="mt-1 flex items-center gap-2">
          <p className="text-xs text-muted-foreground">{article.source}</p>
          {readTime !== undefined && (
            <span className="rounded bg-primary/20 px-1.5 py-0.5 text-xs text-primary">
              {readTime}m
            </span>
          )}
          {article.type === "both" && (
            <Badge variant="outline" className="text-xs">
              <Heart className="mr-1 h-3 w-3" /> Liked
            </Badge>
          )}
        </div>
      </div>
      {showImage && (
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg">
          <SafeImage
            src={article.image}
            alt={article.title}
            width={ARTICLE_THUMBNAIL_SIZE}
            height={ARTICLE_THUMBNAIL_SIZE}
            className="h-full w-full object-cover"
            sizes="64px"
          />
        </div>
      )}
      <div className="flex-shrink-0 self-center">
        <ExpandIndicator expanded={isExpanded} />
      </div>
    </div>
  );
};

const CardActionButtons = ({
  article,
  bookmarkIds,
  inQueue,
  likedIds,
  onBookmark,
  onLike,
  onRead,
  onToggleQueue,
}: Readonly<ArticleActionProps>) => {
  const isLiked = likedIds.has(article.id);
  const isBookmarked = bookmarkIds.has(article.id);
  const handleRead = () => onRead(article);
  const handleQueue = () => onToggleQueue(article);
  const handleLike = () => void onLike(article.id);
  const handleBookmark = () => void onBookmark(article.id);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={handleRead}>Read Article</Button>
      <Button size="sm" variant="outline" onClick={handleQueue}>
        {inQueue && <MinusCircle className="mr-1 h-4 w-4" />}
        {!inQueue && <PlusCircle className="mr-1 h-4 w-4" />}
        {inQueue && "Remove from Queue"}
        {!inQueue && "Add to Queue"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleLike}
        className={cn("text-muted-foreground", isLiked && "text-red-400")}
      >
        <Heart className={cn("mr-1 h-4 w-4", isLiked && "fill-current")} />
        Like
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleBookmark}
        className={cn("text-muted-foreground", isBookmarked && "text-yellow-400")}
      >
        <Bookmark className={cn("mr-1 h-4 w-4", isBookmarked && "fill-current")} />
        Bookmark
      </Button>
      <Button size="sm" variant="ghost" asChild>
        <a href={article.url} target="_blank" rel="noopener noreferrer">Open Source</a>
      </Button>
    </div>
  );
};

const ExpandedArticleContent = ({
  article,
  bookmarkIds,
  inQueue,
  isExpanded,
  likedIds,
  onBookmark,
  onLike,
  onRead,
  onToggleQueue,
}: Readonly<ArticleActionProps & { isExpanded: boolean }>) => {
  if (!isExpanded) {
    return undefined;
  }
  return (
    <div className="mt-4 border-t border-border/50 pt-4">
      {hasRealImage(article.image) && (
        <div className="mb-4 overflow-hidden rounded-lg">
          <SafeImage
            src={article.image}
            alt={article.title}
            width={896}
            height={192}
            className="h-48 w-full object-cover"
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
        </div>
      )}
      <p className="mb-4 line-clamp-4 text-sm text-muted-foreground">
        {article.summary}
      </p>
      <CardActionButtons
        article={article}
        bookmarkIds={bookmarkIds}
        inQueue={inQueue}
        likedIds={likedIds}
        onBookmark={onBookmark}
        onLike={onLike}
        onRead={onRead}
        onToggleQueue={onToggleQueue}
      />
    </div>
  );
};

const ArticleCard = ({
  article,
  bookmarkIds,
  inQueue,
  index,
  isExpanded,
  likedIds,
  onBookmark,
  onLike,
  onRead,
  onToggleExpanded,
  onToggleQueue,
}: Readonly<ArticleCardProps>) => {
  const handleToggleExpanded = () => {
    if (isExpanded) {
      onToggleExpanded(undefined);
      return;
    }
    onToggleExpanded(article.url);
  };
  return (
    <div className="w-full" style={getArticleStackStyle(index)}>
      <div
        className={cn(
          "group relative overflow-hidden rounded-2xl border p-4 backdrop-blur-sm transition-all duration-300",
          isExpanded && "shadow-2xl ring-2",
          !isExpanded && "shadow-lg hover:shadow-xl",
        )}
        style={getCardFrameStyle(isExpanded)}
      >
        <button type="button" className="w-full text-left" onClick={handleToggleExpanded}>
          <ArticleCardHeader article={article} isExpanded={isExpanded} />
        </button>
        <ExpandedArticleContent
          article={article}
          bookmarkIds={bookmarkIds}
          inQueue={inQueue}
          isExpanded={isExpanded}
          likedIds={likedIds}
          onBookmark={onBookmark}
          onLike={onLike}
          onRead={onRead}
          onToggleQueue={onToggleQueue}
        />
      </div>
    </div>
  );
};

const ArticleList = ({ articles, controller }: Readonly<ArticleListProps>) => (
  <div className="space-y-3">
    {articles.map((article, index) => (
      <ArticleCard
        key={articleKey(article)}
        article={article}
        index={index}
        isExpanded={controller.expandedArticleUrl === article.url}
        inQueue={controller.isArticleInQueue(article.url)}
        likedIds={controller.likedIds}
        bookmarkIds={controller.bookmarkIds}
        onToggleExpanded={controller.setExpandedArticleUrl}
        onRead={controller.openArticle}
        onToggleQueue={controller.toggleQueue}
        onLike={controller.toggleLike}
        onBookmark={controller.toggleBookmark}
      />
    ))}
  </div>
);

const LoadingState = ({ label }: Readonly<{ label: string }>) => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="mr-3 h-8 w-8 animate-spin" />
    <span className="text-muted-foreground">{label}</span>
  </div>
);

const DigestPanel = ({ controller }: Readonly<{ controller: SavedWorkspaceController }>) => {
  if (!controller.showDigest || controller.digest === undefined) {
    return undefined;
  }
  return (
    <div className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif text-xl font-bold">Reading Digest</h2>
        <Button variant="outline" size="sm" onClick={controller.hideDigest}>
          <X className="mr-1 h-4 w-4" /> Close Digest
        </Button>
      </div>
      <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
        <CardContent className="prose prose-invert max-w-none p-6">
          <ReactMarkdown>{controller.digest}</ReactMarkdown>
        </CardContent>
      </Card>
    </div>
  );
};

const QueuePreview = ({ controller }: Readonly<{ controller: SavedWorkspaceController }>) => {
  if (controller.queuedArticles.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        Your queue is empty. Add articles from your saved items.
      </p>
    );
  }
  return (
    <div className="max-h-64 space-y-2 overflow-y-auto">
      {controller.queuedArticles.slice(0, QUEUE_PREVIEW_LIMIT).map((article, index) => (
        <QueuePreviewItem
          key={articleKey(article)}
          article={article}
          position={index + LIST_POSITION_OFFSET}
          controller={controller}
        />
      ))}
      {controller.queuedArticles.length > QUEUE_PREVIEW_LIMIT && (
        <p className="text-center text-xs text-muted-foreground">
          +{controller.queuedArticles.length - QUEUE_PREVIEW_LIMIT} more articles
        </p>
      )}
    </div>
  );
};

const QueuePreviewItem = ({
  article,
  controller,
  position,
}: Readonly<{
  article: Readonly<NewsArticle>;
  controller: SavedWorkspaceController;
  position: number;
}>) => {
  const handleOpen = () => controller.openArticle(article);
  const handleRemove = () => controller.toggleQueue(article);
  return (
    <div className="flex items-center gap-2 rounded-lg bg-[var(--news-bg-primary)]/50 p-2">
      <span className="w-5 text-xs font-bold text-primary">{position}</span>
      <button
        type="button"
        onClick={handleOpen}
        className="min-w-0 flex-1 truncate text-left text-sm hover:text-primary"
      >
        {article.title}
      </button>
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleRemove}>
        <Trash2 className="h-3 w-3 text-destructive" />
      </Button>
    </div>
  );
};

const ReadingQueueCard = ({ controller }: Readonly<{ controller: SavedWorkspaceController }>) => {
  const handleGenerate = () => void controller.generateDigest();
  return (
    <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif text-lg font-bold">Reading Queue</h3>
          <Badge>{controller.queuedArticles.length}</Badge>
        </div>
        <QueuePreview controller={controller} />
        {controller.queuedArticles.length > 0 && (
          <Button
            className="mt-4 w-full"
            variant="outline"
            onClick={handleGenerate}
            disabled={controller.digestLoading}
          >
            {controller.digestLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {!controller.digestLoading && <Sparkles className="mr-2 h-4 w-4" />}
            {controller.digestLoading && "Generating..."}
            {!controller.digestLoading && "Generate Digest"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

const LibraryStatsCard = ({ controller }: Readonly<{ controller: SavedWorkspaceController }>) => (
  <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
    <CardContent className="p-4">
      <h3 className="mb-4 font-serif text-lg font-bold">Your Library</h3>
      <div className="space-y-3">
        <LibraryStat icon={Bookmark} label="Bookmarks" value={controller.bookmarks.length} />
        <LibraryStat icon={Heart} label="Liked" value={controller.likedArticles.length} />
        <LibraryStat icon={List} label="In Queue" value={controller.queuedArticles.length} />
        <LibraryStat icon={Sparkles} label="Highlights" value={controller.highlightCount} />
        <div className="border-t border-white/10 pt-3">
          <div className="flex items-center justify-between font-bold">
            <span className="text-sm">Total Saved</span>
            <Badge>{controller.allSavedArticles.length}</Badge>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
);

const LibraryStat = ({
  icon: Icon,
  label,
  value,
}: Readonly<{ icon: LucideIcon; label: string; value: number }>) => (
  <div className="flex items-center justify-between">
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <Icon className="h-4 w-4" /> {label}
    </span>
    <Badge variant="secondary">{value}</Badge>
  </div>
);

const SavedSidebar = ({ controller }: Readonly<{ controller: SavedWorkspaceController }>) => (
  <div className="space-y-6">
    <ReadingQueueCard controller={controller} />
    <ResearchShelvesCard
      shelves={controller.shelves}
      shelvesLoading={controller.shelvesLoading}
      newShelfName={controller.newShelfName}
      onNewShelfNameChange={controller.setNewShelfName}
      onCreateShelf={controller.createShelf}
      isPending={controller.shelfPending}
    />
    <LibraryStatsCard controller={controller} />
  </div>
);

const AllSavedTab = ({ controller }: Readonly<{ controller: SavedWorkspaceController }>) => {
  if (controller.loading) {
    return <LoadingState label="Loading saved articles..." />;
  }
  if (controller.allSavedArticles.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <EmptyStateCard
          cardClassName="lg:col-span-2"
          icon={Inbox}
          title="No saved articles yet"
          description="Articles you bookmark or like will appear here."
          showBrowseLink
        />
        <ResearchShelvesCard
          shelves={controller.shelves}
          shelvesLoading={controller.shelvesLoading}
          newShelfName={controller.newShelfName}
          onNewShelfNameChange={controller.setNewShelfName}
          onCreateShelf={controller.createShelf}
          isPending={controller.shelfPending}
        />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <ArticleList articles={controller.allSavedArticles} controller={controller} />
      </div>
      <SavedSidebar controller={controller} />
    </div>
  );
};

const SavedTab = ({
  articles,
  controller,
  description,
  icon,
  kind,
  title,
}: Readonly<SavedTabProps>) => {
  if (controller.loading) {
    return <LoadingState label={`Loading ${title.toLowerCase()}...`} />;
  }
  if (articles.length === 0) {
    return (
      <EmptyStateCard
        icon={icon}
        title={`No ${title.toLowerCase()} yet`}
        description={description}
        showBrowseLink
      />
    );
  }
  const savedArticles = articles.map((article) => ({ ...article, type: kind }));
  return <ArticleList articles={savedArticles} controller={controller} />;
};

const QueueArticle = ({
  article,
  controller,
  index,
}: Readonly<{
  article: Readonly<NewsArticle>;
  controller: SavedWorkspaceController;
  index: number;
}>) => {
  const handleRead = () => controller.openArticle(article);
  const handleRemove = () => controller.toggleQueue(article);
  return (
    <div
      className="group relative rounded-2xl border border-white/10 bg-[var(--news-bg-secondary)] p-4 transition-all hover:border-primary/50"
      style={{ marginLeft: `${Math.min(index * CARD_OFFSET_STEP_PX, CARD_OFFSET_LIMIT_PX)}px` }}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          {index + LIST_POSITION_OFFSET}
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="text-left font-serif text-sm font-bold leading-tight hover:text-primary"
            onClick={handleRead}
          >
            {article.title}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">{article.source}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleRead}>Read</Button>
            <Button size="sm" variant="ghost" onClick={handleRemove}>
              <Trash2 className="mr-1 h-4 w-4" /> Remove
            </Button>
          </div>
        </div>
        {hasRealImage(article.image) && (
          <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg">
            <SafeImage
              src={article.image}
              alt={article.title}
              width={QUEUE_THUMBNAIL_SIZE}
              height={QUEUE_THUMBNAIL_SIZE}
              className="h-full w-full object-cover"
              sizes="80px"
            />
          </div>
        )}
      </div>
    </div>
  );
};

const QueueTab = ({ controller }: Readonly<{ controller: SavedWorkspaceController }>) => {
  const handleGenerate = () => void controller.generateDigest();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl font-bold">Articles to Read</h2>
          <p className="text-sm text-muted-foreground">
            Keep the queue curated, then generate a digest when you want a synthesis pass.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleGenerate}
            disabled={controller.digestLoading || controller.queuedArticles.length === 0}
          >
            {controller.digestLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {!controller.digestLoading && <Sparkles className="mr-2 h-4 w-4" />}
            {controller.digestLoading && "Generating..."}
            {!controller.digestLoading && "Reading Digest"}
          </Button>
          <Badge className="px-3 py-1 text-base">{controller.queuedArticles.length}</Badge>
        </div>
      </div>
      <DigestPanel controller={controller} />
      {controller.queuedArticles.length === 0 && (
        <EmptyStateCard
          icon={List}
          title="Your queue is empty"
          description="Add articles to your reading queue from saved items or the news feed."
        />
      )}
      {controller.queuedArticles.length > 0 && (
        <div className="space-y-3">
          {controller.queuedArticles.map((article, index) => (
            <QueueArticle
              key={articleKey(article)}
              article={article}
              controller={controller}
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const HighlightsTab = ({ controller }: Readonly<{ controller: SavedWorkspaceController }>) => (
  <div className="space-y-6">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="font-serif text-xl font-bold">Highlights And Notes</h2>
        <p className="text-sm text-muted-foreground">
          Review saved passages across articles and keep the reader workflow centered here.
        </p>
      </div>
      <Badge className="px-3 py-1 text-base">{controller.highlightCount}</Badge>
    </div>
    <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
      <CardContent className="p-6"><HighlightsView /></CardContent>
    </Card>
  </div>
);

const LoadIssuesCard = ({ controller }: Readonly<{ controller: SavedWorkspaceController }>) => {
  if (controller.loadIssues.length === 0) {
    return undefined;
  }
  const handleRetry = () => void controller.reload();
  return (
    <Card className="mb-6 border-amber-500/30 bg-amber-500/10">
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div>
          <h2 className="font-semibold text-amber-100">Some saved data is unavailable</h2>
          <p className="mt-1 text-sm text-amber-50/80">{controller.loadIssues.join(" ")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRetry}>Retry</Button>
      </CardContent>
    </Card>
  );
};

const WorkspaceHeader = ({ controller }: Readonly<{ controller: SavedWorkspaceController }>) => {
  const handleReload = () => void controller.reload();
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[var(--news-bg-secondary)]/60 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/"><Button variant="ghost" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />Back to News</Button></Link>
            <div>
              <h1 className="font-serif text-2xl font-bold text-foreground">Reader Workspace</h1>
              <p className="text-sm text-muted-foreground">Bookmarks, queue, highlights, and reading context in one place</p>
            </div>
          </div>
          <Button onClick={handleReload} disabled={controller.loading} variant="outline" size="sm">
            <Loader2 className={cn("mr-2 h-4 w-4", controller.loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>
    </header>
  );
};

const WorkspaceTabs = ({ controller }: Readonly<{ controller: SavedWorkspaceController }>) => (
  <Tabs value={controller.activeTab} onValueChange={controller.setActiveTab} className="w-full">
    <TabsList className="mb-6 border border-white/10 bg-[var(--news-bg-secondary)]">
      <TabsTrigger value="all" className="gap-2"><Newspaper className="h-4 w-4" />All Saved<Badge variant="secondary">{controller.allSavedArticles.length}</Badge></TabsTrigger>
      <TabsTrigger value="bookmarks" className="gap-2"><Bookmark className="h-4 w-4" />Bookmarks<Badge variant="secondary">{controller.bookmarks.length}</Badge></TabsTrigger>
      <TabsTrigger value="liked" className="gap-2"><Heart className="h-4 w-4" />Liked<Badge variant="secondary">{controller.likedArticles.length}</Badge></TabsTrigger>
      <TabsTrigger value="queue" className="gap-2"><List className="h-4 w-4" />Reading Queue<Badge variant="secondary">{controller.queuedArticles.length}</Badge></TabsTrigger>
      <TabsTrigger value="highlights" className="gap-2"><Sparkles className="h-4 w-4" />Highlights<Badge variant="secondary">{controller.highlightCount}</Badge></TabsTrigger>
    </TabsList>
    <TabsContent value="all" className="mt-0"><DigestPanel controller={controller} /><AllSavedTab controller={controller} /></TabsContent>
    <TabsContent value="bookmarks" className="mt-0"><SavedTab articles={controller.bookmarks} controller={controller} description="Articles you bookmark will appear here." icon={Bookmark} kind="bookmark" title="Bookmarks" /></TabsContent>
    <TabsContent value="liked" className="mt-0"><SavedTab articles={controller.likedArticles} controller={controller} description="Articles you like will appear here." icon={Heart} kind="liked" title="Liked articles" /></TabsContent>
    <TabsContent value="queue" className="mt-0"><QueueTab controller={controller} /></TabsContent>
    <TabsContent value="highlights" className="mt-0"><HighlightsTab controller={controller} /></TabsContent>
  </Tabs>
);

export const SavedWorkspaceView = ({
  controller,
}: Readonly<{ controller: SavedWorkspaceController }>) => (
  <div className="min-h-screen bg-[var(--news-bg-primary)]">
    <WorkspaceHeader controller={controller} />
    <div className="container mx-auto px-4 py-6">
      <LoadIssuesCard controller={controller} />
      <WorkspaceTabs controller={controller} />
    </div>
    <ArticleDetailModal
      article={controller.selectedArticle}
      isOpen={controller.isArticleModalOpen}
      onClose={controller.closeArticle}
    />
  </div>
);
