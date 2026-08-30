"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { Highlighter, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ENABLE_HIGHLIGHTS } from "@/lib/api";
import type { Highlight } from "@/lib/api";
import { createHighlightFingerprint } from "@/lib/highlight-store";
import { getGlobalOffset } from "@/lib/highlight-utils";

const FIRST_RANGE_INDEX = 0;
const EMPTY_RANGE_COUNT = 0;
const INVALID_OFFSET = -1;
const TEXT_PREVIEW_START = 0;
const TEXT_PREVIEW_LENGTH = 80;
const SELECTION_RESET_DELAY_MS = 120;
const TOOLBAR_VERTICAL_OFFSET_PX = 50;
const TOOLBAR_HORIZONTAL_FALLBACK_PX = 100;
const TOOLBAR_MIN_POSITION_PX = 8;
const HALF_DIVISOR = 2;
const HIGHLIGHT_DEBUG = true;

interface HighlightRange {
  readonly end: number;
  readonly start: number;
}

interface CreateHighlightPayload {
  readonly color: Highlight["color"];
  readonly highlightedText: string;
  readonly range: HighlightRange;
}

interface HighlightToolbarProps {
  readonly articleUrl: string;
  readonly autoCreate: boolean;
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly highlightColor: Highlight["color"];
  readonly highlights: readonly Highlight[];
  readonly onCreate: (payload: CreateHighlightPayload) => Promise<void> | void;
  readonly onDelete: (payload: Readonly<{ highlightId: number }>) => Promise<void> | void;
  readonly onUpdate: (
    payload: Readonly<{ highlightId: number; note: string }>,
  ) => Promise<void> | void;
}

interface SelectionSnapshot {
  readonly range: Range;
  readonly selection: Selection;
  readonly text: string;
}

interface SelectionOffsets {
  readonly end: number;
  readonly start: number;
}

type OffsetResult =
  | Readonly<{ ok: true; offsets: SelectionOffsets }>
  | Readonly<{ message: string; ok: false }>;

const hideToolbar = (toolbar: HTMLDivElement | null): void => {
  if (toolbar !== null) {
    toolbar.style.display = "none";
  }
};

const clearBrowserSelection = (): void => {
  globalThis.getSelection()?.removeAllRanges();
};

const getSelectionSnapshot = (): SelectionSnapshot | undefined => {
  const selection = globalThis.getSelection();
  if (selection === null || selection.rangeCount === EMPTY_RANGE_COUNT) {
    return undefined;
  }
  const text = selection.toString();
  if (selection.isCollapsed || text.trim().length === EMPTY_RANGE_COUNT) {
    return undefined;
  }
  return {
    range: selection.getRangeAt(FIRST_RANGE_INDEX),
    selection,
    text,
  };
};

const selectionInsideContainer = (
  container: HTMLElement,
  snapshot: Readonly<SelectionSnapshot>,
): boolean => {
  const anchor = snapshot.selection.anchorNode;
  const focus = snapshot.selection.focusNode;
  const anchorInside = anchor !== null && container.contains(anchor);
  const focusInside = focus !== null && container.contains(focus);
  const commonInside = container.contains(snapshot.range.commonAncestorContainer);
  return anchorInside || focusInside || commonInside;
};

const resolveSelectionOffsets = (
  container: HTMLElement,
  snapshot: Readonly<SelectionSnapshot>,
): OffsetResult => {
  const startOffset = getGlobalOffset(
    container,
    snapshot.range.startContainer,
    snapshot.range.startOffset,
  );
  const endOffset = getGlobalOffset(
    container,
    snapshot.range.endContainer,
    snapshot.range.endOffset,
  );
  if (HIGHLIGHT_DEBUG) {
    console.debug("[HighlightToolbar] computed offsets", {
      endOffset,
      selectedText: snapshot.text.slice(TEXT_PREVIEW_START, TEXT_PREVIEW_LENGTH),
      startOffset,
    });
  }
  if (startOffset === INVALID_OFFSET || endOffset === INVALID_OFFSET) {
    return { message: "Selection outside of article content", ok: false };
  }
  const start = Math.min(startOffset, endOffset);
  const end = Math.max(startOffset, endOffset);
  if (start === end) {
    return { message: "Empty selection", ok: false };
  }
  return { offsets: { end, start }, ok: true };
};

