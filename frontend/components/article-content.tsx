
import { forwardRef } from "react";
import type { Highlight } from "@/lib/api";
import { renderHighlightedContent } from "@/lib/highlight-utils";

interface ArticleContentProps {
  readonly activeHighlightId?: string | null;
  readonly className?: string;
  readonly content: string;
  readonly highlights: readonly Highlight[];
  readonly onHighlightClick?: (id: string, element: HTMLElement) => void;
}

const ARTICLE_CONTENT_STYLE = { whiteSpace: "pre-wrap", wordBreak: "break-word" } as const,

 ArticleContent = forwardRef<HTMLDivElement, Readonly<ArticleContentProps>>(
  (props, ref) => {
    const { activeHighlightId, className, content, highlights, onHighlightClick } = props;

    return (
      <div
        ref={ref}
        className={`article-content selection:bg-primary/20 selection:text-foreground ${className}`}
        style={ARTICLE_CONTENT_STYLE}
      >
        {renderHighlightedContent(content, highlights, onHighlightClick, activeHighlightId)}
      </div>
    );
  },
);


ArticleContent.displayName = "ArticleContent";

export { ArticleContent };
