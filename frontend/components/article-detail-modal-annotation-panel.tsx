"use client";

import { useCallback } from "react";
import { Copy, Download, Eye, EyeOff, Minimize2, PlusCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Highlight } from "../lib/article-detail-modal-data";
import { logUserAction } from "@/lib/performance-logger";
import { toast } from "sonner";

const HIGHLIGHT_COLOR_CLASSES = {
  blue: "bg-sky-200/80 text-sky-900",
  green: "bg-emerald-200/80 text-emerald-900",
  purple: "bg-purple-200/80 text-purple-900",
  red: "bg-rose-200/80 text-rose-900",
  yellow: "bg-amber-200/80 text-amber-900",
} satisfies Record<Highlight["color"], string>;

const HIGHLIGHT_STATUS_LABELS = {
  failed: "Failed",
  idle: "Synced",
  offline: "Offline",
  syncing: "Saving",
} satisfies Record<"idle" | "syncing" | "failed" | "offline", string>;

interface ModalAnnotationsPanelProps {
  readonly articleScrollProgress: number;
  readonly articleTitle: string;
  readonly articleUrl: string;
  readonly estimatedReadMinutes: number;
  readonly highlightColor: Highlight["color"];
  readonly highlightCount: number;
  readonly highlightSyncStatus: "idle" | "syncing" | "failed" | "offline";
  readonly obsidianMarkdown: string;
  readonly onBackToTop: () => void;
  readonly onColorSelect: (color: Highlight["color"]) => void;
  readonly onRetrySync: () => void;
  readonly onToggleShowHighlights: () => void;
  readonly showHighlights: boolean;
  readonly wordCount: number;
}

const getAnnotationBorderClassName = (active: boolean): string => {
  if (active) {
    return "border-foreground";
  }
  return "border-transparent";
};

const getHighlightStatusLabel = (status: "idle" | "syncing" | "failed" | "offline"): string =>
  HIGHLIGHT_STATUS_LABELS[status];

const getHighlightToggleLabel = (showHighlights: boolean): string => {
  if (showHighlights) {
    return "Hide";
  }
  return "Show";
};

const getHighlightWordSummary = (wordCount: number, estimatedReadMinutes: number): string => {
  if (wordCount > 0) {
    return `${wordCount} words • ${estimatedReadMinutes} min read`;
  }
  return `${estimatedReadMinutes} min read`;
};

const getHighlightNote = (note: string | undefined): string => {
  if (note !== undefined && note.trim() !== "") {
    return note;
  }
  return "No note";
};

const getModalHighlightClassName = (active: boolean, color: Highlight["color"]): string => {
  const borderClassName = getAnnotationBorderClassName(active);
  return [
    "rounded-md",
    "px-3",
    "py-2",
    "text-sm",
    HIGHLIGHT_COLOR_CLASSES[color],
    borderClassName,
  ].join(" ");
};

const ModalAnnotationColorButton = ({
  color,
  highlightColor,
  onColorSelect,
}: Readonly<{
  color: Highlight["color"];
  highlightColor: Highlight["color"];
  onColorSelect: (color: Highlight["color"]) => void;
}>) => {
  const handleClick = useCallback(() => {
    onColorSelect(color);
  }, [color, onColorSelect]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={`h-7 w-7 rounded border ${getAnnotationBorderClassName(highlightColor === color)} ${HIGHLIGHT_COLOR_CLASSES[color]}`}
      aria-label={`Annotation color ${color}`}
    />
  );
};

const ModalAnnotationColorPicker = ({
  highlightColor,
  onColorSelect,
}: Readonly<{
  highlightColor: Highlight["color"];
  onColorSelect: (color: Highlight["color"]) => void;
}>) => (
  <div className="mt-3 flex flex-wrap gap-2">
    {(["yellow", "blue", "red", "green", "purple"] as const).map((color) => (
      <ModalAnnotationColorButton
        key={color}
        color={color}
        highlightColor={highlightColor}
        onColorSelect={onColorSelect}
      />
    ))}
  </div>
);

