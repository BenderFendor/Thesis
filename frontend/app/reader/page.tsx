"use client";

import { useState, useEffect, useCallback } from "react";
import { useReadingQueue } from "@/hooks/useReadingQueue";
import { NewsArticle } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { X, ChevronLeft, ChevronRight, Highlighter } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface Highlight {
  id: string;
  text: string;
  color: "yellow" | "blue" | "red";
  note?: string;
  range: {
    start: number;
    end: number;
  };
}

export default function ReaderPage() {
  const { queuedArticles, goNext, goPrev, getArticleIndex, markAsRead } =
    useReadingQueue();
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selectedText, setSelectedText] = useState<string>("");
  const [highlightColor, setHighlightColor] = useState<
    "yellow" | "blue" | "red"
  >("yellow");

  const currentArticle = queuedArticles[currentIndex];

  useEffect(() => {
    // Load highlights from localStorage for current article
    if (currentArticle) {
      const key = `highlights_${currentArticle.url}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          setHighlights(JSON.parse(stored));
        } catch (error) {
          console.error("Failed to load highlights:", error);
        }
      }
    }
  }, [currentArticle]);

  const handleNext = useCallback(() => {
    const nextArticle = goNext(currentIndex);
    if (nextArticle) {
      setCurrentIndex(currentIndex + 1);
      markAsRead(currentArticle?.url || "");
    } else {
      toast.info("You've reached the end of your reading queue!");
    }
  }, [currentIndex, goNext, markAsRead, currentArticle?.url]);

  const handlePrev = useCallback(() => {
    const prevArticle = goPrev(currentIndex);
    if (prevArticle) {
      setCurrentIndex(currentIndex - 1);
    } else {
      toast.info("You're at the beginning of your reading queue.");
    }
  }, [currentIndex, goPrev]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        handleNext();
      } else if (event.key === "ArrowLeft") {
        handlePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNext, handlePrev]);

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      setSelectedText(selection.toString());
    }
  };

  const addHighlight = () => {
    if (!selectedText || !currentArticle) return;

    const newHighlight: Highlight = {
      id: Date.now().toString(),
      text: selectedText,
      color: highlightColor,
      range: {
        start: 0,
        end: selectedText.length,
      },
    };

    const updatedHighlights = [...highlights, newHighlight];
    setHighlights(updatedHighlights);

    // Save to localStorage
    const key = `highlights_${currentArticle.url}`;
    localStorage.setItem(key, JSON.stringify(updatedHighlights));

    setSelectedText("");
    toast.success("Highlight saved!");
  };

  const deleteHighlight = (highlightId: string) => {
    if (!currentArticle) return;

    const updatedHighlights = highlights.filter((h) => h.id !== highlightId);
    setHighlights(updatedHighlights);

    const key = `highlights_${currentArticle.url}`;
    localStorage.setItem(key, JSON.stringify(updatedHighlights));
    toast.success("Highlight removed.");
  };

  if (!currentArticle) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-xl mb-4">Your reading queue is empty.</p>
          <Link href="/">
            <Button>Back to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  const colorMap = {
    yellow: "bg-yellow-200",
    blue: "bg-blue-200",
    red: "bg-red-200",
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-white dark:bg-black dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex-1">
            <h1 className="text-2xl font-serif font-bold text-black dark:text-white truncate">
              {currentArticle.title}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {currentArticle.source} • Article {currentIndex + 1} of{" "}
              {queuedArticles.length}
            </p>
          </div>
          <Link href="/search">
            <Button variant="ghost" size="icon">
              <X className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <article
          className="max-w-3xl mx-auto px-6 py-8"
          onMouseUp={handleTextSelection}
        >
          {currentArticle.image && (
            <img
              src={currentArticle.image}
              alt={currentArticle.title}
              className="w-full h-96 object-cover rounded-lg mb-8"
            />
          )}

          <div className="prose dark:prose-invert prose-lg max-w-none">
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Published on {new Date(currentArticle.publishedAt).toLocaleDateString()}
            </p>
            <div className="text-lg leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {currentArticle.content || currentArticle.summary}
            </div>
          </div>

          {/* Highlights Section */}
          {highlights.length > 0 && (
            <div className="mt-8 pt-8 border-t dark:border-gray-800">
              <h2 className="text-lg font-serif font-bold mb-4">
                Your Highlights
              </h2>
              <div className="space-y-3">
                {highlights.map((highlight) => (
                  <div
                    key={highlight.id}
                    className={`p-4 rounded ${colorMap[highlight.color]} border border-gray-300 dark:border-gray-700`}
                  >
                    <p className="text-sm italic mb-2">{highlight.text}</p>
                    {highlight.note && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Note: {highlight.note}
                      </p>
                    )}
                    <button
                      onClick={() => deleteHighlight(highlight.id)}
                      className="text-xs text-red-600 hover:text-red-800 dark:hover:text-red-400 mt-2"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </article>
      </main>

      {/* Selection Toolbar */}
      {selectedText && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-white dark:bg-gray-900 rounded-lg shadow-lg p-4 border dark:border-gray-800 z-50">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium">Highlight color:</span>
            <div className="flex gap-2">
              {(["yellow", "blue", "red"] as const).map((color) => (
                <button
                  key={color}
                  onClick={() => setHighlightColor(color)}
                  className={`w-6 h-6 rounded ${colorMap[color]} border-2 ${
                    highlightColor === color
                      ? "border-black dark:border-white"
                      : "border-transparent"
                  }`}
                />
              ))}
            </div>
          </div>
          <Button
            onClick={addHighlight}
            size="sm"
            className="w-full mb-2"
          >
            <Highlighter className="w-4 h-4 mr-2" />
            Highlight
          </Button>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Selected: {selectedText.substring(0, 50)}
            {selectedText.length > 50 ? "..." : ""}
          </p>
        </div>
      )}

      {/* Navigation Footer */}
      <footer className="border-t bg-white dark:bg-black dark:border-gray-800 sticky bottom-0">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Button
            onClick={handlePrev}
            variant="outline"
            disabled={currentIndex === 0}
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>

          <div className="text-sm text-gray-600 dark:text-gray-400">
            {currentIndex + 1} / {queuedArticles.length}
          </div>

          <Button onClick={handleNext} disabled={currentIndex === queuedArticles.length - 1}>
            Next
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
