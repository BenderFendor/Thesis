"use client";

import { HighlightNotePopover } from "@/components/highlight-note-popover";
import { InlineDefinitionPopover as InlineDefinition } from "@/components/inline-definition";
import { ModalWikiOverlay } from "@/components/article-detail-modal-wiki";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type { ArticleDetailDialogBodyProps } from "../lib/article-detail-modal-types";
import { getBodyHandlers } from "./article-detail-modal-handlers";

interface ArticleDetailBodyBoundaryProps {
  readonly bodyProps: DeepReadonly<ArticleDetailDialogBodyProps>;
}

const ArticleDetailDialogOverlays = ({
  bodyProps,
}: Readonly<ArticleDetailBodyBoundaryProps>) => {
  const bodyHandlers = getBodyHandlers(bodyProps);
  return (
    <>
      <InlineDefinition
        result={bodyProps.inlineResult}
        open={bodyProps.inlineOpen}
        setOpen={bodyProps.setInlineOpen}
        anchorPosition={bodyProps.inlineAnchorPosition}
      />
      <HighlightNotePopover
        open={bodyProps.highlightPopoverOpen}
        highlight={bodyProps.highlightPopoverHighlight ?? undefined}
        anchorEl={bodyProps.highlightPopoverAnchorEl ?? undefined}
        onClose={bodyHandlers.handleCloseHighlightPopover}
        onSave={bodyHandlers.handleSaveHighlightNote}
        articleTitle={bodyProps.currentArticle.title}
        articleSource={bodyProps.currentArticle.source}
      />
      <ModalWikiOverlay
        wikiPanelOpen={bodyProps.wikiPanelOpen}
        setWikiPanelOpen={bodyProps.setWikiPanelOpen}
        wikiPanelTab={bodyProps.wikiPanelTab}
        setWikiPanelTab={bodyProps.setWikiPanelTab}
        currentArticle={bodyProps.currentArticle}
        reporterName={bodyProps.reporterName}
        hasSourceWiki={bodyProps.hasSourceWiki}
        hasReporterWiki={bodyProps.hasReporterWiki}
        articleHost={bodyProps.articleHost}
        articleWikiContext={bodyProps.articleWikiContext}
      />
    </>
  );
};

export { ArticleDetailDialogOverlays };
