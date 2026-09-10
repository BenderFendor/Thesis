"use client";

import { useCallback } from "react";
import type { ChangeEventHandler } from "react";
import { Edit2, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HighlightClickHandler, LocalHighlight } from "../lib/article-detail-modal-data";
import { highlightStableId } from "../lib/article-detail-modal-data";
import {
  getHighlightNote,
  getModalHighlightClassName,
} from "./article-detail-modal-annotation-panel";
import Link from "next/link";

interface ModalHighlightEditorProps {
  readonly editingNote: string;
  readonly highlight: LocalHighlight;
  readonly onCancelEdit: () => void;
  readonly onNoteChange: (value: string) => void;
  readonly onSaveNote: (stableId: string, note: string) => void;
}

interface ModalHighlightFocusButtonProps {
  readonly articleContentRef: Readonly<{ current: HTMLDivElement | null }>;
  readonly highlight: LocalHighlight;
  readonly onHighlightClick: HighlightClickHandler;
}

interface ModalHighlightItemProps {
  readonly articleContentRef: Readonly<{ current: HTMLDivElement | null }>;
  readonly articleSource: string;
  readonly articleTitle: string;
  readonly editingId: string | undefined;
  readonly editingNote: string;
  readonly highlight: LocalHighlight;
  readonly index: number;
  readonly onCancelEdit: () => void;
  readonly onDelete: (highlight: LocalHighlight) => void;
  readonly onHighlightClick: HighlightClickHandler;
  readonly onNoteChange: (value: string) => void;
  readonly onSaveNote: (stableId: string, note: string) => void;
  readonly onStartEdit: (highlight: LocalHighlight) => void;
}

interface ModalHighlightsContentProps {
  readonly articleContentRef: Readonly<{ current: HTMLDivElement | null }>;
  readonly articleSource: string;
  readonly articleTitle: string;
  readonly editingId: string | undefined;
  readonly editingNote: string;
  readonly highlights: readonly LocalHighlight[];
  readonly onCancelEdit: () => void;
  readonly onDelete: (highlight: LocalHighlight) => void;
  readonly onHighlightClick: HighlightClickHandler;
  readonly onNoteChange: (value: string) => void;
  readonly onSaveNote: (stableId: string, note: string) => void;
  readonly onStartEdit: (highlight: LocalHighlight) => void;
}

