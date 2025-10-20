"use client";

import { useEffect, useState } from "react";
import { Highlight, getAllHighlights, deleteHighlight } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Highlighter, X } from "lucide-react";
import { toast } from "sonner";

export function HighlightsView() {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterColor, setFilterColor] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const fetchHighlights = async () => {
      try {
        setLoading(true);
        const data = await getAllHighlights();
        setHighlights(data);
      } catch (error) {
        console.error("Failed to load highlights:", error);
        toast.error("Failed to load highlights");
      } finally {
        setLoading(false);
      }
    };

    fetchHighlights();
  }, []);

  const handleDelete = async (highlightId: number | undefined) => {
    if (!highlightId) return;

    try {
      await deleteHighlight(highlightId);
      setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
      toast.success("Highlight deleted");
    } catch (error) {
      console.error("Failed to delete highlight:", error);
      toast.error("Failed to delete highlight");
    }
  };

  const colorMap = {
    yellow: "bg-yellow-200 border-yellow-300",
    blue: "bg-blue-200 border-blue-300",
    red: "bg-red-200 border-red-300",
  };

  const filtered = highlights
    .filter((h) => !filterColor || h.color === filterColor)
    .filter(
      (h) =>
        h.highlighted_text.toLowerCase().includes(searchTerm.toLowerCase()) ||
        h.article_url.toLowerCase().includes(searchTerm.toLowerCase())
    );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin">
          <Highlighter className="w-8 h-8 text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Button
          variant={filterColor === null ? "default" : "outline"}
          size="sm"
          onClick={() => setFilterColor(null)}
        >
          All
        </Button>
        {(["yellow", "blue", "red"] as const).map((color) => (
          <Button
            key={color}
            variant={filterColor === color ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterColor(color)}
            className={
              filterColor === color ? colorMap[color as keyof typeof colorMap] : ""
            }
          >
            {color.charAt(0).toUpperCase() + color.slice(1)}
          </Button>
        ))}
      </div>

      <div className="relative">
        <input
          type="text"
          placeholder="Search highlights..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-600 dark:text-gray-400">
          <Highlighter className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No highlights yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((highlight) => (
            <Card
              key={highlight.id}
              className={`p-4 border-2 ${colorMap[highlight.color as keyof typeof colorMap]}`}
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm italic mb-2 text-gray-800">
                    "{highlight.highlighted_text}"
                  </p>
                  {highlight.note && (
                    <p className="text-xs text-gray-600 mb-2">
                      <strong>Note:</strong> {highlight.note}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    From:{" "}
                    <a
                      href={highlight.article_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline truncate"
                    >
                      {highlight.article_url.replace(/^https?:\/\//, "")}
                    </a>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(highlight.id)}
                  className="flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
