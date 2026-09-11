const workspaceSupport = {
  tabs: [
    { id: "ingestion", label: "Ingestion" },
    { id: "storage", label: "Storage" },
    { id: "parser", label: "Parser" },
    { id: "llm", label: "Model Calls" },
    { id: "errors", label: "Errors" },
    { id: "performance", label: "Performance" },
    { id: "media", label: "Media Record" },
  ],
} as const;

export default workspaceSupport;
