"use client";

import { Highlighter, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ENABLE_HIGHLIGHTS } from "@/lib/api";

import type { Highlight } from "@/lib/api";
import { getGlobalOffset } from "@/lib/highlight-utils";
import { toast } from "sonner";
import {
  getHighlightElementView,
  getSelectionSnapshot,
  hasExactDuplicate,
} from "./highlight-toolbar-selection";
import type {
  HighlightElementView,
  HighlightRangeSnapshot,
  SelectionSnapshot,
  SelectionOffsets,
} from "./highlight-toolbar-selection";

const HALF_DIVISOR = 2,
  HIGHLIGHT_DEBUG = true,
  INVALID_OFFSET = -1,
  SELECTION_RESET_DELAY_MS = 120,
  TEXT_PREVIEW_LENGTH = 80,
  TEXT_PREVIEW_START = 0,
  TOOLBAR_HORIZONTAL_FALLBACK_PX = 100,
  TOOLBAR_MIN_POSITION_PX = 8,
  TOOLBAR_VERTICAL_OFFSET_PX = 50;

interface HighlightRange {
  readonly end: number;
  readonly start: number;
}

interface CreateHighlightPayload {
  readonly color: Highlight["color"];
  readonly highlightedText: string;
  readonly range: HighlightRange;
}

interface HighlightToolbarProps<TElement extends HTMLDivElement = HTMLDivElement> {
  readonly articleUrl: string;
  readonly autoCreate: boolean;
  readonly containerRef: { readonly current: TElement | null };
  readonly highlightColor: Highlight["color"];
  readonly highlights: readonly Highlight[];
  readonly onCreate: (payload: CreateHighlightPayload) => Promise<void> | void;
  readonly onDelete: (payload: Readonly<{ highlightId: number }>) => Promise<void> | void;
  readonly onUpdate: (
    payload: Readonly<{ highlightId: number; note: string }>,
  ) => Promise<void> | void;
}

type ReadonlyHighlightToolbarProps<TElement extends HTMLDivElement> = Readonly<
  HighlightToolbarProps<TElement>
>;

type OffsetResult =
  | Readonly<{ ok: true; offsets: SelectionOffsets }>
  | Readonly<{ message: string; ok: false }>;

type ToolbarRect = Readonly<Pick<DOMRect, "left" | "top">>;

const hideToolbar = (toolbar: HTMLDivElement | null): void => {
    if (toolbar !== null) {
      toolbar.style.display = "none";
    }
  };
const clearBrowserSelection = (): void => {
    globalThis.getSelection()?.removeAllRanges();
  };
const selectionInsideContainer = (
    container: Readonly<HighlightElementView>,
    snapshot: Readonly<SelectionSnapshot>,
  ): boolean => {
    const anchor = snapshot.selection.anchorNode;
    const focus = snapshot.selection.focusNode;
    const anchorInside = anchor !== null && container.contains(anchor.asNode());
    const focusInside = focus !== null && container.contains(focus.asNode());
    const commonInside = container.contains(snapshot.range.commonAncestorContainer.asNode());
    return anchorInside || focusInside || commonInside;
  };

const logComputedOffsets = (
  snapshot: Readonly<SelectionSnapshot>,
  startOffset: number,
  endOffset: number,
): void => {
  if (HIGHLIGHT_DEBUG) {
    console.debug("[HighlightToolbar] computed offsets", {
      endOffset,
      selectedText: snapshot.text.slice(TEXT_PREVIEW_START, TEXT_PREVIEW_LENGTH),
      startOffset,
    });
  }
};

