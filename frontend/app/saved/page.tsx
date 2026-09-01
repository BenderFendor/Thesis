"use client";

import { SavedWorkspaceView } from "@/app/saved/saved-workspace-view";
import { useSavedWorkspaceController } from "@/app/saved/use-saved-workspace-controller";

const SavedArticlesPage = () => {
  const controller = useSavedWorkspaceController();
  return <SavedWorkspaceView controller={controller} />;
};

export default SavedArticlesPage;
