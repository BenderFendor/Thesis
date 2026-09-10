"use client";

import { hasText } from "@/lib/utils";
import type { ArticleAnalysis, ModalActionsProps } from "../lib/article-detail-modal-data";
import { ExternalLink, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModalActionButtons } from "./article-detail-modal-action-buttons";

const ModalPersistenceNotice = ({ canPersist }: Readonly<{ canPersist: boolean }>) => {
  if (canPersist) {
    return null;
  }
  return (
    <span className="text-xs text-muted-foreground">
      This article is readable here, but likes and bookmarks only work for indexed archive items.
    </span>
  );
};

const ReadOriginalButton = ({ articleUrl }: Readonly<{ articleUrl: string }>) => (
  <Button variant="outline" size="sm" asChild>
    <a href={articleUrl} target="_blank" rel="noopener noreferrer">
      <ExternalLink className="mr-2 h-4 w-4" />
      Read Original
    </a>
  </Button>
);

const ModalActionFooter = ({ props }: Readonly<{ props: Readonly<ModalActionsProps> }>) => (
  <div className="relative z-10 mb-20 flex items-center justify-between border-t border-gray-800 pt-6">
    <ModalActionButtons props={props} />
    <ModalPersistenceNotice canPersist={props.canPersist} />
    <ReadOriginalButton articleUrl={props.article.url} />
  </div>
);

const ModalActions = (props: Readonly<ModalActionsProps>) => <ModalActionFooter props={props} />;

const ModalAiCleanNote = ({
  aiAnalysis,
  fullArticleText,
  articleContent,
}: Readonly<{
  aiAnalysis: ArticleAnalysis | undefined;
  fullArticleText: string | null | undefined;
  articleContent?: string;
}>) => {
  if (
    !(
      hasText(aiAnalysis?.full_text) &&
      aiAnalysis.full_text !== fullArticleText &&
      aiAnalysis.full_text !== articleContent
    )
  ) {
    return null;
  }
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-white">Clean Reading View</h3>
      </div>
      <p className="mb-3 text-sm text-gray-400">A clean text version is available.</p>
      <details className="text-sm">
        <summary className="cursor-pointer text-primary hover:text-primary/80">
          Show AI Version
        </summary>
        <div className="mt-3 whitespace-pre-wrap text-gray-300 leading-relaxed">
          {aiAnalysis.full_text}
        </div>
      </details>
    </div>
  );
};

const ModalTags = ({ tags }: Readonly<{ tags: readonly string[] }>) => (
  <div>
    <h4 className="mb-3 text-sm font-medium text-gray-400">Tags</h4>
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <Badge key={tag} variant="outline" className="text-xs">
          {tag}
        </Badge>
      ))}
    </div>
  </div>
);

export { ModalActions, ModalAiCleanNote, ModalTags };
export { ModalAnnotationsPanel } from "./article-detail-modal-annotation-panel";
export { ModalHighlightsList } from "./article-detail-modal-highlights";
