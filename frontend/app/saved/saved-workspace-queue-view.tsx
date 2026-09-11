import { Bookmark, Heart, List, Loader2, Sparkles, Trash2, X } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SafeImage } from "@/components/safe-image";
import {
  LIST_POSITION_OFFSET,
  QUEUE_PREVIEW_LIMIT,
  QUEUE_THUMBNAIL_SIZE,
  articleKey,
  getArticleStackStyle,
  hasUsableArticleImage,
} from "@/app/saved/saved-workspace-helpers";
import { EmptyStateCard, SavedShelfCard } from "@/app/saved/saved-workspace-article-view";
import type {
  ControllerProps,
  LibraryStatProps,
  LoadingStateProps,
  QueueArticleProps,
  QueuePreviewItemProps,
  SavedReadonlyNewsArticle,
} from "@/app/saved/saved-workspace-types";

const LoadingState = (props: Readonly<LoadingStateProps>): ReactElement => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="mr-3 h-8 w-8 animate-spin" />
    <span className="text-muted-foreground">{props.label}</span>
  </div>
);

const DigestCloseButton = (props: Readonly<{ onClick: () => void }>): ReactElement => (
  <Button variant="outline" size="sm" onClick={props.onClick}>
    <X className="mr-1 h-4 w-4" /> Close Digest
  </Button>
);

const DigestHeader = (props: Readonly<{ onClose: () => void }>): ReactElement => (
  <div className="mb-4 flex items-center justify-between">
    <h2 className="font-serif text-xl font-bold">Reading Digest</h2>
    <DigestCloseButton onClick={props.onClose} />
  </div>
);

const DigestMarkdown = (props: Readonly<{ content: string }>): ReactElement => (
  <ReactMarkdown>{props.content}</ReactMarkdown>
);

const DigestCardContent = (props: Readonly<{ content: string }>): ReactElement => (
  <CardContent className="prose prose-invert max-w-none p-6">
    <DigestMarkdown content={props.content} />
  </CardContent>
);

const DigestCard = (props: Readonly<{ content: string }>): ReactElement => (
  <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
    <DigestCardContent content={props.content} />
  </Card>
);

const DigestPanel = (props: Readonly<ControllerProps>): ReactElement | null => {
  const { controller } = props;
  const handleHideDigest = useCallback(() => {
    controller.hideDigest();
  }, [controller]);
  if (!controller.showDigest || controller.digest === undefined) {
    return null;
  }
  return (
    <div className="mb-6">
      <DigestHeader onClose={handleHideDigest} />
      <DigestCard content={controller.digest} />
    </div>
  );
};

const QueuePreview = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
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

const RemoveQueueButton = (
  props: Readonly<{ compact?: boolean; onClick: () => void }>,
): ReactElement => {
  const compact = props.compact === true;
  let className: string | undefined = undefined;
  let iconClassName = "mr-1 h-4 w-4";
  if (compact) {
    className = "h-6 w-6 p-0";
    iconClassName = "h-3 w-3 text-destructive";
  }
  return (
    <Button variant="ghost" size="sm" className={className} onClick={props.onClick}>
      <Trash2 className={iconClassName} />
      {!compact && "Remove"}
    </Button>
  );
};

const QueuePreviewItem = (props: Readonly<QueuePreviewItemProps>): ReactElement => {
  const { article, controller, position } = props;
  const handleOpen = useCallback(() => {
    controller.openArticle(article);
  }, [article, controller]);
  const handleRemove = useCallback(() => {
    controller.toggleQueue(article);
  }, [article, controller]);
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
      <RemoveQueueButton compact onClick={handleRemove} />
    </div>
  );
};

const DigestActionButton = (
  props: Readonly<{ disabled: boolean; label: string; loading: boolean; onClick: () => void }>,
): ReactElement => (
  <Button variant="outline" onClick={props.onClick} disabled={props.disabled}>
    {props.loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
    {!props.loading && <Sparkles className="mr-2 h-4 w-4" />}
    {props.loading && "Generating..."}
    {!props.loading && props.label}
  </Button>
);

const QueueCardHeader = (props: Readonly<{ count: number }>): ReactElement => (
  <div className="mb-4 flex items-center justify-between">
    <h3 className="font-serif text-lg font-bold">Reading Queue</h3>
    <Badge>{props.count}</Badge>
  </div>
);

const ReadingQueueCard = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  const handleGenerate = useCallback(() => {
    void controller.generateDigest();
  }, [controller]);
  return (
    <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
      <CardContent className="p-4">
        <QueueCardHeader count={controller.queuedArticles.length} />
        <QueuePreview controller={controller} />
        {controller.queuedArticles.length > 0 && (
          <DigestActionButton
            onClick={handleGenerate}
            disabled={controller.digestLoading}
            loading={controller.digestLoading}
            label="Generate Digest"
          />
        )}
      </CardContent>
    </Card>
  );
};

const LibraryStat = (props: Readonly<LibraryStatProps>): ReactElement => {
  const { icon: Icon, label, value } = props;
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <Badge variant="secondary">{value}</Badge>
    </div>
  );
};

const LibraryStatsList = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  const stats: readonly LibraryStatProps[] = [
    { icon: Bookmark, label: "Bookmarks", value: controller.bookmarks.length },
    { icon: Heart, label: "Liked", value: controller.likedArticles.length },
    { icon: List, label: "In Queue", value: controller.queuedArticles.length },
    { icon: Sparkles, label: "Highlights", value: controller.highlightCount },
  ];
  return (
    <div className="space-y-3">
      {stats.map((stat) => (
        <LibraryStat key={stat.label} icon={stat.icon} label={stat.label} value={stat.value} />
      ))}
      <div className="border-t border-white/10 pt-3">
        <LibraryTotalSaved count={controller.allSavedArticles.length} />
      </div>
    </div>
  );
};

