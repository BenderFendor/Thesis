"use client";

import { Badge } from "@/components/ui/badge";

interface KeywordsFooterProps {
  readonly keywords: readonly string[];
}

const KeywordsFooter = ({ keywords }: Readonly<KeywordsFooterProps>) => {
  if (keywords.length === 0) {
    return null;
  }
  return (
    <div className="border-t border-border/60 px-4 py-3 flex-shrink-0 flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">Keywords:</span>
      {keywords.slice(0, 8).map((keyword) => (
        <Badge
          key={keyword}
          variant="outline"
          className="text-[10px] bg-[var(--news-bg-secondary)]"
        >
          {keyword}
        </Badge>
      ))}
    </div>
  );
};

export { KeywordsFooter };