const isDeletedHighlight = (highlight: Readonly<Highlight>): boolean =>
  "deleted" in highlight && highlight.deleted === true;

const hasExactDuplicate = (
  highlights: readonly Highlight[],
  highlightedText: string,
  offsets: Readonly<SelectionOffsets>,
): boolean => {
  const fingerprint = createHighlightFingerprint({
    character_end: offsets.end,
    character_start: offsets.start,
    highlighted_text: highlightedText,
  });
  return highlights.some((highlight) => {
    if (isDeletedHighlight(highlight)) {
      return false;
    }
    return (
      createHighlightFingerprint({
        character_end: highlight.character_end,
        character_start: highlight.character_start,
        highlighted_text: highlight.highlighted_text,
      }) === fingerprint
    );
  });
};

const getRangeRect = (range: Range): DOMRect | undefined => {
  try {
    return range.getBoundingClientRect();
  } catch {
    return undefined;
  }
};

const positionToolbar = (
  toolbar: HTMLDivElement,
  range: Range,
  container: HTMLElement,
): void => {
  const rect = getRangeRect(range);
  const containerRect = container.getBoundingClientRect();
  if (HIGHLIGHT_DEBUG) {
    console.debug("[HighlightToolbar] positioning", {
      containerClientHeight: container.clientHeight,
      containerConnected: container.isConnected,
      containerLeft: containerRect.left,
      containerTop: containerRect.top,
      rectLeft: rect?.left,
      rectTop: rect?.top,
    });
  }
  let top = globalThis.innerHeight / HALF_DIVISOR;
  let left = globalThis.innerWidth / HALF_DIVISOR - TOOLBAR_HORIZONTAL_FALLBACK_PX;
  if (rect !== undefined) {
    top = rect.top - TOOLBAR_VERTICAL_OFFSET_PX;
    left = rect.left;
  }
  toolbar.style.top = `${Math.max(TOOLBAR_MIN_POSITION_PX, top)}px`;
  toolbar.style.left = `${Math.max(TOOLBAR_MIN_POSITION_PX, left)}px`;
  toolbar.style.display = "flex";
};

const logOutsideSelection = (
  container: HTMLElement,
  snapshot: Readonly<SelectionSnapshot>,
): void => {
  if (!HIGHLIGHT_DEBUG) {
    return;
  }
  console.debug("[HighlightToolbar] selection outside container", {
    anchorNode: snapshot.selection.anchorNode?.nodeName,
    commonAncestor: snapshot.range.commonAncestorContainer.nodeName,
    containerNode: container.nodeName,
    focusNode: snapshot.selection.focusNode?.nodeName,
    selectionText: snapshot.text.slice(TEXT_PREVIEW_START, TEXT_PREVIEW_LENGTH),
  });
};

const logInsideSelection = (snapshot: Readonly<SelectionSnapshot>): void => {
  if (!HIGHLIGHT_DEBUG) {
    return;
  }
  console.debug("[HighlightToolbar] selection inside container", {
    endContainer: snapshot.range.endContainer.nodeName,
    selectionText: snapshot.text.slice(TEXT_PREVIEW_START, TEXT_PREVIEW_LENGTH),
    startContainer: snapshot.range.startContainer.nodeName,
  });
};

