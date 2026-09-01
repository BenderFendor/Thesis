"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Highlight } from "@/lib/api";
import Link from "next/link";
import type { ReactElement } from "react";
import { Search } from "lucide-react";
import { highlightStableId } from "@/lib/highlight-utils";

interface HighlightNotePopoverProps {
  readonly open: boolean;
  readonly highlight: Readonly<Highlight> | null;
  readonly anchorEl: Readonly<AnchorElement> | null;
  readonly onClose: () => void;
  readonly onSave: (highlightId: string, note: string) => Promise<void>;
  readonly articleTitle?: string;
  readonly articleSource?: string;
}

interface HighlightNoteBodyProps {
  readonly highlight: Readonly<Highlight> | null;
  readonly noteDraft: string;
  readonly onChange: (event: Readonly<TextareaChangeEvent>) => void;
  readonly onClose: () => void;
  readonly onKeyDown: (event: Readonly<TextareaKeyDownEvent>) => void;
  readonly onSave: () => void;
  readonly researchQuery: string | undefined;
  readonly saving: boolean;
  readonly focusTarget: TextareaFocusTarget;
}

interface HighlightResearchLinkProps {
  readonly onClose: () => void;
  readonly researchQuery: string | undefined;
}

interface HighlightNoteActionsProps {
  readonly onClose: () => void;
  readonly onSave: () => void;
  readonly saving: boolean;
}

interface HighlightNoteDraftController {
  readonly handleChange: (event: Readonly<TextareaChangeEvent>) => void;
  readonly handleKeyDown: (event: Readonly<TextareaKeyDownEvent>) => void;
  readonly handleSave: () => void;
  readonly noteDraft: string;
  readonly saving: boolean;
}

interface TextareaChangeEvent {
  readonly currentTarget: Readonly<{ readonly value: string }>;
}

interface TextareaKeyDownEvent {
  readonly key: string;
  readonly preventDefault: () => void;
  readonly shiftKey: boolean;
}

type DocumentMouseEvent = Readonly<{
  readonly target: Readonly<EventTarget> | null;
}>;

interface DocumentKeyboardEvent {
  readonly key: string;
}

interface AnchorElement {
  readonly contains: HTMLElement["contains"];
  readonly getBoundingClientRect: () => DOMRect;
}

interface PositionedPopover {
  readonly contains: HTMLElement["contains"];
  readonly style: Pick<CSSStyleDeclaration, "left" | "top" | "transform">;
}

type TextareaFocusTarget = (
  element: Readonly<{ readonly focus: () => void }> | null,
) => void;
type DialogElementRef = Readonly<{
  readonly current: PositionedPopover | null;
}>;

