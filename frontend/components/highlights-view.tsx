"use client";
import { hasText } from "@/lib/utils";

import { Highlighter, X } from "lucide-react";
import { deleteHighlight, getAllHighlights } from "@/lib/api";
import type { ChangeEventHandler } from "react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Highlight } from "@/lib/api";
import { toast } from "sonner";

const colorMap = {
  blue: "bg-blue-200 border-blue-300",
  green: "bg-green-200 border-green-300",
  purple: "bg-purple-200 border-purple-300",
  red: "bg-red-200 border-red-300",
  yellow: "bg-yellow-200 border-yellow-300",
} as const satisfies Record<Highlight["color"], string>;

interface HighlightCardProps {
  readonly highlight: Highlight;
  readonly onDelete: (highlightId: number | undefined) => void;
}

const HighlightCard = ({ highlight, onDelete }: Readonly<HighlightCardProps>) => {
  const handleDelete = useCallback(() => {
    onDelete(highlight.id);
  }, [highlight.id, onDelete]);

  return (
    <Card
      key={highlight.id}
      className={`border-2 p-4 ${colorMap[highlight.color]}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-sm italic text-gray-800">
            &quot;{highlight.highlighted_text}&quot;
          </p>
          {hasText(highlight.note) && (
            <p className="mb-2 text-xs text-gray-600">
              <strong>Note:</strong> {highlight.note}
            </p>
          )}
          <p className="text-xs text-gray-500">
            From: {" "}
            <a
              href={highlight.article_url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-blue-600 hover:underline dark:text-blue-400"
            >
              {highlight.article_url.replace(/^https?:\/\//u, "")}
            </a>
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          className="flex-shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
};

export const HighlightsView = () => {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterColor, setFilterColor] = useState<Highlight["color"] | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const handleAllFilter = useCallback(() => {
      setFilterColor(null);
    }, []);
  const handleBlueFilter = useCallback(() => {
      setFilterColor("blue");
    }, []);
  const handleRedFilter = useCallback(() => {
      setFilterColor("red");
    }, []);
  const handleYellowFilter = useCallback(() => {
      setFilterColor("yellow");
    }, []);
  const handleSearchChange = useCallback<ChangeEventHandler<HTMLInputElement>>((event) => {
      setSearchTerm(event.target.value);
    }, []);

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

    void fetchHighlights();
  }, []);

  const filtered = highlights
      .filter((h) => !filterColor || h.color === filterColor)
      .filter(
        (h) =>
          h.highlighted_text.toLowerCase().includes(searchTerm.toLowerCase()) ||
          h.article_url.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    handleDelete = useCallback(async (highlightId: number | undefined) => {
      if (highlightId === undefined || highlightId === 0) {
        return;
      }

      try {
        await deleteHighlight(highlightId);
        setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
        toast.success("Highlight deleted");
      } catch (error) {
        console.error("Failed to delete highlight:", error);
        toast.error("Failed to delete highlight");
      }
    }, []);
  const handleDeleteFromCard = useCallback(
      (highlightId: number | undefined) => {
        void handleDelete(highlightId);
      },
      [handleDelete],
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
          variant={(() => {
  if (filterColor === null) {
    return "default";
  }
  return "outline";
})()}
          size="sm"
          onClick={handleAllFilter}
        >
          All
        </Button>
        {(["yellow", "blue", "red"] as const).map((color) => (
          <Button
            key={color}
            variant={(() => {
  if (filterColor === color) {
    return "default";
  }
  return "outline";
})()}
            size="sm"
            onClick={
              (() => {
  if (color === "yellow") {
    return handleYellowFilter;
  }
  return (() => {
    if (color === "blue") {
      return handleBlueFilter;
    }
    return handleRedFilter;
  })();
})()
            }
            className={(() => {
  if (filterColor === color) {
    return colorMap[color];
  }
  return "";
})()}
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
          onChange={handleSearchChange}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
        />
      </div>

      {(() => {
  if (filtered.length === 0) {
    return <div className="text-center py-8 text-gray-600 dark:text-gray-400">
          <Highlighter className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No highlights yet</p>
        </div>;
  }
  return <div className="space-y-3">
          {filtered.map(highlight => <HighlightCard key={highlight.id} highlight={highlight} onDelete={handleDeleteFromCard} />)}
        </div>;
})()}
    </div>
  );
};
