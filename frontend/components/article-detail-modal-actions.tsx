"use client";
import { hasText } from "@/lib/utils";

import type {
  ActionIconProps,
  ArticleAnalysis,
  Highlight,
  HighlightClickHandler,
  LocalHighlight,
  ModalActionButtonsProps,
  ModalActionsProps,
  NewsArticle,
} from "../lib/article-detail-modal-data";
import {
  Bookmark,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  Heart,
  Loader2,
  Minimize2,
  MinusCircle,
  PlusCircle,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { highlightStableId } from "../lib/article-detail-modal-data";
import { logUserAction } from "@/lib/performance-logger";
import { useCallback } from 'react';
import type { ChangeEventHandler } from 'react';
import { toast } from "sonner";

const AnalysisActionButton = ({
    active,
    aiActionLabel,
    aiAnalysisLoading,
    aiHasError,
    canRequestAiAnalysis,
    onClick,
  }: Readonly<{
    readonly active: boolean;
    readonly aiActionLabel: string;
    readonly aiAnalysisLoading: boolean;
    readonly aiHasError: boolean;
    readonly canRequestAiAnalysis: boolean;
    readonly onClick: () => void;
  }>) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={!canRequestAiAnalysis || aiAnalysisLoading}
      className={getActionClassName(active && !aiHasError, "text-emerald-400")}
      title="AI analysis is opt-in to reduce API calls"
    >
      <AnalysisActionIcon loading={aiAnalysisLoading} />
      {aiActionLabel}
    </Button>
  ),
  AnalysisActionIcon = ({ loading }: Readonly<{ loading: boolean }>) => {
    if (loading) {
      return <Loader2 className="h-4 w-4 mr-2 animate-spin" />;
    }
    return <Sparkles className="h-4 w-4 mr-2" />;
  },
  BookmarkActionButton = ({
    active,
    canPersist,
    loading,
    onClick,
  }: Readonly<{
    readonly active: boolean;
    readonly canPersist: boolean;
    readonly loading: boolean;
    readonly onClick: () => void;
  }>) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={getActionClassName(active, "text-yellow-400")}
      disabled={loading || !canPersist}
      title={(() => {
  if (canPersist) {
    return "Bookmark article";
  }
  return "Only indexed articles can be bookmarked.";
})()}
    >
      <BookmarkActionIcon active={active} />
      Bookmark
    </Button>
  ),
  BookmarkActionIcon = ({ active }: Readonly<ActionIconProps>) => (
    <Bookmark className={`h-4 w-4 ${getActionIconClassName(active)}`} />
  ),
  EMPTY_COUNT = 0,
  FavoriteActionButton = ({
    active,
    onClick,
  }: Readonly<{
    readonly active: boolean;
    readonly onClick: () => void;
  }>) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={getActionClassName(active, "text-yellow-400")}
      title={(() => {
  if (active) {
    return "Remove from favorites";
  }
  return "Add to favorites";
})()}
    >
      <FavoriteActionIcon active={active} />
      Favorite
    </Button>
  ),
  FavoriteActionIcon = ({ active }: Readonly<ActionIconProps>) => (
    <Star className={`h-4 w-4 mr-2 ${getActionIconClassName(active)}`} />
  ),
  HIGHLIGHT_COLOR_CLASSES = {
    blue: "bg-sky-200/80 text-sky-900",
    green: "bg-emerald-200/80 text-emerald-900",
    purple: "bg-purple-200/80 text-purple-900",
    red: "bg-rose-200/80 text-rose-900",
    yellow: "bg-amber-200/80 text-amber-900",
  } satisfies Record<Highlight["color"], string>,
  HIGHLIGHT_STATUS_LABELS = {
    failed: "Failed",
    idle: "Synced",
    offline: "Offline",
    syncing: "Saving",
  } satisfies Record<"idle" | "syncing" | "failed" | "offline", string>,
  LikeActionButton = ({
    active,
    canPersist,
    onClick,
  }: Readonly<{
    readonly active: boolean;
    readonly canPersist: boolean;
    readonly onClick: () => void;
  }>) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={getActionClassName(active, "text-red-400")}
      disabled={!canPersist}
      title={(() => {
  if (canPersist) {
    return "Like article";
  }
  return "Only indexed articles can be liked.";
})()}
    >
      <LikeActionIcon active={active} />
      Like
    </Button>
  ),
  LikeActionIcon = ({ active }: Readonly<ActionIconProps>) => (
    <Heart className={`h-4 w-4 mr-2 ${getActionIconClassName(active)}`} />
  ),
  ModalActionButtons = ({
    aiActionLabel,
    aiAnalysisLoading,
    aiAnalysisRequested,
    aiHasError,
    bookmarked,
    bookmarkLoading,
    canPersist,
    canRequestAiAnalysis,
    favorited,
    inQueue,
    liked,
    onAiAnalysis,
    onBookmark,
    onFavorite,
    onLike,
    onQueueToggle,
  }: Readonly<ModalActionButtonsProps>) => (
    <div className="flex items-center gap-4">
      <LikeActionButton active={liked} canPersist={canPersist} onClick={onLike} />
      <FavoriteActionButton active={favorited} onClick={onFavorite} />
      <BookmarkActionButton
        active={bookmarked}
        canPersist={canPersist}
        loading={bookmarkLoading}
        onClick={onBookmark}
      />
      <AnalysisActionButton
        active={aiAnalysisRequested}
        aiActionLabel={aiActionLabel}
        aiAnalysisLoading={aiAnalysisLoading}
        aiHasError={aiHasError}
        canRequestAiAnalysis={canRequestAiAnalysis}
        onClick={onAiAnalysis}
      />
      <QueueActionButton active={inQueue} onClick={onQueueToggle} />
    </div>
  ),
  ModalActions = ({
    article,
    canPersist,
    bookmarkLoading,
    aiAnalysisLoading,
    canRequestAiAnalysis,
    aiAnalysisRequested,
    aiHasError,
    aiActionLabel,
    isLiked,
    isFavorite,
    isBookmarked,
    isArticleInQueue,
    onLike,
    onFavorite,
    onBookmark,
    onAiAnalysis,
    onQueueToggle,
  }: Readonly<ModalActionsProps>) => {
    const { liked, favorited, bookmarked, inQueue } = getModalActionStates(
      article,
      isLiked,
      isFavorite,
      isBookmarked,
      isArticleInQueue,
    );

    return (
      <div className="flex items-center justify-between pt-6 border-t border-gray-800 relative z-10 mb-20">
        <ModalActionButtons
          aiActionLabel={aiActionLabel}
          aiAnalysisLoading={aiAnalysisLoading}
          aiAnalysisRequested={aiAnalysisRequested}
          aiHasError={aiHasError}
          bookmarked={bookmarked}
          bookmarkLoading={bookmarkLoading}
          canPersist={canPersist}
          canRequestAiAnalysis={canRequestAiAnalysis}
          favorited={favorited}
          inQueue={inQueue}
          liked={liked}
          onAiAnalysis={onAiAnalysis}
          onBookmark={onBookmark}
          onFavorite={onFavorite}
          onLike={onLike}
          onQueueToggle={onQueueToggle}
        />
        <ModalPersistenceNotice canPersist={canPersist} />
        <Button variant="outline" size="sm" asChild>
          <a href={article.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" />
            Read Original
          </a>
        </Button>
      </div>
    );
  },
  ModalAiCleanNote = ({
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
      <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-white">Clean Reading View</h3>
        </div>
        <p className="text-sm text-gray-400 mb-3">A clean text version is available.</p>
        <details className="text-sm">
          <summary className="cursor-pointer text-primary hover:text-primary/80">
            Show AI Version
          </summary>
          <div className="mt-3 text-gray-300 leading-relaxed whitespace-pre-wrap">
            {aiAnalysis.full_text}
          </div>
        </details>
      </div>
    );
  },
  ModalAnnotationColorButton = ({
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
        className={`h-7 w-7 rounded border ${(() => {
  if (highlightColor === color) {
    return "border-foreground";
  }
  return "border-transparent";
})()} ${HIGHLIGHT_COLOR_CLASSES[color]}`}
        aria-label={`Annotation color ${color}`}
      />
    );
  },
  ModalAnnotationColorPicker = ({
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
  ),
  ModalAnnotationExportActions = ({
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
  ),
  ModalAnnotationsControls = ({
    highlightSyncStatus,
    onRetrySync,
    showHighlights,
    onToggleShowHighlights,
    wordCount,
    estimatedReadMinutes,
  }: Readonly<{
    highlightSyncStatus: "idle" | "syncing" | "failed" | "offline";
    onRetrySync: () => void;
    showHighlights: boolean;
    onToggleShowHighlights: () => void;
    wordCount: number;
    estimatedReadMinutes: number;
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
        {(() => {
  if (showHighlights) {
    return <EyeOff className="h-4 w-4" />;
  }
  return <Eye className="h-4 w-4" />;
})()}
        {getHighlightToggleLabel(showHighlights)}
      </Button>
      <span className="text-xs text-muted-foreground">
        {getHighlightWordSummary(wordCount, estimatedReadMinutes)}
      </span>
    </div>
  ),
  ModalAnnotationsHeader = ({
    highlightCount,
    highlightSyncStatus,
  }: Readonly<{
    highlightCount: number;
    highlightSyncStatus: "idle" | "syncing" | "failed" | "offline";
  }>) => (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Reader</div>
        <h2 className="text-lg font-semibold text-foreground">Annotations</h2>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-xs text-muted-foreground">{highlightCount}</span>
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          {getHighlightStatusLabel(highlightSyncStatus)}
        </div>
      </div>
    </div>
  ),
  ModalAnnotationsPanel = ({
    highlightCount,
    highlightSyncStatus,
    onRetrySync,
    showHighlights,
    onToggleShowHighlights,
    wordCount,
    estimatedReadMinutes,
    highlightColor,
    onColorSelect,
    obsidianMarkdown,
    articleTitle,
    articleUrl,
    articleScrollProgress,
    onBackToTop,
  }: Readonly<{
    highlightCount: number;
    highlightSyncStatus: "idle" | "syncing" | "failed" | "offline";
    onRetrySync: () => void;
    showHighlights: boolean;
    onToggleShowHighlights: () => void;
    wordCount: number;
    estimatedReadMinutes: number;
    highlightColor: Highlight["color"];
    onColorSelect: (color: Highlight["color"]) => void;
    obsidianMarkdown: string;
    articleTitle: string;
    articleUrl: string;
    articleScrollProgress: number;
    onBackToTop: () => void;
  }>) => (
    <div className="rounded-lg border border-border/60 bg-secondary/70 p-4">
      <ModalAnnotationsHeader
        highlightCount={highlightCount}
        highlightSyncStatus={highlightSyncStatus}
      />
      <ModalAnnotationsControls
        highlightSyncStatus={highlightSyncStatus}
        onRetrySync={onRetrySync}
        showHighlights={showHighlights}
        onToggleShowHighlights={onToggleShowHighlights}
        wordCount={wordCount}
        estimatedReadMinutes={estimatedReadMinutes}
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
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
        <div>Reading progress</div>
        <div className="font-mono text-foreground">{Math.round(articleScrollProgress * 100)}%</div>
      </div>
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
    </div>
  ),
  ModalCopyAnnotationsButton = ({
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
  },
  ModalExportAnnotationsButton = ({
    articleTitle,
    articleUrl,
    obsidianMarkdown,
  }: Readonly<{
    articleTitle: string;
    articleUrl: string;
    obsidianMarkdown: string;
  }>) => {
    const exportAnnotations = useCallback((): void => {
      const sanitizeFilename = (value: string): string =>
          value
            .toLowerCase()
            .replaceAll(/[^a-z0-9]+/gu, "-")
            .replaceAll(/(^-|-$)+/gu, "")
            .slice(0, 80) || "annotations";
      const blob = new Blob([obsidianMarkdown], { type: "text/markdown" });
      const fileName = `${sanitizeFilename(articleTitle)}.md`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      logUserAction("highlight_markdown_downloaded", { url: articleUrl });
      toast.success("Obsidian Markdown exported");
    }, [articleTitle, articleUrl, obsidianMarkdown]);
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={exportAnnotations}
        className="gap-2"
      >
        <Download className="h-4 w-4" />
        Export
      </Button>
    );
  },
  ModalHighlightEditor = ({
    highlight,
    editingNote,
    onCancelEdit,
    onNoteChange,
    onSaveNote,
  }: Readonly<{
    highlight: LocalHighlight;
    editingNote: string;
    onCancelEdit: () => void;
    onNoteChange: (value: string) => void;
    onSaveNote: (stableId: string, note: string) => void;
  }>) => {
    const handleNoteChange = useCallback<ChangeEventHandler<HTMLTextAreaElement>>(
        (event) => {
          onNoteChange(event.target.value);
        },
        [onNoteChange],
      ),
      handleSave = useCallback(() => {
        onSaveNote(highlightStableId(highlight), editingNote);
      }, [editingNote, highlight, onSaveNote]);
    return (
      <div className="space-y-2">
        <textarea
          value={editingNote}
          onChange={handleNoteChange}
          placeholder="Add a note..."
          rows={3}
          className="w-full rounded border border-border/60 bg-background px-2 py-1 text-sm text-foreground"
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={onCancelEdit}>
            Cancel
          </Button>
        </div>
      </div>
    );
  },
  ModalHighlightFocusButton = ({
    highlight,
    articleContentRef,
    onHighlightClick,
  }: Readonly<{
    highlight: LocalHighlight;
    articleContentRef: Readonly<{ current: HTMLDivElement | null }>;
    onHighlightClick: HighlightClickHandler;
  }>) => {
    const focusHighlight = useCallback((): void => {
      const stableId = highlightStableId(highlight);
      const element = articleContentRef.current?.querySelector(
          `mark[data-highlight-stable-id="${stableId}"]`,
        );
      if (element instanceof HTMLElement) {
        onHighlightClick(stableId, element);
      }
    }, [articleContentRef, highlight, onHighlightClick]);
    return (
      <button type="button" className="w-full text-left" onClick={focusHighlight}>
        <div className={getModalHighlightClassName(false, highlight.color)}>
          {highlight.highlighted_text}
        </div>
      </button>
    );
  },
  ModalHighlightItem = ({
    highlight,
    index,
    articleTitle,
    articleSource,
    onHighlightClick,
    articleContentRef,
    editingId,
    editingNote,
    onStartEdit,
    onCancelEdit,
    onNoteChange,
    onSaveNote,
    onDelete,
  }: Readonly<{
    highlight: LocalHighlight;
    index: number;
    articleTitle: string;
    articleSource: string;
    onHighlightClick: HighlightClickHandler;
    articleContentRef: Readonly<{ current: HTMLDivElement | null }>;
    editingId: string | undefined;
    editingNote: string;
    onStartEdit: (highlight: LocalHighlight) => void;
    onCancelEdit: () => void;
    onNoteChange: (value: string) => void;
    onSaveNote: (stableId: string, note: string) => void;
    onDelete: (highlight: LocalHighlight) => void;
  }>) => (
    <div className="relative rounded-lg border border-border/60 bg-background/60 p-4 space-y-3">
      <div className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-background font-mono text-xs font-bold text-muted-foreground shadow-sm">
        {index + 1}
      </div>
      <ModalHighlightFocusButton
        highlight={highlight}
        articleContentRef={articleContentRef}
        onHighlightClick={onHighlightClick}
      />
      {(() => {
  if (editingId === highlightStableId(highlight)) {
    return <ModalHighlightEditor highlight={highlight} editingNote={editingNote} onCancelEdit={onCancelEdit} onNoteChange={onNoteChange} onSaveNote={onSaveNote} />;
  }
  return <ModalHighlightSummary highlight={highlight} articleTitle={articleTitle} articleSource={articleSource} onStartEdit={onStartEdit} onDelete={onDelete} />;
})()}
    </div>
  ),
  ModalHighlightSummary = ({
    highlight,
    articleTitle,
    articleSource,
    onStartEdit,
    onDelete,
  }: Readonly<{
    highlight: LocalHighlight;
    articleTitle: string;
    articleSource: string;
    onStartEdit: (highlight: LocalHighlight) => void;
    onDelete: (highlight: LocalHighlight) => void;
  }>) => {
    const handleStartEdit = useCallback(() => {
        onStartEdit(highlight);
      }, [highlight, onStartEdit]);
    const handleDelete = useCallback(() => {
        onDelete(highlight);
      }, [highlight, onDelete]);
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap break-words">
          {getHighlightNote(highlight.note)}
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/search?query=${encodeURIComponent(`Context: ${articleTitle} by ${articleSource}\n\nExplain this highlighted passage:\n\n> ${highlight.highlighted_text}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-transparent text-muted-foreground transition-all hover:bg-primary/15 hover:border-primary/40 hover:text-primary"
            title="Research this highlight"
          >
            <Search className="h-3.5 w-3.5" />
          </Link>
          <Button type="button" variant="ghost" size="sm" onClick={handleStartEdit}>
            <Edit2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  },
  ModalHighlightsContent = (
    props: Readonly<{
      highlights: readonly LocalHighlight[];
      articleTitle: string;
      articleSource: string;
      onHighlightClick: HighlightClickHandler;
      articleContentRef: Readonly<{ current: HTMLDivElement | null }>;
      editingId: string | undefined;
      editingNote: string;
      onStartEdit: (highlight: LocalHighlight) => void;
      onCancelEdit: () => void;
      onNoteChange: (value: string) => void;
      onSaveNote: (stableId: string, note: string) => void;
      onDelete: (highlight: LocalHighlight) => void;
    }>,
  ) => {
    if (props.highlights.length === 0) {
      return (
        <div className="rounded-lg border border-border/60 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
          No annotations yet.
        </div>
      );
    }
    return props.highlights
      .filter((highlight) => highlight.deleted !== true)
      .toSorted((a, b) => a.character_start - b.character_start)
      .map((highlight, index) => (
        <ModalHighlightItem
          key={highlightStableId(highlight)}
          index={index}
          {...props}
          highlight={highlight}
        />
      ));
  },
  ModalHighlightsList = ({
    highlights,
    articleTitle,
    articleSource,
    onHighlightClick,
    articleContentRef,
    editingId,
    editingNote,
    onStartEdit,
    onCancelEdit,
    onNoteChange,
    onSaveNote,
    onDelete,
  }: Readonly<{
    highlights: readonly LocalHighlight[];
    articleTitle: string;
    articleSource: string;
    onHighlightClick: HighlightClickHandler;
    articleContentRef: Readonly<{ current: HTMLDivElement | null }>;
    editingId: string | undefined;
    editingNote: string;
    onStartEdit: (highlight: LocalHighlight) => void;
    onCancelEdit: () => void;
    onNoteChange: (value: string) => void;
    onSaveNote: (stableId: string, note: string) => void;
    onDelete: (highlight: LocalHighlight) => void;
  }>) => (
    <div className="space-y-3">
      <ModalHighlightsContent
        highlights={highlights}
        articleTitle={articleTitle}
        articleSource={articleSource}
        onHighlightClick={onHighlightClick}
        articleContentRef={articleContentRef}
        editingId={editingId}
        editingNote={editingNote}
        onStartEdit={onStartEdit}
        onCancelEdit={onCancelEdit}
        onNoteChange={onNoteChange}
        onSaveNote={onSaveNote}
        onDelete={onDelete}
      />
    </div>
  ),
  ModalObsidianAddButton = ({
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
  },
  ModalPersistenceNotice = ({ canPersist }: Readonly<{ canPersist: boolean }>) => {
    if (canPersist) {
      return null;
    }
    return (
      <span className="text-xs text-muted-foreground">
        This article is readable here, but likes and bookmarks only work for indexed archive items.
      </span>
    );
  },
  ModalTags = ({ tags }: Readonly<{ tags: readonly string[] }>) => (
    <div>
      <h4 className="text-sm font-medium text-gray-400 mb-3">Tags</h4>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline" className="text-xs">
            {tag}
          </Badge>
        ))}
      </div>
    </div>
  ),
  QueueActionButton = ({
    active,
    onClick,
  }: Readonly<{
    readonly active: boolean;
    readonly onClick: () => void;
  }>) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={getActionClassName(active, "text-blue-400")}
    >
      <QueueActionIcon active={active} />
      {(() => {
  if (active) {
    return "Remove from Queue";
  }
  return "Add to Queue";
})()}
    </Button>
  ),
  QueueActionIcon = ({ active }: Readonly<ActionIconProps>) => {
    if (active) {
      return <MinusCircle className="h-4 w-4 mr-2" />;
    }
    return <PlusCircle className="h-4 w-4 mr-2" />;
  },
  getActionClassName = (active: boolean, activeClass: string): string => {
    if (active) {
      return activeClass;
    }
    return "text-gray-400";
  },
  getActionIconClassName = (active: boolean): string => {
    if (active) {
      return "fill-current";
    }
    return "";
  },
  getHighlightNote = (note: string | undefined): string => {
    if (note !== undefined && note.trim() !== "") {
      return note;
    }
    return "No note";
  },
  getHighlightStatusLabel = (status: "idle" | "syncing" | "failed" | "offline"): string =>
    HIGHLIGHT_STATUS_LABELS[status],
  getHighlightToggleLabel = (showHighlights: boolean): string => {
    if (showHighlights) {
      return "Hide";
    }
    return "Show";
  },
  getHighlightWordSummary = (wordCount: number, estimatedReadMinutes: number): string => {
    if (wordCount > 0) {
      return `${wordCount} words • ${estimatedReadMinutes} min read`;
    }
    return `${estimatedReadMinutes} min read`;
  },
  getModalActionStates = (
    article: Readonly<NewsArticle>,
    isLiked: (articleId: number) => boolean,
    isFavorite: (sourceId: string) => boolean,
    isBookmarked: (articleId: number) => boolean,
    isArticleInQueue: (url: string) => boolean,
  ) => ({
    bookmarked: article.id !== EMPTY_COUNT && isBookmarked(article.id),
    favorited: isFavorite(article.sourceId),
    inQueue: isArticleInQueue(article.url),
    liked: article.id !== EMPTY_COUNT && isLiked(article.id),
  }),
  getModalHighlightClassName = (active: boolean, color: Highlight["color"]): string => {
    const classes = ["rounded-md", "px-3", "py-2", "text-sm", HIGHLIGHT_COLOR_CLASSES[color]];
    classes.push((() => {
  if (active) {
    return "border-foreground";
  }
  return "border-transparent";
})());
    return classes.join(" ");
  };

export { ModalActions, ModalAiCleanNote, ModalAnnotationsPanel, ModalHighlightsList, ModalTags };