const LibraryTotalSaved = (props: Readonly<{ count: number }>): ReactElement => (
  <div className="flex items-center justify-between font-bold">
    <span className="text-sm">Total Saved</span>
    <Badge>{props.count}</Badge>
  </div>
);

const LibraryStatsCard = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  return (
    <Card className="border border-white/10 bg-[var(--news-bg-secondary)]">
      <CardContent className="p-4">
        <h3 className="mb-4 font-serif text-lg font-bold">Your Library</h3>
        <LibraryStatsList controller={controller} />
      </CardContent>
    </Card>
  );
};

const SavedSidebar = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  return (
    <div className="space-y-6">
      <ReadingQueueCard controller={controller} />
      <SavedShelfCard controller={controller} />
      <LibraryStatsCard controller={controller} />
    </div>
  );
};

const QueueArticleNumber = (props: Readonly<{ index: number }>): ReactElement => (
  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
    {props.index + LIST_POSITION_OFFSET}
  </div>
);

const QueueArticleActions = (
  props: Readonly<{ onRead: () => void; onRemove: () => void }>,
): ReactElement => (
  <div className="mt-2 flex items-center gap-2">
    <Button size="sm" variant="outline" onClick={props.onRead}>
      Read
    </Button>
    <RemoveQueueButton onClick={props.onRemove} />
  </div>
);

const QueueArticleBody = (
  props: Readonly<{
    article: SavedReadonlyNewsArticle;
    onRead: () => void;
    onRemove: () => void;
  }>,
): ReactElement => (
  <div className="min-w-0 flex-1">
    <button
      type="button"
      className="text-left font-serif text-sm font-bold leading-tight hover:text-primary"
      onClick={props.onRead}
    >
      {props.article.title}
    </button>
    <p className="mt-1 text-xs text-muted-foreground">{props.article.source}</p>
    <QueueArticleActions onRead={props.onRead} onRemove={props.onRemove} />
  </div>
);

const QueueArticleImage = (
  props: Readonly<{ article: SavedReadonlyNewsArticle }>,
): ReactElement => (
  <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg">
    <SafeImage
      src={props.article.image}
      alt={props.article.title}
      width={QUEUE_THUMBNAIL_SIZE}
      height={QUEUE_THUMBNAIL_SIZE}
      className="h-full w-full object-cover"
      sizes="80px"
    />
  </div>
);

const QueueArticleMain = (
  props: Readonly<
    Pick<QueueArticleProps, "article" | "index"> & { onRead: () => void; onRemove: () => void }
  >,
): ReactElement => (
  <div className="flex items-start gap-3">
    <QueueArticleNumber index={props.index} />
    <QueueArticleBody article={props.article} onRead={props.onRead} onRemove={props.onRemove} />
    {hasUsableArticleImage(props.article) && <QueueArticleImage article={props.article} />}
  </div>
);

const QueueArticle = (props: Readonly<QueueArticleProps>): ReactElement => {
  const { article, controller, index } = props;
  const handleRead = useCallback(() => {
    controller.openArticle(article);
  }, [article, controller]);
  const handleRemove = useCallback(() => {
    controller.toggleQueue(article);
  }, [article, controller]);
  return (
    <div
      className="group relative rounded-2xl border border-white/10 bg-[var(--news-bg-secondary)] p-4 transition-all hover:border-primary/50"
      style={getArticleStackStyle(index)}
    >
      <QueueArticleMain
        article={article}
        index={index}
        onRead={handleRead}
        onRemove={handleRemove}
      />
    </div>
  );
};

const QueueTabTitle = (): ReactElement => (
  <div>
    <h2 className="font-serif text-xl font-bold">Articles to Read</h2>
    <p className="text-sm text-muted-foreground">
      Keep the queue curated, then generate a digest when you want a synthesis pass.
    </p>
  </div>
);

const QueueTabActions = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  const handleGenerate = useCallback(() => void controller.generateDigest(), [controller]);
  return (
    <div className="flex items-center gap-2">
      <DigestActionButton
        onClick={handleGenerate}
        disabled={controller.digestLoading || controller.queuedArticles.length === 0}
        loading={controller.digestLoading}
        label="Reading Digest"
      />
      <Badge className="px-3 py-1 text-base">{controller.queuedArticles.length}</Badge>
    </div>
  );
};

const QueueTabHeader = (props: Readonly<ControllerProps>): ReactElement => (
  <div className="flex items-center justify-between">
    <QueueTabTitle />
    <QueueTabActions controller={props.controller} />
  </div>
);

const QueueArticleList = (props: Readonly<ControllerProps>): ReactElement => (
  <div className="space-y-3">
    {props.controller.queuedArticles.map((article, index) => (
      <QueueArticle
        key={articleKey(article)}
        article={article}
        controller={props.controller}
        index={index}
      />
    ))}
  </div>
);

const QueueTab = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  return (
    <div className="space-y-6">
      <QueueTabHeader controller={controller} />
      <DigestPanel controller={controller} />
      {controller.queuedArticles.length === 0 && (
        <EmptyStateCard
          icon={List}
          title="Your queue is empty"
          description="Add articles to your reading queue from saved items or the news feed."
        />
      )}
      {controller.queuedArticles.length > 0 && <QueueArticleList controller={controller} />}
    </div>
  );
};

export {
  DigestPanel,
  LoadingState,
  QueueTab,
  SavedSidebar,
};
