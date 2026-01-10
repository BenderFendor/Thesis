"use client";

import { useEffect, useRef, useState } from "react";
import {
  createHighlight,
  deleteHighlight,
  updateHighlight,
  ENABLE_HIGHLIGHTS,
  Highlight,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Highlighter, X, Edit2, Trash2, Share2, Copy } from "lucide-react";
import { toast } from "sonner";
import { getGlobalOffset, getHighlightColorClass } from "@/lib/highlight-utils";

interface HighlightToolbarProps {
  articleUrl: string;
  containerRef: React.RefObject<HTMLElement>;
  highlights: Highlight[];
  onHighlightsChange: (highlights: Highlight[]) => void;
}

const COLORS = ["yellow", "blue", "red", "green", "purple"] as const;

export function HighlightToolbar({
  articleUrl,
  containerRef,
  highlights,
  onHighlightsChange,
}: HighlightToolbarProps) {
  if (!ENABLE_HIGHLIGHTS) {
    return null;
  }

  const [selectedColor, setSelectedColor] = useState<typeof COLORS[number]>("yellow");
  const [showHighlights, setShowHighlights] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState("");

  // Handle text selection
  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection();
      
      // Basic check if selection exists
      if (!selection || selection.toString().length === 0) {
        if (toolbarRef.current) {
            toolbarRef.current.style.display = "none";
        }
        return;
      }

      // Check if selection is inside containerRef
      if (containerRef.current && !containerRef.current.contains(selection.anchorNode)) {
          // If the selection started outside our article content, hide toolbar
          if (toolbarRef.current) {
            toolbarRef.current.style.display = "none";
          }
          return;
      }

      const range = selection.getRangeAt(0);
      let rect: DOMRect | null = null;
      try {
        rect = (range as any).getBoundingClientRect?.() ?? null;
      } catch (err) {
        rect = null;
      }

      // Show toolbar near selected text
      if (toolbarRef.current) {
        const top = rect ? rect.top + window.scrollY - 50 : window.innerHeight / 2;
        const left = rect ? rect.left + window.scrollX : window.innerWidth / 2 - 100;
        toolbarRef.current.style.top = `${top}px`;
        toolbarRef.current.style.left = `${left}px`;
        toolbarRef.current.style.display = "flex";
      }
    };

    const handleDeselection = (e: MouseEvent) => {
       // Only hide if we click outside the toolbar
       if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
          // Check if we are selecting text, if so, handleSelection will trigger mouseup
          // This mousedown just ensures we clear if we click away.
          // Actually, let's rely on selection change or mouseup mostly.
       }
    };
    
    // We can just rely on mouseup to re-evaluate selection
    document.addEventListener("mouseup", handleSelection);
    // If we click inside toolbar, we don't want to hide it, but if we click elsewhere and lose selection, it should hide.
    // The selection clearing usually happens on mousedown.
    
    const handleSelectionChange = () => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
             if (toolbarRef.current) {
                toolbarRef.current.style.display = "none";
             }
        }
    }
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("mouseup", handleSelection);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [containerRef]);

  const handleCreateHighlight = async () => {
    const selection = window.getSelection();
    if (!selection || selection.toString().length === 0 || !containerRef.current) {
      toast.error("No text selected");
      return;
    }

    try {
      const range = selection.getRangeAt(0);
      const text = selection.toString();

      // Calculate global offsets
      // We need to find the start and end nodes relative to containerRef.current
      const startOffset = getGlobalOffset(containerRef.current, range.startContainer, range.startOffset);
      const endOffset = getGlobalOffset(containerRef.current, range.endContainer, range.endOffset);

      if (startOffset === -1 || endOffset === -1) {
          toast.error("Selection outside of article content");
          return;
      }
      
      // Ensure start < end
      const finalStart = Math.min(startOffset, endOffset);
      const finalEnd = Math.max(startOffset, endOffset);

      if (finalStart === finalEnd) {
          toast.error("Empty selection");
          return;
      }

      const highlight = await createHighlight({
        article_url: articleUrl,
        highlighted_text: text,
        color: selectedColor,
        character_start: finalStart,
        character_end: finalEnd,
      });

      onHighlightsChange([...highlights, highlight]);
      toast.success("Highlight created");

      // Clear selection and hide toolbar
      selection.removeAllRanges();
      if (toolbarRef.current) {
        toolbarRef.current.style.display = "none";
      }
    } catch (error) {
      toast.error("Failed to create highlight");
      console.error(error);
    }
  };

  const handleDeleteHighlight = async (id: number) => {
    try {
      await deleteHighlight(id);
      onHighlightsChange(highlights.filter((h) => h.id !== id));
      toast.success("Highlight deleted");
    } catch (error) {
      toast.error("Failed to delete highlight");
      console.error(error);
    }
  };

  const handleUpdateNote = async (id: number) => {
    try {
      const highlight = highlights.find((h) => h.id === id);
      if (highlight) {
        await updateHighlight(id, { note: editingNote });
        onHighlightsChange(
          highlights.map((h) =>
            h.id === id ? { ...h, note: editingNote } : h
          )
        );
        setEditingId(null);
        setEditingNote("");
        toast.success("Note updated");
      }
    } catch (error) {
      toast.error("Failed to update note");
      console.error(error);
    }
  };

  const handleShareHighlights = () => {
    const text = highlights
        .map(h => `"${h.highlighted_text}"
${h.note ? `Note: ${h.note}
` : ''}`)
        .join("\n---\n");
    
    navigator.clipboard.writeText(text);
    toast.success("Highlights copied to clipboard");
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
        <div className="flex gap-1 mb-2 w-full justify-center">
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setSelectedColor(color)}
                className={`h-6 w-6 rounded-full border-2 transition-all ${selectedColor === color
                    ? "border-gray-900 dark:border-white scale-110"
                    : "border-transparent hover:scale-105"
                } ${getHighlightColorClass(color).split(" ")[0]}`} // Use just bg color for circle
                title={color}
              />
            ))}
        </div>
        <div className="flex gap-1 w-full">
            <Button
            size="sm"
            onClick={handleCreateHighlight}
            className="text-xs h-7 py-1 flex-1"
            >
            Save
            </Button>
            <Button
            size="sm"
            variant="outline"
            onClick={() => {
                setShowHighlights(!showHighlights);
                if (toolbarRef.current) toolbarRef.current.style.display = "none";
            }}
            className="text-xs h-7 py-1"
            >
            List
            </Button>
        </div>
      </div>

      {/* Highlights List Panel */}
      {showHighlights && (
        <div className="fixed bottom-4 right-4 z-50 w-80 max-h-[500px] flex flex-col bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700 animate-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center justify-between p-3 border-b border-gray-100 dark:border-slate-700">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Highlighter className="h-4 w-4" />
              Highlights ({highlights.length})
            </h3>
            <div className="flex gap-1">
                {highlights.length > 0 && (
                     <Button
                     size="sm"
                     variant="ghost"
                     onClick={handleShareHighlights}
                     className="h-8 w-8 p-0"
                     title="Copy all highlights"
                   >
                     <Share2 className="h-4 w-4" />
                   </Button>
                )}
                <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowHighlights(false)}
                className="h-8 w-8 p-0"
                >
                <X className="h-4 w-4" />
                </Button>
            </div>
          </div>

          <div className="overflow-y-auto p-4 space-y-3 flex-1">
            {highlights.length === 0 ? (
                <div className="text-center text-gray-500 py-8 text-sm">
                    No highlights yet. Select text to highlight.
                </div>
            ) : (
                highlights.map((highlight) => (
                <div
                    key={highlight.id}
                    className={`p-3 rounded-lg border transition-colors ${getHighlightColorClass(
                    highlight.color
                    )} border-opacity-50`}
                >
                    <p className="text-sm font-medium mb-2 leading-relaxed">
                    "{highlight.highlighted_text}"
                    </p>

                    {editingId === highlight.id ? (
                    <div className="space-y-2 mt-2">
                        <textarea
                        value={editingNote}
                        onChange={(e) => setEditingNote(e.target.value)}
                        placeholder="Add a note..."
                        className="w-full text-xs p-2 rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-1 focus:ring-primary"
                        rows={2}
                        autoFocus
                        />
                        <div className="flex gap-2">
                        <Button
                            size="sm"
                            onClick={() => handleUpdateNote(highlight.id!)}
                            className="text-xs h-7 py-0 flex-1"
                        >
                            Save
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                            setEditingId(null);
                            setEditingNote("");
                            }}
                            className="text-xs h-7 py-0 flex-1"
                        >
                            Cancel
                        </Button>
                        </div>
                    </div>
                    ) : (
                    <>
                        {highlight.note && (
                        <div className="text-xs bg-black/5 dark:bg-black/20 p-2 rounded mb-2 italic">
                            {highlight.note}
                        </div>
                        )}
                        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                         {/* Hover handling in mobile might be tricky, so we might want them always visible or toggleable. 
                             For now, let's make them always visible but subtle.
                          */}
                        </div>
                        <div className="flex gap-2 mt-2 pt-2 border-t border-black/5 dark:border-white/10">
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                            setEditingId(highlight.id!);
                            setEditingNote(highlight.note || "");
                            }}
                            className="text-xs h-6 px-2 hover:bg-black/5 dark:hover:bg-white/10"
                        >
                            <Edit2 className="h-3 w-3 mr-1" />
                            {highlight.note ? "Edit Note" : "Add Note"}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                navigator.clipboard.writeText(`"${highlight.highlighted_text}"`);
                                toast.success("Copied to clipboard");
                            }}
                            className="text-xs h-6 px-2 hover:bg-black/5 dark:hover:bg-white/10"
                        >
                             <Copy className="h-3 w-3 mr-1" />
                             Copy
                        </Button>
                        <div className="flex-1" />
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteHighlight(highlight.id!)}
                            className="text-xs h-6 px-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600"
                        >
                            <Trash2 className="h-3 w-3" />
                        </Button>
                        </div>
                    </>
                    )}
                </div>
                ))
            )}
          </div>
        </div>
      )}
    </>
  );
}