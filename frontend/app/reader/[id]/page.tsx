"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  createHighlight,
  deleteHighlight,
  getHighlightsForArticle,
  getQueueItemContent,
  updateHighlight,
  type Highlight,
  ENABLE_READER_MODE,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Copy,
  Download,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import { useReadingQueue } from "@/hooks/useReadingQueue";
import { logUserAction } from "@/lib/performance-logger";
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

const COLORS: Highlight["color"][] = ["yellow", "blue", "red"];

const colorClassMap: Record<Highlight["color"], string> = {
  yellow: "bg-amber-200/80 text-amber-900",
  blue: "bg-sky-200/80 text-sky-900",
  red: "bg-rose-200/80 text-rose-900",
};

const sanitizeFilename = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80) || "annotations";

const buildHighlightMarkdown = (
  content: ContentState["content"],
  highlights: Highlight[]
) => {
  if (!content) return "";
  const created = new Date().toISOString().split("T")[0];
  const title = content.article_title.replace(/"/g, "'");
  const lines: string[] = [
    "---",
    `title: "${title}"`,
    `source: "${content.article_url}"`,
    `created: "${created}"`,
    `description: "Annotations from Scoop Reader"`,
    `tags: [clippings, annotations, scoop]`,
    "---",
    "",
    `# ${content.article_title}`,
    "",
    `Source: ${content.article_url}`,
    `Publisher: ${content.article_source}`,
    `Collected: ${created}`,
    "",
    "## Annotations",
  ];

  if (highlights.length === 0) {
    lines.push("No annotations yet.");
    return lines.join("\n");
  }

  highlights.forEach((highlight) => {
    const text = highlight.highlighted_text.replace(/\s+/g, " ").trim();
    if (!text) return;
    lines.push(`- ==${text}==`);
    if (highlight.note) {
      lines.push(`  - *${highlight.note.trim()}*`);
    }
  });

  return lines.join("\n");
};

export default function ReaderPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const parsedId = Number(id);

  const [state, setState] = useState<ContentState>({
    isLoading: true,
    error: null,
    content: null,
  });

  const { queuedArticles, goNext, goPrev, getArticleIndex, markAsRead } =
    useReadingQueue();

  const articleBodyRef = useRef<HTMLDivElement | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);

  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightColor, setHighlightColor] =
    useState<Highlight["color"]>("yellow");
  const [selectedText, setSelectedText] = useState("");
  const [toolbarPosition, setToolbarPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [showHighlights, setShowHighlights] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState("");

  if (!ENABLE_READER_MODE) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Reader mode is not enabled.</p>
      </div>
    );
  }

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

  useEffect(() => {
    const loadHighlights = async () => {
      if (!state.content?.article_url) return;
      try {
        const data = await getHighlightsForArticle(state.content.article_url);
        setHighlights(data);
      } catch (error) {
        console.error("Failed to load highlights:", error);
      }
    };

    loadHighlights();
  }, [state.content?.article_url]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.toString().trim().length === 0) {
        setSelectedText("");
        setToolbarPosition(null);
        selectionRangeRef.current = null;
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        handleNextArticle();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        handlePrevArticle();
      } else if (e.key === "Enter") {
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
  }, [state.content, queuedArticles, router, markAsRead]);

  const handleNextArticle = () => {
    const currentIndex = getArticleIndex(state.content?.article_url || "");
    if (currentIndex >= 0) {
      const next = goNext(currentIndex);
      if (!next) {
        toast.info("No more articles");
      }
    }
  };

  const handlePrevArticle = () => {
    const currentIndex = getArticleIndex(state.content?.article_url || "");
    if (currentIndex > 0) {
      const prev = goPrev(currentIndex);
      if (!prev) {
        toast.info("You're at the first article");
      }
    }
  };

  const handleSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.toString().trim().length === 0) {
      return;
    }

    if (!articleBodyRef.current) return;
    const range = selection.getRangeAt(0);
    if (!articleBodyRef.current.contains(range.commonAncestorContainer)) {
      return;
    }

    const rect = range.getBoundingClientRect();
    const top = rect.top - 8;
    const left = rect.left + rect.width / 2;

    selectionRangeRef.current = range;
    setSelectedText(selection.toString());
    setToolbarPosition({ top, left });
  };

  const handleCreateHighlight = async () => {
    if (!state.content || !articleBodyRef.current) return;
    if (!selectionRangeRef.current || !selectedText.trim()) {
      toast.error("Select text before marking.");
      return;
    }

    try {
      const range = selectionRangeRef.current;
      const container = articleBodyRef.current;
      const preRange = range.cloneRange();
      preRange.selectNodeContents(container);
      preRange.setEnd(range.startContainer, range.startOffset);
      const characterStart = preRange.toString().length;
      const characterEnd = characterStart + range.toString().length;

      const newHighlight = await createHighlight({
        article_url: state.content.article_url,
        highlighted_text: selectedText.trim(),
        color: highlightColor,
        character_start: characterStart,
        character_end: characterEnd,
      });

      setHighlights((prev) => [...prev, newHighlight]);
      setSelectedText("");
      setToolbarPosition(null);
      selectionRangeRef.current = null;
      window.getSelection()?.removeAllRanges();
      logUserAction("highlight_created", {
        url: state.content.article_url,
        color: highlightColor,
      });
      toast.success("Annotation saved");
    } catch (error) {
      console.error("Failed to create highlight:", error);
      toast.error("Failed to create annotation");
    }
  };

  const handleUpdateNote = async (highlightId: number) => {
    try {
      const updated = await updateHighlight(highlightId, {
        note: editingNote,
      });
      setHighlights((prev) =>
        prev.map((item) => (item.id === highlightId ? updated : item))
      );
      setEditingId(null);
      setEditingNote("");
      logUserAction("highlight_note_updated", { highlightId });
      toast.success("Note saved");
    } catch (error) {
      console.error("Failed to update note:", error);
      toast.error("Failed to update note");
    }
  };

  const handleDeleteHighlight = async (highlightId: number) => {
    try {
      await deleteHighlight(highlightId);
      setHighlights((prev) => prev.filter((item) => item.id !== highlightId));
      logUserAction("highlight_deleted", { highlightId });
      toast.success("Annotation removed");
    } catch (error) {
      console.error("Failed to delete highlight:", error);
      toast.error("Failed to delete highlight");
    }
  };

  const markdownExport = useMemo(
    () => buildHighlightMarkdown(state.content, highlights),
    [state.content, highlights]
  );

  useEffect(() => {
    if (!state.content?.article_url) return;
    const key = `scoop_highlights_md_${state.content.article_url}`;
    localStorage.setItem(key, markdownExport);
  }, [markdownExport, state.content?.article_url]);

  const handleCopyMarkdown = async () => {
    if (!markdownExport) return;
    try {
      await navigator.clipboard.writeText(markdownExport);
      logUserAction("highlight_markdown_copied", {
        url: state.content?.article_url,
      });
      toast.success("Markdown copied");
    } catch (error) {
      console.error("Failed to copy markdown:", error);
      toast.error("Failed to copy markdown");
    }
  };

  const handleDownloadMarkdown = () => {
    if (!markdownExport || !state.content) return;
    const blob = new Blob([markdownExport], { type: "text/markdown" });
    const fileName = `${sanitizeFilename(state.content.article_title)}.md`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
    logUserAction("highlight_markdown_downloaded", {
      url: state.content.article_url,
    });
  };

  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading article...</p>
        </div>
      </div>
    );
  }

  if (state.error || !state.content) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Failed to load article
          </h2>
          <p className="text-muted-foreground mb-4">{state.error}</p>
          <Button
            onClick={() => router.back()}
            variant="outline"
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Go back
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
    <div className="min-h-screen bg-background flex flex-col">
      <div className="sticky top-0 z-20 border-b border-border/60 bg-background/95">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <div className="text-sm text-muted-foreground">
              {content.article_source}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {content.estimated_read_time_minutes && (
              <span className="text-xs text-muted-foreground border border-border/60 px-2 py-1 rounded">
                {content.estimated_read_time_minutes} min read
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHighlights((prev) => !prev)}
              className="gap-2"
            >
              {showHighlights ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              Annotations
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div className="mb-6">
              <h1 className="text-3xl md:text-4xl font-semibold text-foreground font-serif leading-tight">
                {content.article_title}
              </h1>
              <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
                <span>{content.article_source}</span>
                {content.word_count && (
                  <>
                    <span>•</span>
                    <span>{content.word_count} words</span>
                  </>
                )}
              </div>
            </div>

            <div
              ref={articleBodyRef}
              onMouseUp={handleSelection}
              className="text-base leading-relaxed text-foreground whitespace-pre-wrap"
            >
              {content.full_text || "Full text not available yet."}
            </div>
          </div>

          {showHighlights && (
            <aside className="space-y-4">
              <div className="rounded-lg border border-border/60 bg-[var(--news-bg-secondary)]/70 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                      Annotations
                    </div>
                    <h2 className="text-lg font-semibold text-foreground">
                      Annotations
                    </h2>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {highlights.length}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setHighlightColor(color)}
                      className={`h-7 w-7 rounded border ${
                        highlightColor === color
                          ? "border-foreground"
                          : "border-transparent"
                      } ${colorClassMap[color]}`}
                      aria-label={`Annotation color ${color}`}
                    />
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyMarkdown}
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadMarkdown}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Export
                  </Button>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  Annotations export as markdown with italicized notes for
                  Obsidian.
                </p>
              </div>

              <div className="space-y-3">
                {highlights.length === 0 ? (
                  <div className="rounded-lg border border-border/60 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
                    Select text to add an annotation.
                  </div>
                ) : (
                  highlights.map((highlight) => (
                    <div
                      key={highlight.id}
                      className="rounded-lg border border-border/60 bg-background/60 p-4 space-y-3"
                    >
                      <div
                        className={`rounded-md px-3 py-2 text-sm ${colorClassMap[highlight.color]}`}
                      >
                        {highlight.highlighted_text}
                      </div>
                      {editingId === highlight.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editingNote}
                            onChange={(event) => setEditingNote(event.target.value)}
                            placeholder="Add a note..."
                            rows={3}
                            className="w-full rounded border border-border/60 bg-background px-2 py-1 text-sm text-foreground"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleUpdateNote(highlight.id!)}
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
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {highlight.note && (
                            <p className="text-sm italic text-muted-foreground">
                              {highlight.note}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingId(highlight.id ?? null);
                                setEditingNote(highlight.note || "");
                              }}
                              className="gap-1"
                            >
                              <Edit2 className="h-3 w-3" />
                              Note
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDeleteHighlight(highlight.id!)}
                              className="gap-1 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                              Remove
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </aside>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-border/60 bg-background/95">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
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

          <div className="text-xs text-muted-foreground">
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
      </div>

      {selectedText && toolbarPosition && (
        <div
          className="fixed z-50 flex items-center gap-2 rounded-lg border border-border/60 bg-background/95 px-3 py-2 shadow-lg"
          style={{
            top: Math.max(toolbarPosition.top, 16),
            left: toolbarPosition.left,
            transform: "translate(-50%, -100%)",
          }}
        >
          <Highlighter className="h-4 w-4 text-muted-foreground" />
          <div className="flex items-center gap-1">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setHighlightColor(color)}
                className={`h-5 w-5 rounded ${colorClassMap[color]} ${
                  highlightColor === color ? "ring-2 ring-foreground" : ""
                }`}
                aria-label={`Annotation color ${color}`}
              />
            ))}
          </div>
          <Button size="sm" onClick={handleCreateHighlight} className="gap-1">
            <Highlighter className="h-3 w-3" />
            Mark
          </Button>
        </div>
      )}
    </div>
  );
}