const HORIZONTAL_CENTER_DIVISOR = 2,
  HighlightNoteActions = ({
    onClose,
    onSave,
    saving,
  }: HighlightNoteActionsProps): ReactElement => (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClose}
        disabled={saving}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={onSave}
        disabled={saving}
      >
        {getSaveButtonLabel(saving)}
      </Button>
    </div>
  ),

  HighlightNoteBody = (
    props: Readonly<HighlightNoteBodyProps>,
  ): ReactElement => {
    const {
      focusTarget,
      highlight,
      noteDraft,
      onChange,
      onClose,
      onKeyDown,
      onSave,
      researchQuery,
      saving,
    } = props;
    if (highlight === null) {
      return <div />;
    }
    return (
      <div className="rounded-lg border border-border/60 bg-[var(--news-bg-secondary)]/95 p-3 shadow-2xl backdrop-blur">
        <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          Note
        </div>
        <div className="mt-2 text-xs text-foreground/80 line-clamp-3 whitespace-pre-wrap break-words">
          {highlight.highlighted_text}
        </div>
        <textarea
          ref={focusTarget}
          value={noteDraft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          className="mt-3 w-full min-h-[96px] rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          placeholder="Add a note"
        />
        <div className="mt-3 flex items-center justify-between gap-2">
          <HighlightResearchLink
            onClose={onClose}
            researchQuery={researchQuery}
          />
          <HighlightNoteActions
            onClose={onClose}
            onSave={onSave}
            saving={saving}
          />
        </div>
      </div>
    );
  },

  HighlightNotePopover = ({
    open,
    highlight,
    anchorEl,
    onClose,
    onSave,
    articleTitle,
    articleSource,
  }: HighlightNotePopoverProps): ReactElement => {
    const draft = useHighlightNoteDraft(highlight, onClose, onSave),
      popoverRef = useRef<HTMLDialogElement>(null),
      researchQuery = buildResearchQuery(
        highlight,
        articleTitle,
        articleSource,
      ),
      textareaRef = useHighlightPopoverFocus(open);
    useHighlightPopoverPosition(open, anchorEl, popoverRef);
    useHighlightPopoverDismissal(open, anchorEl, onClose, popoverRef);
    return (
      <dialog
        ref={popoverRef}
        open={open && highlight !== null && anchorEl !== null}
        className="fixed z-[110] w-[min(420px,calc(100vw-24px))]"
        aria-label="Highlight note"
      >
        <HighlightNoteBody
          highlight={highlight}
          noteDraft={draft.noteDraft}
          onChange={draft.handleChange}
          onClose={onClose}
          onKeyDown={draft.handleKeyDown}
          onSave={draft.handleSave}
          researchQuery={researchQuery}
          saving={draft.saving}
          focusTarget={textareaRef}
        />
      </dialog>
    );
  },

  HighlightResearchLink = ({
    onClose,
    researchQuery,
  }: HighlightResearchLinkProps): ReactElement => {
    if (researchQuery === undefined) {
      return <span />;
    }
    return (
      <Link
        href={`/search?query=${researchQuery}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClose}
        className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-primary/15 hover:border-primary/40 hover:text-primary"
      >
        <Search className="h-3 w-3" />
        Research this
      </Link>
    );
  },

  POPOVER_BOTTOM_OFFSET = 10,
  POPOVER_VIEWPORT_MARGIN = 12,
  ZERO = 0,

  buildResearchContext = (
    articleTitle: string | undefined,
    articleSource: string | undefined,
  ): string | undefined => {
    if (articleTitle === undefined || articleTitle.length === ZERO) {
      return void ZERO;
    }
    const context = `Context: ${articleTitle}`;
    if (articleSource !== undefined && articleSource.length > ZERO) {
      return `${context} by ${articleSource}`;
    }
    return context;
  },

  buildResearchQuery = (
    highlight: Readonly<Highlight> | null,
    articleTitle: string | undefined,
    articleSource: string | undefined,
  ): string | undefined => {
    if (highlight === null) {
      return void ZERO;
    }
    const context = buildResearchContext(articleTitle, articleSource);
    if (context === undefined) {
      return void ZERO;
    }
    return encodeURIComponent(
      [
        context,
        "",
        "Explain this highlighted passage:",
        "",
        `> ${highlight.highlighted_text}`,
      ].join("\n"),
    );
  },

  getPopoverLeft = (rect: Readonly<DOMRect>): number => {
    const desiredLeft = rect.left + rect.width / HORIZONTAL_CENTER_DIVISOR,
      maxLeft = globalThis.innerWidth - POPOVER_VIEWPORT_MARGIN;
    return Math.max(
      POPOVER_VIEWPORT_MARGIN,
      Math.min(desiredLeft, maxLeft),
    );
  },

  getPopoverTop = (rect: Readonly<DOMRect>): number => {
    const desiredTop = rect.bottom + POPOVER_BOTTOM_OFFSET,
      maxTop = globalThis.innerHeight - POPOVER_VIEWPORT_MARGIN;
    return Math.max(POPOVER_VIEWPORT_MARGIN, Math.min(desiredTop, maxTop));
  },

  getSaveButtonLabel = (saving: boolean): string => {
    if (saving) {
      return "Saving";
    }
    return "Save";
  },

  isEventInsidePopover = (
    popoverContainsTarget: boolean,
    anchorContainsTarget: boolean,
  ): boolean =>
    popoverContainsTarget || anchorContainsTarget,

  useHighlightNoteDraft = (
    highlight: Readonly<Highlight> | null,
    onClose: () => void,
    onSave: (highlightId: string, note: string) => Promise<void>,
  ): HighlightNoteDraftController => {
    const handleChange = (event: Readonly<TextareaChangeEvent>): void => {
        setStateNoteDraft(event.currentTarget.value);
      },
      handleKeyDown = (event: Readonly<TextareaKeyDownEvent>): void => {
        if (event.key !== "Enter" || event.shiftKey) {
          return;
        }
        event.preventDefault();
        void handleSave();
      },
      handleSave = async (): Promise<void> => {
        if (highlight === null) {
          return;
        }
        try {
          setStateSaving(true);
          await onSave(
            highlightStableId({ ...highlight }),
            stateNoteDraft,
          );
          onClose();
        } finally {
          setStateSaving(false);
        }
      },
      handleSaveClick = (): void => {
        void handleSave();
      },
      [stateNoteDraft, setStateNoteDraft] = useState(
        () => highlight?.note ?? "",
      ),
      [stateSaving, setStateSaving] = useState(false);
    return {
      handleChange,
      handleKeyDown,
      handleSave: handleSaveClick,
      noteDraft: stateNoteDraft,
      saving: stateSaving,
    };
  },

  useHighlightPopoverDismissal = (
    open: boolean,
    anchorEl: Readonly<AnchorElement | null>,
    onClose: () => void,
    popoverRef: DialogElementRef,
  ): void => {
    useEffect((): (() => void) | undefined => {
      if (!open) {
        return void ZERO;
      }
      const handleClickOutside = (event: Readonly<DocumentMouseEvent>): void => {
          const popover = popoverRef.current,
            { target } = event;
          if (!(target instanceof globalThis.Node)) {
            return;
          }
          if (
            isEventInsidePopover(
              Boolean(popover?.contains(target)),
              Boolean(anchorEl?.contains(target)),
            )
          ) {
            return;
          }
          onClose();
        },
        handleEscape = (event: Readonly<DocumentKeyboardEvent>): void => {
          if (event.key === "Escape") {
            onClose();
          }
        };
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return (): void => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }, [anchorEl, onClose, open, popoverRef]);
  },

  useHighlightPopoverFocus = (open: boolean): TextareaFocusTarget =>
    (element: Readonly<{ readonly focus: () => void }> | null): void => {
      if (!open || element === null) {
        return;
      }
      element.focus();
    },

  useHighlightPopoverPosition = (
    open: boolean,
    anchorEl: Readonly<AnchorElement | null>,
    popoverRef: DialogElementRef,
  ): void => {
    useEffect((): (() => void) | undefined => {
      if (!open || anchorEl === null) {
        return void ZERO;
      }
      const updatePosition = (): void => {
        const popover = popoverRef.current,
          rect = anchorEl.getBoundingClientRect();
        if (popover === null) {
          return;
        }
        popover.style.left = `${getPopoverLeft(rect)}px`;
        popover.style.top = `${getPopoverTop(rect)}px`;
        popover.style.transform = "translateX(-50%)";
      };
      updatePosition();
      globalThis.addEventListener("resize", updatePosition);
      globalThis.addEventListener("scroll", updatePosition, true);
      return (): void => {
        globalThis.removeEventListener("resize", updatePosition);
        globalThis.removeEventListener("scroll", updatePosition, true);
      };
    }, [anchorEl, open, popoverRef]);
  };

export { HighlightNotePopover };
