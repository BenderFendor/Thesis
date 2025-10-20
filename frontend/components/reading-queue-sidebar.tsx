"use client";

import { useReadingQueue } from "@/hooks/useReadingQueue";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { List, ChevronDown, Trash2, X, ExternalLink } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { type NewsArticle } from "@/lib/api";

export function ReadingQueueSidebar() {
  const { queuedArticles, removeArticleFromQueue, isLoaded } =
    useReadingQueue();
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [selectedArticleUrl, setSelectedArticleUrl] = useState<string | null>(
    null
  );

  const handleRemove = (articleUrl: string) => {
    removeArticleFromQueue(articleUrl);
  };

  const selectedArticle =
    selectedArticleUrl && queuedArticles
      ? queuedArticles.find((a) => a.url === selectedArticleUrl)
      : null;
  const selectedArticleIndex = selectedArticle
    ? queuedArticles.findIndex((a) => a.url === selectedArticleUrl)
    : -1;

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg hover:shadow-xl transition-shadow"
            style={{
              backgroundColor: "var(--primary)",
              borderColor: "var(--primary)",
            }}
          >
            <List className="h-6 w-6 text-primary-foreground" />
            {isLoaded && queuedArticles.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white font-semibold">
                {queuedArticles.length}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent
          className="flex flex-col p-0"
          style={{
            backgroundColor: "var(--news-bg-primary)",
            width: selectedArticle ? "70vw" : "540px",
            maxWidth: selectedArticle ? "70vw" : "100%",
          }}
        >
          {/* Full-screen article detail view */}
          {selectedArticle ? (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Detail Header */}
              <div
                className="flex items-center justify-between p-6 border-b flex-shrink-0"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex-1 mr-4">
                  <h1 className="font-bold text-2xl leading-tight font-serif">
                    {selectedArticle.title}
                  </h1>
                  <p
                    className="text-sm mt-2"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {selectedArticle.source}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedArticleUrl(null)}
                  className="flex-shrink-0"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              {/* Detail Content - Scrollable */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-6 space-y-6 max-w-4xl mx-auto">
                  {/* Featured Image */}
                  {selectedArticle.image && (
                    <div className="rounded-lg overflow-hidden">
                      <img
                        src={selectedArticle.image}
                        alt={selectedArticle.title}
                        className="w-full h-96 object-cover"
                      />
                    </div>
                  )}

                  {/* Metadata Bar */}
                  <div
                    className="flex flex-wrap gap-4 text-sm pb-4 border-b"
                    style={{
                      color: "var(--muted-foreground)",
                      borderColor: "var(--border)",
                    }}
                  >
                    {selectedArticle.publishedAt && (
                      <div>
                        <span className="font-semibold">Published:</span>{" "}
                        {new Date(
                          selectedArticle.publishedAt
                        ).toLocaleDateString()}
                      </div>
                    )}
                    <div>
                      <span className="font-semibold">Source:</span>{" "}
                      {selectedArticle.source}
                    </div>
                  </div>

                  {/* Summary/Content */}
                  <div
                    className="space-y-4 text-base leading-relaxed"
                    style={{ color: "var(--foreground)" }}
                  >
                    {selectedArticle.summary && (
                      <div>
                        <h3 className="font-bold text-lg mb-2">Summary</h3>
                        <p>{selectedArticle.summary}</p>
                      </div>
                    )}
                    {selectedArticle.content && (
                      <div>
                        <h3 className="font-bold text-lg mb-2">Article Text</h3>
                        <p className="whitespace-pre-wrap">
                          {selectedArticle.content}
                        </p>
                      </div>
                    )}
                    {!selectedArticle.summary &&
                      !selectedArticle.content && (
                        <p>No content available for this article.</p>
                      )}
                  </div>
                </div>
              </div>

              {/* Detail Footer Actions */}
              <div
                className="flex gap-3 p-6 border-t flex-shrink-0"
                style={{ borderColor: "var(--border)" }}
              >
                <Button
                  className="flex-1"
                  asChild
                  style={{
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-foreground)",
                  }}
                >
                  <a
                    href={selectedArticle.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Read on Source
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    handleRemove(selectedArticle.url);
                    setSelectedArticleUrl(null);
                  }}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            /* List View */
            <>
              <SheetHeader
                className="px-6 pt-6 pb-4 border-b"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between">
                  <SheetTitle className="text-4xl font-bold font-serif">
                    Articles to Read
                  </SheetTitle>
                  <span
                    className="text-sm font-medium px-3 py-1 rounded-full"
                    style={{
                      backgroundColor: "var(--primary)",
                      color: "var(--primary-foreground)",
                    }}
                  >
                    {queuedArticles.length}
                  </span>
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto flex flex-col px-6 py-6">
                {isLoaded && queuedArticles.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center">
                <div className="space-y-2">
                  <p
                    className="text-lg font-semibold"
                    style={{ color: "var(--foreground)" }}
                  >
                    Your queue is empty
                  </p>
                  <p
                    className="text-sm"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    Start adding articles to build your reading list
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Articles List */}
                {queuedArticles.map((article, index) => {
                  const isExpanded = expandedIndex === index;

                  return (
                    <button
                      key={article.url}
                      onClick={() =>
                        setExpandedIndex(isExpanded ? null : index)
                      }
                      className={cn(
                        "w-full transition-all duration-300 ease-out cursor-pointer text-left group",
                        "transform hover:scale-105"
                      )}
                      style={{
                        marginLeft: `${Math.min(index * 4, 16)}px`,
                        marginTop: index > 0 ? "-8px" : "0px",
                      }}
                    >
                      <div
                        className={cn(
                          "relative rounded-2xl border overflow-hidden backdrop-blur-sm",
                          "transition-all duration-300",
                          "p-4 flex flex-col",
                          isExpanded
                            ? "shadow-2xl ring-2"
                            : "shadow-lg group-hover:shadow-xl"
                        )}
                        style={{
                          backgroundColor: isExpanded
                            ? "var(--news-bg-secondary)"
                            : "var(--card)",
                          borderColor: isExpanded
                            ? "var(--primary)"
                            : "var(--border)",
                          outlineColor: isExpanded
                            ? "var(--primary)"
                            : undefined,
                          outlineWidth: isExpanded ? "2px" : "0px",
                          outlineOffset: isExpanded ? "0px" : "0px",
                        }}
                      >
                        <div className="flex items-start gap-3">
                          {/* Index Badge */}
                          <div
                            className="flex-shrink-0 text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center"
                            style={{
                              backgroundColor: "var(--primary)",
                              color: "var(--primary-foreground)",
                            }}
                          >
                            {index + 1}
                          </div>

                          {/* Title and Source */}
                          <div className="flex-1 min-w-0">
                            <h3
                              className={cn(
                                "font-bold leading-tight group-hover:text-primary transition-colors",
                                isExpanded
                                  ? "text-base"
                                  : "text-sm line-clamp-2"
                              )}
                              style={{
                                color: isExpanded
                                  ? "var(--foreground)"
                                  : "var(--foreground)",
                              }}
                            >
                              {article.title}
                            </h3>
                            <p
                              className="text-xs mt-1"
                              style={{
                                color: "var(--muted-foreground)",
                              }}
                            >
                              {article.source}
                            </p>
                          </div>

                          {/* Image Thumbnail - Right Side */}
                          {article.image && !isExpanded && (
                            <div
                              className="flex-shrink-0 h-12 w-16 rounded-lg overflow-hidden border"
                              style={{ borderColor: "var(--border)" }}
                            >
                              <img
                                src={article.image}
                                alt={article.title}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}

                          {/* Expand Indicator */}
                          <div
                            className="flex-shrink-0 transition-transform"
                            style={{
                              color: "var(--muted-foreground)",
                              transform: isExpanded
                                ? "rotate(180deg)"
                                : "rotate(0deg)",
                            }}
                          >
                            <ChevronDown className="h-5 w-5" />
                          </div>
                        </div>

                        {/* Expandable Content */}
                        {isExpanded && (
                          <div
                            className="space-y-3 pt-3 mt-3 border-t animate-in fade-in slide-in-from-top-2 duration-200"
                            style={{ borderColor: "var(--border)" }}
                          >
                            {article.image && (
                              <img
                                src={article.image}
                                alt={article.title}
                                className="w-full h-40 object-cover rounded-lg"
                              />
                            )}
                            <p
                              className="text-sm"
                              style={{
                                color: "var(--foreground)",
                              }}
                            >
                              {article.summary ||
                                article.content ||
                                "No description available"}
                            </p>
                            <div className="flex gap-2 pt-2">
                              <Button
                                size="sm"
                                className="flex-1"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setSelectedArticleUrl(article.url);
                                }}
                                style={{
                                  backgroundColor: "var(--primary)",
                                  color: "var(--primary-foreground)",
                                }}
                              >
                                Read Article
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleRemove(article.url);
                                }}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
