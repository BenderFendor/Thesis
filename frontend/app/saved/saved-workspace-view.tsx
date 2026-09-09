import type { ReactElement } from "react";
import { useCallback } from "react";
import { ArticleDetailModal } from "@/components/article-detail-modal";
import type { ControllerProps } from "@/app/saved/saved-workspace-types";
import { WorkspaceTabs } from "@/app/saved/saved-workspace-tabs";
import { LoadIssuesCard, WorkspaceHeader } from "@/app/saved/saved-workspace-shell";

const SavedWorkspaceView = (props: Readonly<ControllerProps>): ReactElement => {
  const { controller } = props;
  const handleClose = useCallback(() => {
    controller.closeArticle();
  }, [controller]);
  return (
    <div className="min-h-screen bg-[var(--news-bg-primary)]">
      <WorkspaceHeader controller={controller} />
      <div className="container mx-auto px-4 py-6">
        <LoadIssuesCard controller={controller} />
        <WorkspaceTabs controller={controller} />
      </div>
      <ArticleDetailModal
        article={controller.selectedArticle}
        isOpen={controller.isArticleModalOpen}
        onClose={handleClose}
      />
    </div>
  );
};

export { SavedWorkspaceView };
