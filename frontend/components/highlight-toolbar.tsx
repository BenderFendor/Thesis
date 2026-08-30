"use client";

import { useCallback, useEffect, useRef } from "react";
import { ENABLE_HIGHLIGHTS } from '@/lib/api';
import type { Highlight } from '@/lib/api';
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
  onCreate: (payload:Readonly< {
    highlightedText: string
    color: Highlight["color"]
    range: { start: number; end: number }
  }>) => Promise<void> | void
  onUpdate: (payload:Readonly< { highlightId: number; note: string }>) => Promise<void> | void
  onDelete: (payload:Readonly< { highlightId: number }>) => Promise<void> | void
}

const HIGHLIGHT_DEBUG = true

export function HighlightToolbar({
  containerRef,
  highlightColor,
  autoCreate,
  highlights,
  onCreate,
}: HighlightToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(undefined),
   selectionHandledRef = useRef(false),

   handleCreateHighlight = useCallback(async () => {
    const selection = globalThis.getSelection()
    if (!selection || selection.toString().length === 0 || !containerRef.current) {
      toast.error("No text selected")
      return
    }

    try {
      const range = selection.getRangeAt(0),
       highlightedText = selection.toString(),

       startOffset = getGlobalOffset(containerRef.current, range.startContainer, range.startOffset),
       endOffset = getGlobalOffset(containerRef.current, range.endContainer, range.endOffset)

      if (HIGHLIGHT_DEBUG) {
        console.debug("[HighlightToolbar] computed offsets", {
          endOffset,
          selectedText: highlightedText.slice(0, 80),
          startOffset,
        })
      }

      if (startOffset === -1 || endOffset === -1) {
        toast.error("Selection outside of article content");
        return;
      }

      const finalStart = Math.min(startOffset, endOffset),
       finalEnd = Math.max(startOffset, endOffset);

      if (finalStart === finalEnd) {
        toast.error("Empty selection");
        return;
      }

      const fingerprint = createHighlightFingerprint({
        character_end: finalEnd,
        character_start: finalStart,
        highlighted_text: highlightedText,
      }),
       hasExactDuplicate = highlights.some((highlight) => {
        if ((highlight as Highlight & { deleted?: boolean }).deleted) {
          return false
        }

        return (
          createHighlightFingerprint({
            character_end: highlight.character_end,
            character_start: highlight.character_start,
            highlighted_text: highlight.highlighted_text,
          }) === fingerprint
        )
      })

      if (hasExactDuplicate) {
        toast.error("That exact text is already highlighted")
        return
      }

      await onCreate({
        color: highlightColor,
        highlightedText,
        range: { end: finalEnd, start: finalStart },
      });

      toast.success("Highlight created");

      globalThis.getSelection()?.removeAllRanges()

      selectionHandledRef.current = true
      globalThis.setTimeout(() => {
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
        containerNode: containerRef.current?.nodeName,
        hasContainer: Boolean(containerRef.current),
      })
    }

    const hideToolbar = () => {
      if (toolbarRef.current) {
        toolbarRef.current.style.display = "none"
      }
    },

     selectionInsideContainer = (selection: Selection, range: Range) => {
      const container = containerRef.current
      if (!container) {return false}

      const anchor = selection.anchorNode,
       focus = selection.focusNode,
       commonAncestor = range.commonAncestorContainer,

       anchorOk = anchor ? container.contains(anchor) : false,
       focusOk = focus ? container.contains(focus) : false,
       commonOk = container.contains(commonAncestor)

      return anchorOk || focusOk || commonOk
    },

     handleSelection = () => {
      if (HIGHLIGHT_DEBUG) {console.debug("[HighlightToolbar] handleSelection fired")}
      const selection = globalThis.getSelection()

      if (!selection || selection.rangeCount === 0) {
        if (HIGHLIGHT_DEBUG) {console.debug("[HighlightToolbar] no selection")}
        hideToolbar()
        return
      }

       const selectionText = selection.toString()
       if (selection.isCollapsed || selectionText.trim().length === 0) {
         if (HIGHLIGHT_DEBUG) {console.debug("[HighlightToolbar] collapsed/empty selection")}
         hideToolbar()
         return
       }

      const range = selection.getRangeAt(0),
       inside = selectionInsideContainer(selection, range)
      if (!inside) {
        if (HIGHLIGHT_DEBUG) {
          console.debug("[HighlightToolbar] selection outside container", {
            anchorNode: selection.anchorNode?.nodeName,
            commonAncestor: range.commonAncestorContainer?.nodeName,
            containerNode: containerRef.current?.nodeName,
            focusNode: selection.focusNode?.nodeName,
            selectionText: selectionText.slice(0, 80),
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
          endContainer: range.endContainer?.nodeName,
          selectionText: selectionText.slice(0, 80),
          startContainer: range.startContainer?.nodeName,
        })
      }

      let rect
      try {
        rect = range.getBoundingClientRect?.() ?? undefined
      } catch {
        rect = undefined
      }

      if (toolbarRef.current) {
        const container = containerRef.current,
         containerRect = container?.getBoundingClientRect?.()

        if (HIGHLIGHT_DEBUG) {
          console.debug("[HighlightToolbar] positioning", {
            containerClientHeight: container?.clientHeight,
            containerConnected: container?.isConnected,
            containerLeft: containerRect?.left,
            containerTop: containerRect?.top,
            rectLeft: rect?.left,
            rectTop: rect?.top,
          })
        }

        // Use viewport-based positioning for a fixed element.
        // Avoid mixing in globalThis.scrollY because the modal often scrolls independently.
        const top = rect ? rect.top - 50 : globalThis.innerHeight / 2,
         left = rect ? rect.left : globalThis.innerWidth / 2 - 100

        toolbarRef.current.style.top = `${Math.max(8, top)}px`
        toolbarRef.current.style.left = `${Math.max(8, left)}px`
        toolbarRef.current.style.display = "flex"
      }
    },

     handleSelectionChange = () => {
      if (HIGHLIGHT_DEBUG) {console.debug("[HighlightToolbar] selectionchange event")}
      const selection = globalThis.getSelection()
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
    return 
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
                    if (toolbarRef.current) {toolbarRef.current.style.display = 'none';}
                    globalThis.getSelection()?.removeAllRanges();
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