const resolveSelectionOffsets = <TRoot extends Node>(
    container: Readonly<HighlightElementView>,
    root: Readonly<TRoot>,
    snapshot: Readonly<SelectionSnapshot>,
  ): OffsetResult => {
    const startOffset = getGlobalOffset(
        root,
        snapshot.range.startContainer.asNode(),
        snapshot.range.startOffset,
      );
    const endOffset = getGlobalOffset(
        root,
        snapshot.range.endContainer.asNode(),
        snapshot.range.endOffset,
      );
    logComputedOffsets(snapshot, startOffset, endOffset);
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
const getRangeRect = (range: Readonly<HighlightRangeSnapshot>): ToolbarRect | undefined => {
    try {
      return range.getBoundingClientRect();
    } catch {
      return void 0;
    }
  };
const applyToolbarPosition = (
    toolbar: HTMLDivElement,
    rect: ToolbarRect | undefined,
  ): void => {
    let left = globalThis.innerWidth / HALF_DIVISOR - TOOLBAR_HORIZONTAL_FALLBACK_PX,
      top = globalThis.innerHeight / HALF_DIVISOR;
    if (rect !== undefined) {
      top = rect.top - TOOLBAR_VERTICAL_OFFSET_PX;
      left = rect.left;
    }
    toolbar.style.top = `${Math.max(TOOLBAR_MIN_POSITION_PX, top)}px`;
    toolbar.style.left = `${Math.max(TOOLBAR_MIN_POSITION_PX, left)}px`;
    toolbar.style.display = "flex";
  };
const positionToolbar = (
    toolbar: HTMLDivElement,
    range: Readonly<HighlightRangeSnapshot>,
    container: Readonly<HighlightElementView>,
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
    applyToolbarPosition(toolbar, rect);
  };
const logOutsideSelection = (
    container: Readonly<HighlightElementView>,
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

interface ValidHighlightSelection {
  readonly offsets: SelectionOffsets;
  readonly snapshot: SelectionSnapshot;
}

type HighlightSelectionResult =
  | (Readonly<ValidHighlightSelection> & Readonly<{ ok: true }>)
  | Readonly<{ message: string; ok: false }>;

interface HighlightCreationOptions {
  readonly container: HTMLDivElement | null;
  readonly highlightColor: Highlight["color"];
  readonly highlights: readonly Highlight[];
  readonly markSelectionHandled: () => void;
  readonly onCreate: (payload: CreateHighlightPayload) => Promise<void> | void;
  readonly toolbar: HTMLDivElement | null;
}

const resolveHighlightSelection = (
  container: HTMLDivElement | null,
): HighlightSelectionResult => {
  const snapshot = getSelectionSnapshot();
  if (container === null || snapshot === undefined) {
    return { message: "No text selected", ok: false };
  }
  const offsetResult = resolveSelectionOffsets(getHighlightElementView(container), container, snapshot);
  if (!offsetResult.ok) {
    return offsetResult;
  }
  return { offsets: offsetResult.offsets, ok: true, snapshot };
};

const completeHighlightCreation = (
  toolbar: HTMLDivElement | null,
  markSelectionHandled: () => void,
): void => {
  toast.success("Highlight created");
  clearBrowserSelection();
  markSelectionHandled();
  hideToolbar(toolbar);
};

const persistHighlight = async (
  selection: Readonly<ValidHighlightSelection>,
  highlightColor: Highlight["color"],
  onCreate: (payload: CreateHighlightPayload) => Promise<void> | void,
): Promise<boolean> => {
  try {
    await onCreate({
      color: highlightColor,
      highlightedText: selection.snapshot.text,
      range: selection.offsets,
    });
    return true;
  } catch (error: unknown) {
    toast.error("Failed to create highlight");
    console.error(error);
    return false;
  }
};

const createHighlightFromSelection = async ({
  container,
  highlightColor,
  highlights,
  markSelectionHandled,
  onCreate,
  toolbar,
}: HighlightCreationOptions): Promise<void> => {
  const selection = resolveHighlightSelection(container);
  if (!selection.ok) {
    toast.error(selection.message);
    return;
  }
  if (hasExactDuplicate(highlights, selection.snapshot.text, selection.offsets)) {
    toast.error("That exact text is already highlighted");
    return;
  }
  if (await persistHighlight(selection, highlightColor, onCreate)) {
    completeHighlightCreation(toolbar, markSelectionHandled);
  }
};

interface HighlightSelectionEventContext {
  readonly autoCreate: boolean;
  readonly containerRef: { readonly current: HTMLDivElement | null };
  readonly handleCreateHighlight: () => Promise<void>;
  readonly selectionHandledRef: Readonly<{ readonly current: boolean }>;
  readonly toolbarRef: { readonly current: HTMLDivElement | null };
}

const shouldAutoCreateHighlight = (context: HighlightSelectionEventContext): boolean => {
  if (context.autoCreate && !context.selectionHandledRef.current) {
    void context.handleCreateHighlight();
    hideToolbar(context.toolbarRef.current);
    return true;
  }
  return false;
};

const processHighlightSelection = (
  snapshot: SelectionSnapshot,
  element: HTMLDivElement,
  context: HighlightSelectionEventContext,
): void => {
  const container = getHighlightElementView(element);
  if (!selectionInsideContainer(container, snapshot)) {
    logOutsideSelection(container, snapshot);
    hideToolbar(context.toolbarRef.current);
    return;
  }
  if (shouldAutoCreateHighlight(context)) {
    return;
  }
  showToolbarForSelection(snapshot, container, context);
};

const showToolbarForSelection = (
  snapshot: SelectionSnapshot,
  container: Readonly<HighlightElementView>,
  context: HighlightSelectionEventContext,
): void => {
  logInsideSelection(snapshot);
  const toolbar = context.toolbarRef.current;
  if (toolbar !== null) {
    positionToolbar(toolbar, snapshot.range, container);
  }
};

const handleHighlightSelectionEvent = (
  context: HighlightSelectionEventContext,
): void => {
  if (HIGHLIGHT_DEBUG) {
    console.debug("[HighlightToolbar] handleSelection fired");
  }
  const snapshot = getSelectionSnapshot();
  const element = context.containerRef.current;
  if (snapshot === undefined || element === null) {
    hideToolbar(context.toolbarRef.current);
    return;
  }
  processHighlightSelection(snapshot, element, context);
};

interface HighlightSelectionHandlers {
  readonly handleSelection: () => void;
  readonly handleSelectionChange: () => void;
}

const createHighlightSelectionHandlers = (
  context: HighlightSelectionEventContext,
): HighlightSelectionHandlers => ({
  handleSelection: () => {
    handleHighlightSelectionEvent(context);
  },
  handleSelectionChange: () => {
    if (HIGHLIGHT_DEBUG) {
      console.debug("[HighlightToolbar] selectionchange event");
    }
    if (getSelectionSnapshot() === undefined) {
      hideToolbar(context.toolbarRef.current);
    }
  },
});

const HIGHLIGHT_EVENT_OPTIONS = { capture: true } as const;

const addHighlightSelectionListeners = (handlers: HighlightSelectionHandlers): void => {
  globalThis.document.addEventListener("pointerup", handlers.handleSelection, HIGHLIGHT_EVENT_OPTIONS);
  globalThis.document.addEventListener("mouseup", handlers.handleSelection, HIGHLIGHT_EVENT_OPTIONS);
  globalThis.document.addEventListener("keyup", handlers.handleSelection, HIGHLIGHT_EVENT_OPTIONS);
  globalThis.document.addEventListener(
    "selectionchange",
    handlers.handleSelectionChange,
    HIGHLIGHT_EVENT_OPTIONS,
  );
};

const removeHighlightSelectionListeners = (handlers: HighlightSelectionHandlers): void => {
  globalThis.document.removeEventListener("pointerup", handlers.handleSelection, HIGHLIGHT_EVENT_OPTIONS);
  globalThis.document.removeEventListener("mouseup", handlers.handleSelection, HIGHLIGHT_EVENT_OPTIONS);
  globalThis.document.removeEventListener("keyup", handlers.handleSelection, HIGHLIGHT_EVENT_OPTIONS);
  globalThis.document.removeEventListener(
    "selectionchange",
    handlers.handleSelectionChange,
    HIGHLIGHT_EVENT_OPTIONS,
  );
};

const useHighlightSelectionListeners = (
  autoCreate: boolean,
  containerRef: { readonly current: HTMLDivElement | null },
  handleCreateHighlight: () => Promise<void>,
  selectionHandledRef: Readonly<{ readonly current: boolean }>,
  toolbarRef: { readonly current: HTMLDivElement | null },
): void => {
  useEffect(() => {
    if (!ENABLE_HIGHLIGHTS) {
      return () => {};
    }
    if (HIGHLIGHT_DEBUG) {
      console.debug("[HighlightToolbar] mounted", {
        containerNode: containerRef.current?.nodeName,
        hasContainer: containerRef.current !== null,
      });
    }
    const context: HighlightSelectionEventContext = {
      autoCreate,
      containerRef,
      handleCreateHighlight,
      selectionHandledRef,
      toolbarRef,
    };
    const handlers = createHighlightSelectionHandlers(context);
    addHighlightSelectionListeners(handlers);
    return () => {
      removeHighlightSelectionListeners(handlers);
    };
  }, [autoCreate, containerRef, handleCreateHighlight, selectionHandledRef, toolbarRef]);
};

const HighlightToolbarHeader = ({ onClose }: Readonly<{ onClose: () => void }>) => (
  <div className="mb-1 flex w-full items-center justify-between gap-1">
    <div className="flex items-center gap-1">
      <Highlighter className="h-4 w-4 text-gray-600 dark:text-gray-400" />
      <span className="text-xs font-semibold text-gray-500">Highlight</span>
    </div>
    <Button size="sm" variant="ghost" onClick={onClose} className="h-5 w-5 p-0">
      <X className="h-3 w-3" />
    </Button>
  </div>
);

type HighlightToolbarControllerProps<TElement extends HTMLDivElement> = Readonly<
  Pick<HighlightToolbarProps<TElement>, "containerRef" | "highlightColor" | "highlights" | "onCreate">
>;

interface HighlightToolbarController {
  readonly closeToolbar: () => void;
  readonly handleCreateHighlight: () => Promise<void>;
  readonly handleCreateHighlightClick: () => void;
  readonly markSelectionHandled: () => void;
  readonly selectionHandledRef: Readonly<{ readonly current: boolean }>;
  readonly toolbarRef: { readonly current: HTMLDivElement | null };
}

const useHighlightToolbarController = <TElement extends HTMLDivElement>(
  {
    containerRef,
    highlightColor,
    highlights,
    onCreate,
  }: HighlightToolbarControllerProps<TElement>,
): HighlightToolbarController => {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const selectionHandledRef = useRef(false);
  const closeToolbar = useCallback(() => {
    hideToolbar(toolbarRef.current);
    clearBrowserSelection();
  }, []);
  const markSelectionHandled = useCallback(() => {
    selectionHandledRef.current = true;
    globalThis.setTimeout(() => {
      selectionHandledRef.current = false;
    }, SELECTION_RESET_DELAY_MS);
  }, []);
  const handleCreateHighlight = useCallback(async () => {
    await createHighlightFromSelection({
      container: containerRef.current,
      highlightColor,
      highlights,
      markSelectionHandled,
      onCreate,
      toolbar: toolbarRef.current,
    });
  }, [containerRef, highlightColor, highlights, markSelectionHandled, onCreate]);
  const handleCreateHighlightClick = useCallback(() => {
    void handleCreateHighlight();
  }, [handleCreateHighlight]);

  return {
    closeToolbar,
    handleCreateHighlight,
    handleCreateHighlightClick,
    markSelectionHandled,
    selectionHandledRef,
    toolbarRef,
  };
};

export const HighlightToolbar = <TElement extends HTMLDivElement,>({
  autoCreate,
  containerRef,
  highlightColor,
  highlights,
  onCreate,
}: ReadonlyHighlightToolbarProps<TElement>) => {
  const {
    closeToolbar,
    handleCreateHighlight,
    handleCreateHighlightClick,
    selectionHandledRef,
    toolbarRef,
  } = useHighlightToolbarController({ containerRef, highlightColor, highlights, onCreate });

  useHighlightSelectionListeners(
    autoCreate,
    containerRef,
    handleCreateHighlight,
    selectionHandledRef,
    toolbarRef,
  );

  if (!ENABLE_HIGHLIGHTS) {
    return null;
  }

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 hidden max-w-xs flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg duration-200 animate-in fade-in zoom-in-95 dark:border-slate-700 dark:bg-slate-800"
    >
      <HighlightToolbarHeader onClose={closeToolbar} />
      <div className="flex w-full gap-1">
        <Button
          size="sm"
          onClick={handleCreateHighlightClick}
          className="h-7 flex-1 py-1 text-xs"
        >
          Highlight
        </Button>
      </div>
    </div>
  );
};
