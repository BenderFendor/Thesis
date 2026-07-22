// The legacy force-directed graph workspace this file used to support was
// retired in the Atlas Phase 6 UI restructure -- the directory is now the
// primary landing surface and the graph is a secondary "Explore graph" tab
// inside the main Intelligence Atlas workspace component.
// `AtlasOperationsSheet` (backed by the sibling operations panel in this
// directory) still uses the workspace-tab vocabulary below, so it stays.

export type WorkspaceTab = "ingestion" | "storage" | "parser" | "llm" | "errors" | "performance" | "media";

export const WORKSPACE_TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "ingestion", label: "Ingestion" },
  { id: "storage", label: "Storage" },
  { id: "parser", label: "Parser" },
  { id: "llm", label: "Model Calls" },
  { id: "errors", label: "Errors" },
  { id: "performance", label: "Performance" },
  { id: "media", label: "Media Record" },
];