const ModalHighlightEditor = ({
  editingNote,
  highlight,
  onCancelEdit,
  onNoteChange,
  onSaveNote,
}: Readonly<ModalHighlightEditorProps>) => {
  const handleNoteChange = useCallback<ChangeEventHandler<HTMLTextAreaElement>>(
    (event) => {
      onNoteChange(event.target.value);
    },
    [onNoteChange],
  );
  const handleSave = useCallback(() => {
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
};

const ModalHighlightFocusButton = ({
  articleContentRef,
  highlight,
  onHighlightClick,
}: Readonly<ModalHighlightFocusButtonProps>) => {
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
};

const ModalHighlightDetails = ({
  articleSource,
  articleTitle,
  editingId,
  editingNote,
  highlight,
  onCancelEdit,
  onDelete,
  onNoteChange,
  onSaveNote,
  onStartEdit,
}: Readonly<
  Pick<
    ModalHighlightItemProps,
    | "articleSource"
    | "articleTitle"
    | "editingId"
    | "editingNote"
    | "highlight"
    | "onCancelEdit"
    | "onDelete"
    | "onNoteChange"
    | "onSaveNote"
    | "onStartEdit"
  >
>) => {
  if (editingId === highlightStableId(highlight)) {
    return (
      <ModalHighlightEditor
        editingNote={editingNote}
        highlight={highlight}
        onCancelEdit={onCancelEdit}
        onNoteChange={onNoteChange}
        onSaveNote={onSaveNote}
      />
    );
  }
  return (
    <ModalHighlightSummary
      articleSource={articleSource}
      articleTitle={articleTitle}
      highlight={highlight}
      onDelete={onDelete}
      onStartEdit={onStartEdit}
    />
  );
};

const ModalHighlightItem = ({
  articleContentRef,
  articleSource,
  articleTitle,
  editingId,
  editingNote,
  highlight,
  index,
  onCancelEdit,
  onDelete,
  onHighlightClick,
  onNoteChange,
  onSaveNote,
  onStartEdit,
}: Readonly<ModalHighlightItemProps>) => (
  <div className="relative space-y-3 rounded-lg border border-border/60 bg-background/60 p-4">
    <div className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-background font-mono text-xs font-bold text-muted-foreground shadow-sm">
      {index + 1}
    </div>
    <ModalHighlightFocusButton
      articleContentRef={articleContentRef}
      highlight={highlight}
      onHighlightClick={onHighlightClick}
    />
    <ModalHighlightDetails
      articleSource={articleSource}
      articleTitle={articleTitle}
      editingId={editingId}
      editingNote={editingNote}
      highlight={highlight}
      onCancelEdit={onCancelEdit}
      onDelete={onDelete}
      onNoteChange={onNoteChange}
      onSaveNote={onSaveNote}
      onStartEdit={onStartEdit}
    />
  </div>
);

const ModalHighlightResearchLink = ({
  articleSource,
  articleTitle,
  highlightedText,
}: Readonly<{
  articleSource: string;
  articleTitle: string;
  highlightedText: string;
}>) => (
  <Link
    href={`/search?query=${encodeURIComponent(`Context: ${articleTitle} by ${articleSource}\n\nExplain this highlighted passage:\n\n> ${highlightedText}`)}`}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/40 bg-transparent text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/15 hover:text-primary"
    title="Research this highlight"
  >
    <Search className="h-3.5 w-3.5" />
  </Link>
);

const ModalHighlightSummaryActions = ({
  articleSource,
  articleTitle,
  highlight,
  onDelete,
  onStartEdit,
}: Readonly<{
  articleSource: string;
  articleTitle: string;
  highlight: LocalHighlight;
  onDelete: () => void;
  onStartEdit: () => void;
}>) => (
  <div className="flex items-center gap-1">
    <ModalHighlightResearchLink
      articleSource={articleSource}
      articleTitle={articleTitle}
      highlightedText={highlight.highlighted_text}
    />
    <Button type="button" variant="ghost" size="sm" onClick={onStartEdit}>
      <Edit2 className="h-4 w-4" />
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onDelete}
      className="text-destructive hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  </div>
);

const ModalHighlightSummary = ({
  articleSource,
  articleTitle,
  highlight,
  onDelete,
  onStartEdit,
}: Readonly<{
  articleSource: string;
  articleTitle: string;
  highlight: LocalHighlight;
  onDelete: (highlight: LocalHighlight) => void;
  onStartEdit: (highlight: LocalHighlight) => void;
}>) => {
  const handleStartEdit = useCallback(() => {
    onStartEdit(highlight);
  }, [highlight, onStartEdit]);
  const handleDelete = useCallback(() => {
    onDelete(highlight);
  }, [highlight, onDelete]);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="line-clamp-2 break-words whitespace-pre-wrap text-xs text-muted-foreground">
        {getHighlightNote(highlight.note)}
      </div>
      <ModalHighlightSummaryActions
        articleSource={articleSource}
        articleTitle={articleTitle}
        highlight={highlight}
        onDelete={handleDelete}
        onStartEdit={handleStartEdit}
      />
    </div>
  );
};

const ModalHighlightsContent = (props: Readonly<ModalHighlightsContentProps>) => {
  if (props.highlights.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
        No annotations yet.
      </div>
    );
  }
  return props.highlights
    .filter((highlight) => highlight.deleted !== true)
    .toSorted(
      (leftHighlight, rightHighlight) =>
        leftHighlight.character_start - rightHighlight.character_start,
    )
    .map((highlight, index) => (
      <ModalHighlightItem
        articleContentRef={props.articleContentRef}
        articleSource={props.articleSource}
        articleTitle={props.articleTitle}
        editingId={props.editingId}
        editingNote={props.editingNote}
        highlight={highlight}
        index={index}
        key={highlightStableId(highlight)}
        onCancelEdit={props.onCancelEdit}
        onDelete={props.onDelete}
        onHighlightClick={props.onHighlightClick}
        onNoteChange={props.onNoteChange}
        onSaveNote={props.onSaveNote}
        onStartEdit={props.onStartEdit}
      />
    ));
};

const ModalHighlightsList = (props: Readonly<ModalHighlightsContentProps>) => (
  <div className="space-y-3">
    <ModalHighlightsContent
      articleContentRef={props.articleContentRef}
      articleSource={props.articleSource}
      articleTitle={props.articleTitle}
      editingId={props.editingId}
      editingNote={props.editingNote}
      highlights={props.highlights}
      onCancelEdit={props.onCancelEdit}
      onDelete={props.onDelete}
      onHighlightClick={props.onHighlightClick}
      onNoteChange={props.onNoteChange}
      onSaveNote={props.onSaveNote}
      onStartEdit={props.onStartEdit}
    />
  </div>
);

export { ModalHighlightsList };
