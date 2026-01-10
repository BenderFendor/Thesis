
import React, { forwardRef } from "react";
import { Highlight } from "@/lib/api";
import { renderHighlightedContent } from "@/lib/highlight-utils";

interface ArticleContentProps {
  content: string;
  highlights: Highlight[];
  onHighlightClick?: (id: number) => void;
  className?: string;
}

export const ArticleContent = forwardRef<HTMLDivElement, ArticleContentProps>(
  ({ content, highlights, onHighlightClick, className }, ref) => {
    return (
      <div
        ref={ref}
        className={`article-content selection:bg-primary/20 selection:text-foreground ${className}`}
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {renderHighlightedContent(content, highlights, onHighlightClick)}
      </div>
    );
  }
);

ArticleContent.displayName = "ArticleContent";
