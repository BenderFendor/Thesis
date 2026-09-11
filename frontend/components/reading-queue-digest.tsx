"use client";

import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCallback, useMemo } from "react";
import { ArticleDetailModal } from "@/components/article-detail-modal";
import { Button } from "@/components/ui/button";
import type { Components } from "react-markdown";
import { DigestCodeRenderer } from "@/components/reading-queue-embeds";
import type { NewsArticle } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import { X } from "lucide-react";

interface QueueDigestViewProps {
  readonly articleCount: number;
  readonly digestError?: string;
  readonly digestLoading: boolean;
  readonly queueDigest?: string;
  readonly embedModalArticle?: NewsArticle;
  readonly onClose: () => void;
  readonly onOpenArticle: (article: NewsArticle) => void;
  readonly onEmbedClose: () => void;
  readonly onNavigateArticle: (direction: "previous" | "next") => void;
}

const createDigestComponents = (onOpenArticle: (article: NewsArticle) => void): Components => ({
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-primary pl-4 italic my-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ children, className: codeClassName }) => (
    <DigestCodeRenderer className={codeClassName} onOpenArticle={onOpenArticle}>
      {children}
    </DigestCodeRenderer>
  ),
  em: ({ children }) => <em className="italic text-foreground">{children}</em>,
  h1: ({ children }) => (
    <h1 className="font-semibold font-serif text-2xl mt-6 mb-3 text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-semibold font-serif text-xl mt-5 mb-2 text-foreground">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-semibold font-serif text-lg mt-4 mb-2 text-foreground">{children}</h3>
  ),
  li: ({ children }) => <li className="ml-2 text-foreground">{children}</li>,
  ol: ({ children }) => (
    <ol className="list-decimal list-inside mb-3 space-y-1 text-foreground">{children}</ol>
  ),
  "p": ({ children }) => <p className="mb-3 leading-relaxed text-base text-foreground">{children}</p>,
  pre: ({ children }) => (
    <pre className="p-4 rounded mb-3 overflow-x-auto text-sm bg-black/40 text-foreground">
      {children}
    </pre>
  ),
  strong: ({ children }) => <strong className="font-semibold text-primary">{children}</strong>,
  ul: ({ children }) => (
    <ul className="list-disc list-inside mb-3 space-y-1 text-foreground">{children}</ul>
  ),
});
const DigestMarkdown = ({
  digest,
  embedModalArticle,
  onCloseEmbedded,
  onNavigateArticle,
  onOpenArticle,
}: Readonly<{
  readonly digest: string;
  readonly embedModalArticle?: NewsArticle;
  readonly onCloseEmbedded: () => void;
  readonly onNavigateArticle: (direction: "previous" | "next") => void;
  readonly onOpenArticle: (article: NewsArticle) => void;
}>): React.ReactElement => {
  const components = useMemo(() => createDigestComponents(onOpenArticle), [onOpenArticle]);
  const handleNavigate = useCallback(
    (direction: "prev" | "next"): void => {
      if (direction === "prev") {
        onNavigateArticle("previous");
        return;
      }
      onNavigateArticle("next");
    },
    [onNavigateArticle],
  );
  return (
    <div className="px-6 py-8 prose prose-invert max-w-none text-foreground">
      <ReactMarkdown components={components}>{digest}</ReactMarkdown>
      {embedModalArticle !== undefined && (
        <ArticleDetailModal
          article={embedModalArticle}
          isOpen
          onClose={onCloseEmbedded}
          onNavigate={handleNavigate}
        />
      )}
    </div>
  );
};

const DigestHeader = ({
  articleCount,
  onClose,
}: Readonly<Pick<QueueDigestViewProps, "articleCount" | "onClose">>): React.ReactElement => (
  <SheetHeader className="px-6 pt-6 pb-4 border-b">
    <div className="flex items-center justify-between">
      <DigestHeading articleCount={articleCount} />
      <DigestCloseButton onClose={onClose} />
    </div>
  </SheetHeader>
);

const DigestCloseButton = ({ onClose }: Readonly<Pick<QueueDigestViewProps, "onClose">>) => (
  <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close digest">
    <X className="h-5 w-5" />
  </Button>
);

const DigestHeading = ({
  articleCount,
}: Readonly<Pick<QueueDigestViewProps, "articleCount">>): React.ReactElement => (
  <div>
    <SheetTitle className="text-3xl font-semibold font-serif">Reading Digest</SheetTitle>
    <p className="text-sm text-muted-foreground mt-1">
      {articleCount} articles summarized for quick review
    </p>
  </div>
);

const DigestLoading = (): React.ReactElement => (
  <div className="flex flex-col items-center justify-center gap-3 h-full">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    <p className="text-muted-foreground">Generating your digest...</p>
  </div>
);

const DigestEmptyState = ({ error }: Readonly<{ readonly error?: string }>): React.ReactElement => (
  <div className="flex items-center justify-center h-full">
    <p className="text-muted-foreground">{error ?? "Failed to generate digest"}</p>
  </div>
);

const DigestContent = ({
  digestError,
  digestLoading,
  embedModalArticle,
  onEmbedClose,
  onNavigateArticle,
  onOpenArticle,
  queueDigest,
}: Readonly<
  Pick<
    QueueDigestViewProps,
    | "digestError"
    | "digestLoading"
    | "embedModalArticle"
    | "onEmbedClose"
    | "onNavigateArticle"
    | "onOpenArticle"
    | "queueDigest"
  >
>): React.ReactElement => {
  if (digestLoading) {
    return <DigestLoading />;
  }
  if (queueDigest !== undefined && queueDigest !== "") {
    return (
      <DigestMarkdown
        digest={queueDigest}
        embedModalArticle={embedModalArticle}
        onCloseEmbedded={onEmbedClose}
        onNavigateArticle={onNavigateArticle}
        onOpenArticle={onOpenArticle}
      />
    );
  }
  return <DigestEmptyState error={digestError} />;
};

const QueueDigestView = ({
  articleCount,
  digestError,
  digestLoading,
  embedModalArticle,
  onClose,
  onEmbedClose,
  onNavigateArticle,
  onOpenArticle,
  queueDigest,
}: QueueDigestViewProps): React.ReactElement => (
  <>
    <DigestHeader articleCount={articleCount} onClose={onClose} />
    <div className="flex-1 overflow-y-auto">
      <DigestContent
        digestError={digestError}
        digestLoading={digestLoading}
        embedModalArticle={embedModalArticle}
        onEmbedClose={onEmbedClose}
        onNavigateArticle={onNavigateArticle}
        onOpenArticle={onOpenArticle}
        queueDigest={queueDigest}
      />
    </div>
  </>
);

export { QueueDigestView };