export const HighlightToolbar = ({
  autoCreate,
  containerRef,
  highlightColor,
  highlights,
  onCreate,
}: Readonly<HighlightToolbarProps>) => {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const selectionHandledRef = useRef(false);

  const closeToolbar = useCallback(() => {
    hideToolbar(toolbarRef.current);
    clearBrowserSelection();
  }, []);

  const handleCreateHighlight = useCallback(async () => {
    const container = containerRef.current;
    const snapshot = getSelectionSnapshot();
    if (container === null || snapshot === undefined) {
      toast.error("No text selected");
      return;
    }
    const offsetResult = resolveSelectionOffsets(container, snapshot);
    if (!offsetResult.ok) {
      toast.error(offsetResult.message);
      return;
    }
    if (hasExactDuplicate(highlights, snapshot.text, offsetResult.offsets)) {
      toast.error("That exact text is already highlighted");
      return;
    }
    try {
      await onCreate({
        color: highlightColor,
        highlightedText: snapshot.text,
        range: offsetResult.offsets,
      });
      toast.success("Highlight created");
      clearBrowserSelection();
      selectionHandledRef.current = true;
      globalThis.setTimeout(() => {
        selectionHandledRef.current = false;
      }, SELECTION_RESET_DELAY_MS);
      hideToolbar(toolbarRef.current);
    } catch (error: unknown) {
      toast.error("Failed to create highlight");
      console.error(error);
    }
  }, [containerRef, highlightColor, highlights, onCreate]);

  useEffect(() => {
    if (!ENABLE_HIGHLIGHTS) {
      return;
    }
    if (HIGHLIGHT_DEBUG) {
      console.debug("[HighlightToolbar] mounted", {
        containerNode: containerRef.current?.nodeName,
        hasContainer: containerRef.current !== null,
      });
    }

    const handleSelection = () => {
      if (HIGHLIGHT_DEBUG) {
        console.debug("[HighlightToolbar] handleSelection fired");
      }
      const snapshot = getSelectionSnapshot();
      const container = containerRef.current;
      if (snapshot === undefined || container === null) {
        hideToolbar(toolbarRef.current);
        return;
      }
      if (!selectionInsideContainer(container, snapshot)) {
        logOutsideSelection(container, snapshot);
        hideToolbar(toolbarRef.current);
        return;
      }
      if (autoCreate && !selectionHandledRef.current) {
        void handleCreateHighlight();
        hideToolbar(toolbarRef.current);
        return;
      }
      logInsideSelection(snapshot);
      const toolbar = toolbarRef.current;
      if (toolbar !== null) {
        positionToolbar(toolbar, snapshot.range, container);
      }
    };

    const handleSelectionChange = () => {
      if (HIGHLIGHT_DEBUG) {
        console.debug("[HighlightToolbar] selectionchange event");
      }
      if (getSelectionSnapshot() === undefined) {
        hideToolbar(toolbarRef.current);
      }
    };

    globalThis.document.addEventListener("pointerup", handleSelection, {
      capture: true,
    });
    globalThis.document.addEventListener("mouseup", handleSelection, {
      capture: true,
    });
    globalThis.document.addEventListener("keyup", handleSelection, {
      capture: true,
    });
    globalThis.document.addEventListener("selectionchange", handleSelectionChange, {
      capture: true,
    });

    return () => {
      globalThis.document.removeEventListener("pointerup", handleSelection, {
        capture: true,
      });
      globalThis.document.removeEventListener("mouseup", handleSelection, {
        capture: true,
      });
      globalThis.document.removeEventListener("keyup", handleSelection, {
        capture: true,
      });
      globalThis.document.removeEventListener(
        "selectionchange",
        handleSelectionChange,
        { capture: true },
      );
    };
  }, [autoCreate, containerRef, handleCreateHighlight]);

  if (!ENABLE_HIGHLIGHTS) {
    return;
  }

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 hidden max-w-xs flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg duration-200 animate-in fade-in zoom-in-95 dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="mb-1 flex w-full items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <Highlighter className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          <span className="text-xs font-semibold text-gray-500">Highlight</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={closeToolbar}
          className="h-5 w-5 p-0"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex w-full gap-1">
        <Button
          size="sm"
          onClick={handleCreateHighlight}
          className="h-7 flex-1 py-1 text-xs"
        >
          Highlight
        </Button>
      </div>
    </div>
  );
};
