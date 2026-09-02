
import type { Highlight } from "@/lib/api";
import { forwardRef } from "react";
import { getArticleContentRef } from "@/lib/article-content-ref";
import { renderHighlightedContent } from "@/lib/highlight-utils";

interface HighlightAnchorElement {
  readonly contains: HTMLElement["contains"];
  readonly getBoundingClientRect: () => DOMRect;
}

interface ArticleContentProps {
  readonly activeHighlightId?: string | null;
  readonly className?: string;
  readonly content: string;
  readonly highlights: readonly Readonly<Highlight>[];
  readonly onHighlightClick?: (id: string, element: HighlightAnchorElement) => void;
}

const
 ARTICLE_CONTENT_STYLE = { whiteSpace: "pre-wrap", wordBreak: "break-word" } as const,
 ArticleContent = forwardRef<HTMLDivElement, Readonly<ArticleContentProps>>((...args: Readonly<[Readonly<ArticleContentProps>, Readonly<object> | null]>) => {
    const [props, ref] = args, { activeHighlightId, className, content, highlights, onHighlightClick } = props;

    return <div ref={getArticleContentRef(ref)} className={`article-content selection:bg-primary/20 selection:text-foreground ${className}`} style={ARTICLE_CONTENT_STYLE}>
      {renderHighlightedContent(content, highlights, onHighlightClick, activeHighlightId)}
    </div>;
  });

ArticleContent.displayName = "ArticleContent";

export { ArticleContent };