const ModalCopyAnnotationsButton = ({
  articleUrl,
  obsidianMarkdown,
}: Readonly<{
  articleUrl: string;
  obsidianMarkdown: string;
}>) => {
  const copyAnnotations = useCallback(async (): Promise<void> => {
    await navigator.clipboard.writeText(obsidianMarkdown);
    toast.success("Obsidian Markdown copied");
    logUserAction("highlight_markdown_copied", { url: articleUrl });
  }, [articleUrl, obsidianMarkdown]);
  const handleCopyAnnotations = useCallback(() => {
    void copyAnnotations();
  }, [copyAnnotations]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopyAnnotations}
      className="gap-2"
    >
      <Copy className="h-4 w-4" />
      Copy
    </Button>
  );
};

const sanitizeAnnotationFilename = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+/gu, "")
    .replaceAll(/-+$/gu, "")
    .slice(0, 80) || "annotations";

const ModalExportAnnotationsButton = ({
  articleTitle,
  articleUrl,
  obsidianMarkdown,
}: Readonly<{
  articleTitle: string;
  articleUrl: string;
  obsidianMarkdown: string;
}>) => {
  const exportAnnotations = useCallback((): void => {
    const blob = new Blob([obsidianMarkdown], { type: "text/markdown" });
    const fileName = `${sanitizeAnnotationFilename(articleTitle)}.md`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
    logUserAction("highlight_markdown_downloaded", { url: articleUrl });
    toast.success("Obsidian Markdown exported");
  }, [articleTitle, articleUrl, obsidianMarkdown]);
  return (
    <Button type="button" variant="outline" size="sm" onClick={exportAnnotations} className="gap-2">
      <Download className="h-4 w-4" />
      Export
    </Button>
  );
};

const ModalObsidianAddButton = ({
  articleTitle,
  articleUrl,
  obsidianMarkdown,
}: Readonly<{
  articleTitle: string;
  articleUrl: string;
  obsidianMarkdown: string;
}>) => {
  const title = articleTitle.replaceAll(/[:\\/]/gu, "-");
  const openObsidian = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(obsidianMarkdown);
      globalThis.location.href = `obsidian://new?file=${encodeURIComponent(`News Clippings/${title}`)}&clipboard=true`;
      toast.success("Opening in Obsidian...");
    } catch {
      globalThis.location.href = `obsidian://new?file=${encodeURIComponent(`News Clippings/${title}`)}&content=${encodeURIComponent(obsidianMarkdown)}`;
      toast.success("Opening in Obsidian...");
    }
    logUserAction("highlight_sent_to_obsidian", { url: articleUrl });
  }, [articleUrl, obsidianMarkdown, title]);
  const handleOpenObsidian = useCallback(() => {
    void openObsidian();
  }, [openObsidian]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleOpenObsidian}
      className="col-span-2 gap-2 border-accent/40 bg-accent/15 text-accent-foreground hover:bg-accent/25"
    >
      <PlusCircle className="h-4 w-4" />
      Add to Obsidian
    </Button>
  );
};

const ModalAnnotationExportActions = ({
  articleTitle,
  articleUrl,
  obsidianMarkdown,
}: Readonly<{
  articleTitle: string;
  articleUrl: string;
  obsidianMarkdown: string;
}>) => (
  <div className="mt-3 grid grid-cols-2 gap-2">
    <ModalObsidianAddButton
      articleTitle={articleTitle}
      articleUrl={articleUrl}
      obsidianMarkdown={obsidianMarkdown}
    />
    <ModalCopyAnnotationsButton articleUrl={articleUrl} obsidianMarkdown={obsidianMarkdown} />
    <ModalExportAnnotationsButton
      articleTitle={articleTitle}
      articleUrl={articleUrl}
      obsidianMarkdown={obsidianMarkdown}
    />
  </div>
);

const HighlightVisibilityIcon = ({ showHighlights }: Readonly<{ showHighlights: boolean }>) => {
  if (showHighlights) {
    return <EyeOff className="h-4 w-4" />;
  }
  return <Eye className="h-4 w-4" />;
};

