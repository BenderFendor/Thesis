"use client";

import { ArticleContent } from "@/components/article-content";
import { TabsContent } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import type { ClusterArticle } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { ArticleTabActions } from "./cluster-detail-modal-article-actions";
import { ArticleTabHeader } from "./cluster-detail-modal-article-header";

const EMPTY_HIGHLIGHTS: readonly [] = [];
type ArticleContentRef = Readonly<{ current: HTMLDivElement | null }>;

interface ArticleTabProps {
  readonly article: ClusterArticle;
  readonly activeContent: string | null | undefined;
  readonly loadingArticleId: number | null;
  readonly likedIds: ReadonlySet<number>;
  readonly isArticleInQueue: (url: string) => boolean;
  readonly contentRef: ArticleContentRef;
  readonly onLike: (articleId: number) => void;
  readonly onQueueToggle: (article: ClusterArticle) => void;
  readonly onClose: () => void;
}

const ArticleTab = ({
  article,
  activeContent,
  loadingArticleId,
  likedIds,
  isArticleInQueue,
  contentRef,
  onLike,
  onQueueToggle,
  onClose,
}: DeepReadonly<ArticleTabProps>) => (
  <TabsContent value={article.id.toString()} className="flex-1 overflow-y-auto m-0 p-0">
    <ArticleTabPanel
      article={article}
      activeContent={activeContent}
      loadingArticleId={loadingArticleId}
      likedIds={likedIds}
      isArticleInQueue={isArticleInQueue}
      contentRef={contentRef}
      onLike={onLike}
      onQueueToggle={onQueueToggle}
      onClose={onClose}
    />
  </TabsContent>
);

const ArticleTabPanel = (props: DeepReadonly<ArticleTabProps>) => (
  <div className="p-6 space-y-6">
    <ArticleTabHeader article={props.article} onClose={props.onClose} />
    <ArticleTabBody
      article={props.article}
      activeContent={props.activeContent}
      contentRef={props.contentRef}
      loadingArticleId={props.loadingArticleId}
    />
    <ArticleTabActions
      article={props.article}
      isArticleInQueue={props.isArticleInQueue}
      likedIds={props.likedIds}
      onLike={props.onLike}
      onQueueToggle={props.onQueueToggle}
    />
  </div>
);

const ArticleTabBody = ({
  article,
  activeContent,
  contentRef,
  loadingArticleId,
}: DeepReadonly<{
  readonly article: ClusterArticle;
  readonly activeContent: string | null | undefined;
  readonly contentRef: ArticleContentRef;
  readonly loadingArticleId: number | null;
}>) => {
  if (loadingArticleId === article.id) {
    return (
      <div ref={contentRef} className="prose prose-invert max-w-none">
        <ArticleLoadingState />
      </div>
    );
  }
  return (
    <div ref={contentRef} className="prose prose-invert max-w-none">
      <ArticleContent
        content={activeContent ?? "Loading article content..."}
        highlights={EMPTY_HIGHLIGHTS}
        className="text-base space-y-4"
      />
    </div>
  );
};

const ArticleLoadingState = () => (
  <div className="flex items-center gap-3 p-6 bg-[var(--news-bg-secondary)]/60 rounded-lg border border-border/60">
    <Loader2 className="w-5 h-5 animate-spin text-primary" />
    <span className="text-muted-foreground">Loading full article...</span>
  </div>
);

export { ArticleTab };
