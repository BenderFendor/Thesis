"use client";

import { useCallback, useEffect, useRef } from "react";
import { ENABLE_HIGHLIGHTS, type Highlight } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Highlighter, X } from "lucide-react";
import { toast } from "sonner";
import { getGlobalOffset } from "@/lib/highlight-utils";
import { createHighlightFingerprint } from "@/lib/highlight-store";

interface HighlightToolbarProps {
  articleUrl: string;
  containerRef: React.RefObject<HTMLElement | null>;
  highlightColor: Highlight["color"]
  autoCreate: boolean
  highlights: Highlight[];
  onCreate: (payload: {
    highlightedText: string
    color: Highlight["color"]
    range: { start: number; end: number }
  }) => Promise<void> | void
  onUpdate: (payload: { highlightId: number; note: string }) => Promise<void> | void
  onDelete: (payload: { highlightId: number }) => Promise<void> | void
}

const HIGHLIGHT_DEBUG = true

export function HighlightToolbar({
  containerRef,
  highlightColor,
  autoCreate,
  highlights,
  onCreate,
}: HighlightToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const selectionHandledRef = useRef(false)

  const handleCreateHighlight = useCallback(async () => {
    const selection = window.getSelection()
    if (!selection || selection.toString().length === 0 || !containerRef.current) {
      toast.error("No text selected")
      return
    }

    try {
      const range = selection.getRangeAt(0);
      const highlightedText = selection.toString();

      const startOffset = getGlobalOffset(containerRef.current, range.startContainer, range.startOffset)
      const endOffset = getGlobalOffset(containerRef.current, range.endContainer, range.endOffset)

      if (HIGHLIGHT_DEBUG) {
        console.debug("[HighlightToolbar] computed offsets", {
          startOffset,
          endOffset,
          selectedText: highlightedText.slice(0, 80),
        })
      }

      if (startOffset === -1 || endOffset === -1) {
        toast.error("Selection outside of article content");
        return;
      }

      const finalStart = Math.min(startOffset, endOffset);
      const finalEnd = Math.max(startOffset, endOffset);

      if (finalStart === finalEnd) {
        toast.error("Empty selection");
        return;
      }

      const fingerprint = createHighlightFingerprint({
        character_start: finalStart,
        character_end: finalEnd,
        highlighted_text: highlightedText,
      })
      const hasExactDuplicate = highlights.some((highlight) => {
        if ((highlight as Highlight & { deleted?: boolean }).deleted) {
          return false
        }

        return (
          createHighlightFingerprint({
            character_start: highlight.character_start,
            character_end: highlight.character_end,
            highlighted_text: highlight.highlighted_text,
          }) === fingerprint
        )
      })

      if (hasExactDuplicate) {
        toast.error("That exact text is already highlighted")
        return
      }

      await onCreate({
        highlightedText,
        color: highlightColor,
        range: { start: finalStart, end: finalEnd },
      });

      toast.success("Highlight created");

      selectionHandledRef.current = true
      window.setTimeout(() => {
        selectionHandledRef.current = false
      }, 120)

      if (toolbarRef.current) {
        toolbarRef.current.style.display = "none";
      }
    } catch (error) {
      toast.error("Failed to create highlight");
      console.error(error);
    }
  }, [containerRef, highlightColor, highlights, onCreate]);

  // Handle text selection
  useEffect(() => {
    if (!ENABLE_HIGHLIGHTS) {
      return
    }

    if (HIGHLIGHT_DEBUG) {
      console.debug("[HighlightToolbar] mounted", {
        hasContainer: Boolean(containerRef.current),
        containerNode: containerRef.current?.nodeName,
      })
    }

    const hideToolbar = () => {
      if (toolbarRef.current) {
        toolbarRef.current.style.display = "none"
      }
    }

    const selectionInsideContainer = (selection: Selection, range: Range) => {
      const container = containerRef.current
      if (!container) return false

      const anchor = selection.anchorNode
      const focus = selection.focusNode
      const commonAncestor = range.commonAncestorContainer

      const anchorOk = anchor ? container.contains(anchor) : false
      const focusOk = focus ? container.contains(focus) : false
      const commonOk = container.contains(commonAncestor)

      return anchorOk || focusOk || commonOk
    }

    const handleSelection = () => {
      if (HIGHLIGHT_DEBUG) console.debug("[HighlightToolbar] handleSelection fired")
      const selection = window.getSelection()

      if (!selection || selection.rangeCount === 0) {
        if (HIGHLIGHT_DEBUG) console.debug("[HighlightToolbar] no selection")
        hideToolbar()
        return
      }

       const selectionText = selection.toString()
       if (selection.isCollapsed || selectionText.trim().length === 0) {
         if (HIGHLIGHT_DEBUG) console.debug("[HighlightToolbar] collapsed/empty selection")
         hideToolbar()
         return
       }

      const range = selection.getRangeAt(0)
      const inside = selectionInsideContainer(selection, range)
      if (!inside) {
        if (HIGHLIGHT_DEBUG) {
          console.debug("[HighlightToolbar] selection outside container", {
            selectionText: selectionText.slice(0, 80),
            anchorNode: selection.anchorNode?.nodeName,
            focusNode: selection.focusNode?.nodeName,
            commonAncestor: range.commonAncestorContainer?.nodeName,
            containerNode: containerRef.current?.nodeName,
          })
        }
        hideToolbar()
        return
      }

      if (autoCreate && !selectionHandledRef.current) {
        void handleCreateHighlight()
        hideToolbar()
        return
      }

      if (HIGHLIGHT_DEBUG) {
        console.debug("[HighlightToolbar] selection inside container", {
          selectionText: selectionText.slice(0, 80),
          startContainer: range.startContainer?.nodeName,
          endContainer: range.endContainer?.nodeName,
        })
      }

      let rect: DOMRect | null = null
      try {
        rect = range.getBoundingClientRect?.() ?? null
      } catch {
        rect = null
      }

      if (toolbarRef.current) {
        const container = containerRef.current
        const containerRect = container?.getBoundingClientRect?.()

        if (HIGHLIGHT_DEBUG) {
          console.debug("[HighlightToolbar] positioning", {
            rectTop: rect?.top,
            rectLeft: rect?.left,
            containerTop: containerRect?.top,
            containerLeft: containerRect?.left,
            containerConnected: container?.isConnected,
            containerClientHeight: container?.clientHeight,
          })
        }

        // Use viewport-based positioning for a fixed element.
        // Avoid mixing in window.scrollY because the modal often scrolls independently.
        const top = rect ? rect.top - 50 : window.innerHeight / 2
        const left = rect ? rect.left : window.innerWidth / 2 - 100

        toolbarRef.current.style.top = `${Math.max(8, top)}px`
        toolbarRef.current.style.left = `${Math.max(8, left)}px`
        toolbarRef.current.style.display = "flex"
      }
    }

    const handleSelectionChange = () => {
      if (HIGHLIGHT_DEBUG) console.debug("[HighlightToolbar] selectionchange event")
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        hideToolbar()
      }
    }

    document.addEventListener("pointerup", handleSelection, { capture: true })
    document.addEventListener("mouseup", handleSelection, { capture: true })
    document.addEventListener("keyup", handleSelection, { capture: true })
    document.addEventListener("selectionchange", handleSelectionChange, { capture: true })

    return () => {
      document.removeEventListener("pointerup", handleSelection, { capture: true })
      document.removeEventListener("mouseup", handleSelection, { capture: true })
      document.removeEventListener("keyup", handleSelection, { capture: true })
      document.removeEventListener("selectionchange", handleSelectionChange, { capture: true })
    }
  }, [autoCreate, containerRef, handleCreateHighlight])

  if (!ENABLE_HIGHLIGHTS) {
    return null
  }

  return (
    <>
      {/* Floating Highlight Toolbar */}
      <div
        ref={toolbarRef}
        className="fixed hidden z-50 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 p-2 gap-1 flex-wrap max-w-xs animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex gap-1 items-center mb-1 w-full justify-between">
            <div className="flex gap-1 items-center">
                <Highlighter className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                <span className="text-xs font-semibold text-gray-500">Highlight</span>
            </div>
             <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                    if (toolbarRef.current) toolbarRef.current.style.display = 'none';
                    window.getSelection()?.removeAllRanges();
                }}
                className="h-5 w-5 p-0"
              >
                <X className="h-3 w-3" />
              </Button>
        </div>
        <div className="flex gap-1 w-full">
          <Button size="sm" onClick={handleCreateHighlight} className="text-xs h-7 py-1 flex-1">
            Highlight
          </Button>
        </div>
      </div>

    </>
  );
}