const ModalAnnotationsControls = ({
  estimatedReadMinutes,
  highlightSyncStatus,
  onRetrySync,
  onToggleShowHighlights,
  showHighlights,
  wordCount,
}: Readonly<{
  estimatedReadMinutes: number;
  highlightSyncStatus: "idle" | "syncing" | "failed" | "offline";
  onRetrySync: () => void;
  onToggleShowHighlights: () => void;
  showHighlights: boolean;
  wordCount: number;
}>) => (
  <div className="mt-3 flex flex-wrap items-center gap-2">
    {highlightSyncStatus === "failed" && (
      <Button type="button" variant="outline" size="sm" onClick={onRetrySync} className="gap-2">
        <RefreshCw className="h-4 w-4" />
        Retry sync
      </Button>
    )}
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onToggleShowHighlights}
      className="gap-2"
    >
      <HighlightVisibilityIcon showHighlights={showHighlights} />
      {getHighlightToggleLabel(showHighlights)}
    </Button>
    <span className="text-xs text-muted-foreground">
      {getHighlightWordSummary(wordCount, estimatedReadMinutes)}
    </span>
  </div>
);

const ModalAnnotationsTitle = () => (
  <div>
    <div className="text-xs uppercase tracking-widest text-muted-foreground">Reader</div>
    <h2 className="text-lg font-semibold text-foreground">Annotations</h2>
  </div>
);

const ModalAnnotationsStatus = ({
  highlightCount,
  highlightSyncStatus,
}: Readonly<{
  highlightCount: number;
  highlightSyncStatus: "idle" | "syncing" | "failed" | "offline";
}>) => (
  <div className="flex flex-col items-end gap-1">
    <span className="text-xs text-muted-foreground">{highlightCount}</span>
    <div className="text-xs uppercase tracking-widest text-muted-foreground">
      {getHighlightStatusLabel(highlightSyncStatus)}
    </div>
  </div>
);

const ModalAnnotationsHeader = ({
  highlightCount,
  highlightSyncStatus,
}: Readonly<{
  highlightCount: number;
  highlightSyncStatus: "idle" | "syncing" | "failed" | "offline";
}>) => (
  <div className="flex items-center justify-between">
    <ModalAnnotationsTitle />
    <ModalAnnotationsStatus
      highlightCount={highlightCount}
      highlightSyncStatus={highlightSyncStatus}
    />
  </div>
);

const ModalAnnotationsProgress = ({
  articleScrollProgress,
}: Readonly<{ articleScrollProgress: number }>) => (
  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
    <div>Reading progress</div>
    <div className="font-mono text-foreground">{Math.round(articleScrollProgress * 100)}%</div>
  </div>
);

const ModalAnnotationsBackToTop = ({ onBackToTop }: Readonly<{ onBackToTop: () => void }>) => (
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={onBackToTop}
    className="mt-2 w-full gap-2"
  >
    <Minimize2 className="h-4 w-4 rotate-180" />
    Back to top
  </Button>
);

const ModalAnnotationsPanel = ({
  articleScrollProgress,
  articleTitle,
  articleUrl,
  estimatedReadMinutes,
  highlightColor,
  highlightCount,
  highlightSyncStatus,
  obsidianMarkdown,
  onBackToTop,
  onColorSelect,
  onRetrySync,
  onToggleShowHighlights,
  showHighlights,
  wordCount,
}: Readonly<ModalAnnotationsPanelProps>) => (
  <div className="rounded-lg border border-border/60 bg-secondary/70 p-4">
    <ModalAnnotationsHeader
      highlightCount={highlightCount}
      highlightSyncStatus={highlightSyncStatus}
    />
    <ModalAnnotationsControls
      estimatedReadMinutes={estimatedReadMinutes}
      highlightSyncStatus={highlightSyncStatus}
      onRetrySync={onRetrySync}
      onToggleShowHighlights={onToggleShowHighlights}
      showHighlights={showHighlights}
      wordCount={wordCount}
    />
    <ModalAnnotationColorPicker highlightColor={highlightColor} onColorSelect={onColorSelect} />
    <ModalAnnotationExportActions
      articleTitle={articleTitle}
      articleUrl={articleUrl}
      obsidianMarkdown={obsidianMarkdown}
    />
    <p className="mt-2 text-xs text-muted-foreground">
      Select text to highlight. Click a highlight to add a note.
    </p>
    <ModalAnnotationsProgress articleScrollProgress={articleScrollProgress} />
    <ModalAnnotationsBackToTop onBackToTop={onBackToTop} />
  </div>
);

export { ModalAnnotationsPanel, getHighlightNote, getModalHighlightClassName };
