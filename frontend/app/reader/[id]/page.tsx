"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getQueueItemContent, ENABLE_READER_MODE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useReadingQueue } from "@/hooks/useReadingQueue";
import { toast } from "sonner";

interface ContentState {
  isLoading: boolean;
  error: string | null;
  content: {
    id: number;
    article_url: string;
    article_title: string;
    article_source: string;
    full_text: string;
    word_count?: number;
    estimated_read_time_minutes?: number;
    read_status: string;
  } | null;
}

export default function ReaderPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const parsedId = parseInt(id, 10);

  const [state, setState] = useState<ContentState>({
    isLoading: true,
    error: null,
    content: null,
  });

  const { queuedArticles, goNext, goPrev, getArticleIndex, markAsRead } =
    useReadingQueue();

  if (!ENABLE_READER_MODE) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500">Reader mode is not enabled.</p>
      </div>
    );
  }

  // Load article content
  useEffect(() => {
    const loadContent = async () => {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));
        const content = await getQueueItemContent(parsedId);
        setState((prev) => ({ ...prev, content, isLoading: false }));
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Failed to load article";
        setState((prev) => ({
          ...prev,
          error: errorMsg,
          isLoading: false,
        }));
        toast.error(errorMsg);
      }
    };

    if (id) {
      loadContent();
    }
  }, [id, parsedId]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        handleNextArticle();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        handlePrevArticle();
      } else if (e.key === "Enter") {
        // Mark as read on Enter
        if (state.content) {
          markAsRead(state.content.article_url);
          toast.success("Article marked as read");
        }
      } else if (e.key === "Escape") {
        router.back();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.content, queuedArticles, router, markAsRead]);

  const handleNextArticle = () => {
    const currentIndex = getArticleIndex(state.content?.article_url || "");
    if (currentIndex >= 0) {
      const next = goNext(currentIndex);
      if (next) {
        // Navigate to next article
        toast.info("No more articles");
      }
    }
  };

  const handlePrevArticle = () => {
    const currentIndex = getArticleIndex(state.content?.article_url || "");
    if (currentIndex > 0) {
      const prev = goPrev(currentIndex);
      if (prev) {
        // Navigate to previous article
        toast.info("You're at the first article");
      }
    }
  };

  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-white dark:bg-slate-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-gray-500">Loading article...</p>
        </div>
      </div>
    );
  }

  if (state.error || !state.content) {
    return (
      <div className="flex items-center justify-center h-screen bg-white dark:bg-slate-950">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Failed to Load Article
          </h2>
          <p className="text-gray-500 mb-4">{state.error}</p>
          <Button
            onClick={() => router.back()}
            variant="outline"
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  const content = state.content;
  const currentIndex = getArticleIndex(content.article_url);
  const hasNext = currentIndex >= 0 && currentIndex < queuedArticles.length - 1;
  const hasPrev = currentIndex > 0;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="sticky top-0 bg-white dark:bg-slate-950 border-b border-gray-200 dark:border-slate-800 px-4 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>

        <div className="text-center flex-1">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {content.article_title}
          </h1>
          <p className="text-xs text-gray-500">{content.article_source}</p>
        </div>

        <div className="flex items-center gap-2">
          {content.estimated_read_time_minutes && (
            <span className="text-xs text-gray-500 bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded">
              {content.estimated_read_time_minutes} min read
            </span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-12 py-8 max-w-4xl mx-auto w-full">
        <article className="prose dark:prose-invert max-w-none">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            {content.article_title}
          </h1>

          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 mb-8">
            <span>{content.article_source}</span>
            {content.word_count && (
              <>
                <span>•</span>
                <span>{content.word_count} words</span>
              </>
            )}
          </div>

          <div className="text-gray-900 dark:text-gray-100 leading-relaxed whitespace-pre-wrap">
            {content.full_text}
          </div>
        </article>
      </div>

      {/* Footer Navigation */}
      <div className="sticky bottom-0 bg-white dark:bg-slate-950 border-t border-gray-200 dark:border-slate-800 px-4 py-4 flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrevArticle}
          disabled={!hasPrev}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>

        <div className="text-xs text-gray-500">
          {currentIndex >= 0 ? `${currentIndex + 1}` : "?"} /{" "}
          {queuedArticles.length}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleNextArticle}
          disabled={!hasNext}
          className="gap-2"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Keyboard Hints */}
      <div className="text-center text-xs text-gray-400 py-2 px-4">
        <span>← → arrows to navigate • Esc to close • Enter to mark as read</span>
      </div>
    </div>
  );
}
