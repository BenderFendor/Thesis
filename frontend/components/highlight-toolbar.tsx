"use client";

import { useEffect, useRef, useState } from "react";
import {
  createHighlight,
  getHighlightsForArticle,
  deleteHighlight,
  updateHighlight,
  ENABLE_HIGHLIGHTS,
  Highlight,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Highlighter, X, Edit2, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface HighlightToolbarProps {
  articleUrl: string;
  onHighlightCreated?: (highlight: Highlight) => void;
}

const COLORS = ["yellow", "blue", "red"] as const;

export function HighlightToolbar({
  articleUrl,
  onHighlightCreated,
}: HighlightToolbarProps) {
  if (!ENABLE_HIGHLIGHTS) {
    return null;
  }

  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selectedColor, setSelectedColor] = useState<"yellow" | "blue" | "red">(
    "yellow"
  );
  const [showHighlights, setShowHighlights] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState("");

  // Load highlights on mount
  useEffect(() => {
    const loadHighlights = async () => {
      try {
        const data = await getHighlightsForArticle(articleUrl);
        setHighlights(data);
      } catch (error) {
        console.error("Failed to load highlights:", error);
      }
    };

    loadHighlights();
  }, [articleUrl]);

  // Handle text selection
  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        // Show toolbar near selected text
        if (toolbarRef.current) {
          toolbarRef.current.style.top = `${rect.top + window.scrollY - 50}px`;
          toolbarRef.current.style.left = `${rect.left + window.scrollX}px`;
          toolbarRef.current.style.display = "flex";
        }
      }
    };

    const handleDeselection = () => {
      if (toolbarRef.current) {
        toolbarRef.current.style.display = "none";
      }
    };

    document.addEventListener("mouseup", handleSelection);
    document.addEventListener("mousedown", handleDeselection);

    return () => {
      document.removeEventListener("mouseup", handleSelection);
      document.removeEventListener("mousedown", handleDeselection);
    };
  }, []);

  const handleCreateHighlight = async () => {
    const selection = window.getSelection();
    if (!selection || selection.toString().length === 0) {
      toast.error("No text selected");
      return;
    }

    try {
      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(range.commonAncestorContainer);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      const characterStart = preCaretRange.toString().length - range.toString().length;
      const characterEnd = characterStart + range.toString().length;

      const highlight = await createHighlight({
        article_url: articleUrl,
        highlighted_text: selection.toString(),
        color: selectedColor,
        character_start: characterStart,
        character_end: characterEnd,
      });

      setHighlights([...highlights, highlight]);
      onHighlightCreated?.(highlight);
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
      setHighlights(highlights.filter((h) => h.id !== id));
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
        setHighlights(
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

  const getColorClass = (color: string) => {
    switch (color) {
      case "yellow":
        return "bg-yellow-200 dark:bg-yellow-900";
      case "blue":
        return "bg-blue-200 dark:bg-blue-900";
      case "red":
        return "bg-red-200 dark:bg-red-900";
      default:
        return "bg-yellow-200 dark:bg-yellow-900";
    }
  };

  return (
    <>
      {/* Floating Highlight Toolbar */}
      <div
        ref={toolbarRef}
        className="fixed hidden z-50 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 p-2 gap-1 flex-wrap max-w-xs"
      >
        <div className="flex gap-1 items-center">
          <Highlighter className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          <div className="flex gap-1">
            {COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setSelectedColor(color)}
                className={`h-6 w-6 rounded border-2 transition-all ${
                  selectedColor === color
                    ? "border-gray-900 dark:border-white"
                    : "border-transparent"
                } ${getColorClass(color)}`}
                title={color}
              />
            ))}
          </div>
        </div>
        <Button
          size="sm"
          onClick={handleCreateHighlight}
          className="text-xs h-auto py-1"
        >
          Highlight
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowHighlights(!showHighlights)}
          className="text-xs h-auto py-1"
        >
          List
        </Button>
      </div>

      {/* Highlights List Panel */}
      {showHighlights && highlights.length > 0 && (
        <div className="fixed bottom-4 right-4 z-40 w-80 max-h-96 overflow-y-auto bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-gray-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Highlights ({highlights.length})
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowHighlights(false)}
              className="h-auto p-1"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {highlights.map((highlight) => (
              <div
                key={highlight.id}
                className={`p-3 rounded-lg border ${getColorClass(
                  highlight.color
                )} border-opacity-50`}
              >
                <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                  {highlight.highlighted_text}
                </p>

                {editingId === highlight.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editingNote}
                      onChange={(e) => setEditingNote(e.target.value)}
                      placeholder="Add a note..."
                      className="w-full text-xs p-2 rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                      rows={2}
                    />
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        onClick={() => handleUpdateNote(highlight.id!)}
                        className="text-xs h-auto py-1 flex-1"
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
                        className="text-xs h-auto py-1 flex-1"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {highlight.note && (
                      <p className="text-xs text-gray-700 dark:text-gray-300 mb-2 italic">
                        {highlight.note}
                      </p>
                    )}
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(highlight.id!);
                          setEditingNote(highlight.note || "");
                        }}
                        className="text-xs h-auto py-1 flex-1 gap-1"
                      >
                        <Edit2 className="h-3 w-3" />
                        Note
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteHighlight(highlight.id!)}
                        className="text-xs h-auto py-1 gap-1"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
