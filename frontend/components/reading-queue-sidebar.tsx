"use client";

import { useReadingQueue } from "@/hooks/useReadingQueue";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useLikedArticles } from "@/hooks/use-liked-articles";
import { useFavorites } from "@/hooks/useFavorites";
import { useReadingHistory } from "@/hooks/useReadingHistory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertTriangle,
  Bookmark,
  Bug,
  ChevronDown,
  DollarSign,
  ExternalLink,
  Heart,
  List,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { SafeImage } from "@/components/safe-image";
import { API_BASE_URL, analyzeArticle, fetchSourceDebugData, getSourceById } from '@/lib/api';
import type { ArticleAnalysis, NewsArticle, NewsSource, SourceDebugData } from '@/lib/api';
import { ArticleDetailModal } from "@/components/article-detail-modal";
import { ArticleInlineEmbed } from "@/components/article-inline-embed";
import { NoveltyBadge } from "@/components/novelty-badge";
import { SemanticTags } from "@/components/semantic-tags";
import { activateCardFromKeyDown } from "@/lib/keyboard-activation";

function getArticlePreview(article: NewsArticle): string {
  const text = article.summary || article.content || "No description available",
   words = text.split(/\s+/);
  return words.length > 150 ? `${words.slice(0, 150).join(" ")  } ...` : text;
}

function handleCardKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  onActivate: () => void,
) {
  activateCardFromKeyDown(event, onActivate);
}

type DigestCodeRendererProps = {
  node?: unknown;
  className?: string;
  children?: React.ReactNode;
  onOpenArticle: (article: NewsArticle) => void;
} & React.HTMLAttributes<HTMLElement>;

function DigestCodeRenderer({
  node,
  className,
  children,
  onOpenArticle,
  ...props
}: DigestCodeRendererProps) {
  const text = String(children).replace(/\n$/, ""),
   nodeWithLang = node as { lang?: string } | undefined,
   isStructured =
    (className === "language-json:articles") ||
    // Some markdown renderers include the fence label in node.lang or node.meta
    (typeof nodeWithLang?.lang === 'string' && nodeWithLang.lang === 'json:articles') ||
    (text.trim().startsWith('{') && text.includes('"articles"'));
  if (isStructured) {
    // Try parse and render ArticleInlineEmbed components
    try {
      const payload = JSON.parse(text),
       items = Array.isArray(payload.articles) ? payload.articles : [];
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-3">
          {items.map((it: { url?: string; link?: string } | null, idx: number) => {
            const articleRef =
              typeof it === "object" && it !== null
                ? (it)
                : {},
             url = articleRef.url || articleRef.link || `about:blank#${idx}`;
            return (
              <ArticleInlineEmbed
                key={url}
                url={url}
                onOpen={onOpenArticle}
              />
            );
          })}
        </div>
      );
    } catch (error) {
      console.error('Failed to parse structured articles JSON in markdown code block', error);
    }
  }
  // Fallback: simple inline code style
  return (
    <code
      className="px-2 py-1 rounded text-sm"
      style={{ backgroundColor: "rgba(0,0,0,0.3)", color: "rgb(168,85,247)" }}
      {...props}
    >
      {text}
    </code>
  );
}

interface QueueCardMetaProps {
  article: NewsArticle;
  estimatedReadTime?: number;
  readingHistoryIds: number[];
}

function QueueCardMeta({
  article,
  estimatedReadTime,
  readingHistoryIds,
}: QueueCardMetaProps) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <p
        className="text-xs"
        style={{
          color: "var(--muted-foreground)",
        }}
      >
        {article.source}
      </p>
      {estimatedReadTime && (
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{
            backgroundColor: "var(--primary)",
            color: "var(--primary)",
          }}
        >
          {estimatedReadTime}m
        </span>
      )}
      {typeof article.id === "number" && readingHistoryIds.length > 0 && (
        <NoveltyBadge
          articleId={article.id}
          readingHistory={readingHistoryIds}
        />
      )}
      {!article._queueData?.preloadedAt && (
        <Badge
          className="text-xs flex items-center gap-1 animate-pulse"
          style={{
            backgroundColor: "rgba(59, 130, 246, 0.15)",
            color: "rgb(59, 130, 246)",
          }}
        >
          <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          Loading...
        </Badge>
      )}
    </div>
  );
}

interface QueueCardExpandableProps {
  article: NewsArticle;
  onOpen: () => void;
  onRemove: () => void;
}

function QueueCardExpandable({
  article,
  onOpen,
  onRemove,
}: QueueCardExpandableProps) {
  return (
    <div
      className="space-y-3 pt-3 mt-3 border-t animate-in fade-in slide-in-from-top-2 duration-200"
      style={{ borderColor: "var(--border)" }}
    >
      {article.image && (
        <SafeImage
          src={article.image}
          alt={article.title}
          width={640}
          height={160}
          className="w-full h-40 object-cover rounded-lg"
        />
      )}
      <p
        className="text-sm"
        style={{
          color: "var(--foreground)",
        }}
      >
        {getArticlePreview(article)}
      </p>
      <div className="flex gap-2 pt-2">
        <Button
          size="sm"
          className="flex-1"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpen();
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
            e.stopPropagation();
            onRemove();
          }}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

interface QueueCardProps {
  article: NewsArticle;
  index: number;
  isExpanded: boolean;
  estimatedReadTime?: number;
  readingHistoryIds: number[];
  onToggle: () => void;
  onOpen: () => void;
  onRemove: () => void;
}

function QueueCard({
  article,
  index,
  isExpanded,
  estimatedReadTime,
  readingHistoryIds,
  onToggle,
  onOpen,
  onRemove,
}: QueueCardProps) {
  return (
    <div
      onClick={onToggle}
      onKeyDown={(event) =>{  handleCardKeyDown(event, onToggle); }}
      role="button"
      tabIndex={0}
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
          "relative rounded-xl border overflow-hidden backdrop-blur-sm",
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
          outlineOffset: "0px",
          outlineWidth: isExpanded ? "2px" : "0px",
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
                color: "var(--foreground)",
              }}
            >
              {article.title}
            </h3>
            <QueueCardMeta
              article={article}
              estimatedReadTime={estimatedReadTime}
              readingHistoryIds={readingHistoryIds}
            />
            {/* Semantic Tags */}
            {typeof article.id === "number" && isExpanded && (
              <SemanticTags
                articleId={article.id}
                maxTags={3}
                className="mt-2"
              />
            )}
          </div>

          {/* Image Thumbnail - Right Side */}
          {article.image && !isExpanded && (
            <div
              className="flex-shrink-0 h-12 w-16 rounded-lg overflow-hidden border"
              style={{ borderColor: "var(--border)" }}
            >
              <SafeImage
                src={article.image}
                alt={article.title}
                width={64}
                height={48}
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
          <QueueCardExpandable
            article={article}
            onOpen={onOpen}
            onRemove={onRemove}
          />
        )}
      </div>
    </div>
  );
}

interface ArticleDetailHeaderProps {
  article: NewsArticle;
  index: number;
  count: number;
  readTime?: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

function ArticleDetailHeader({
  article,
  index,
  count,
  readTime,
  onPrevious,
  onNext,
  onClose,
}: ArticleDetailHeaderProps) {
  return (
    <div
      className="flex items-center justify-between p-6 border-b flex-shrink-0"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex-1 mr-4">
        <h1 className="font-bold text-2xl leading-tight font-serif">
          {article.title}
        </h1>
        <p
          className="text-sm mt-2"
          style={{ color: "var(--muted-foreground)" }}
        >
          {article.source}
        </p>
        <div className="flex items-center gap-3 mt-2">
          <p
            className="text-xs"
            style={{ color: "var(--muted-foreground)" }}
          >
            Article {index + 1} of {count}
          </p>
          {readTime && (
            <span
              className="text-xs px-2 py-1 rounded-full"
              style={{
                backgroundColor: "rgba(168, 85, 247, 0.2)",
                border: "1px solid rgba(168, 85, 247, 0.3)",
                color: "var(--primary)",
              }}
            >
              {readTime} min read
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={onPrevious}
          disabled={index === 0}
          title="Previous article (← Arrow)"
        >
          ← Prev
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onNext}
          disabled={index === count - 1}
          title="Next article (→ Arrow)"
        >
          Next →
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="flex-shrink-0"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

interface FullArticleSectionProps {
  article: NewsArticle;
  articleLoading: boolean;
  fullArticleText: string | null;
}

function FullArticleSection({
  article,
  articleLoading,
  fullArticleText,
}: FullArticleSectionProps) {
  return (
    <div>
      <h3 className="font-bold text-lg mb-2">Full Article</h3>
      {articleLoading ? (
        <div className="flex items-center gap-3 p-4 bg-gray-900/50 rounded-lg border border-gray-800">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
          <p className="text-gray-400 text-sm">
            Loading full article text...
          </p>
        </div>
      ) : (fullArticleText ? (
        <div
          className="text-gray-300 leading-relaxed whitespace-pre-wrap text-sm"
          style={{ color: "var(--foreground)" }}
        >
          {fullArticleText}
        </div>
      ) : (
        <div
          className="text-gray-300 leading-relaxed text-sm"
          style={{ color: "var(--foreground)" }}
        >
          {article.content || article.summary}
        </div>
      ))}
    </div>
  );
}

interface ArticleDetailActionButtonsProps {
  isLiked: boolean;
  isFavorite: boolean;
  isBookmarked: boolean;
  isRead: boolean;
  onLike: () => void;
  onFavorite: () => void;
  onBookmark: () => void;
  onMarkRead: () => void;
}

function ArticleDetailActionButtons({
  isLiked,
  isFavorite,
  isBookmarked,
  isRead,
  onLike,
  onFavorite,
  onBookmark,
  onMarkRead,
}: ArticleDetailActionButtonsProps) {
  return (
    <div
      className="flex gap-2 pt-4 border-t flex-wrap"
      style={{ borderColor: "var(--border)" }}
    >
      <Button
        size="sm"
        variant="ghost"
        onClick={onLike}
        className={
          isLiked ? "text-red-400" : "text-gray-400"
        }
      >
        <Heart
          className={`h-4 w-4 mr-2 ${isLiked ? "fill-current" : ""
            }`}
        />
        Like
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onFavorite}
        className={
          isFavorite
            ? "text-yellow-400"
            : "text-gray-400"
        }
      >
        <Star
          className={`h-4 w-4 mr-2 ${isFavorite ? "fill-current" : ""
            }`}
        />
        Favorite
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onBookmark}
        className={
          isBookmarked ? "text-yellow-400" : "text-gray-400"
        }
      >
        <Bookmark
          className={`h-4 w-4 ${isBookmarked ? "fill-current" : ""
            }`}
        />
        Bookmark
      </Button>
      <Button
        size="sm"
        variant={
          isRead
            ? "default"
            : "outline"
        }
        onClick={onMarkRead}
        className={
          isRead
            ? "text-green-400"
            : "text-gray-400"
        }
        title="Mark as read (M)"
      >
        Read
      </Button>
    </div>
  );
}

interface ArticleDetailMainProps {
  article: NewsArticle;
  articleLoading: boolean;
  fullArticleText: string | null;
  isLiked: boolean;
  isFavorite: boolean;
  isBookmarked: boolean;
  isRead: boolean;
  onLike: () => void;
  onFavorite: () => void;
  onBookmark: () => void;
  onMarkRead: () => void;
}

function ArticleDetailMain({
  article,
  articleLoading,
  fullArticleText,
  isLiked,
  isFavorite,
  isBookmarked,
  isRead,
  onLike,
  onFavorite,
  onBookmark,
  onMarkRead,
}: ArticleDetailMainProps) {
  return (
    <div className="lg:col-span-2 space-y-6">
      {/* Featured Image */}
      {article.image && (
        <div className="rounded-lg overflow-hidden">
          <SafeImage
            src={article.image}
            alt={article.title}
            width={1280}
            height={384}
            className="w-full h-96 object-cover"
          />
        </div>
      )}

      {/* Metadata Bar */}
      <div
        className="flex flex-wrap gap-4 text-sm pb-4 border-b"
        style={{
          borderColor: "var(--border)",
          color: "var(--muted-foreground)",
        }}
      >
        {article.publishedAt && (
          <div>
            <span className="font-semibold">Published:</span>{" "}
            {new Date(
              article.publishedAt
            ).toLocaleDateString()}
          </div>
        )}
        <div>
          <span className="font-semibold">Source:</span>{" "}
          {article.source}
        </div>
      </div>

      {/* Summary/Content */}
      <div
        className="space-y-4 text-base leading-relaxed"
        style={{ color: "var(--foreground)" }}
      >
        {article.summary &&
          article.summary !== article.content && (
            <div>
              <h3 className="font-bold text-lg mb-2">Summary</h3>
              <p>{article.summary}</p>
            </div>
          )}

        {/* Full Article Text */}
        <FullArticleSection
          article={article}
          articleLoading={articleLoading}
          fullArticleText={fullArticleText}
        />

        {article.content &&
          !fullArticleText &&
          !articleLoading && (
            <div>
              <h3 className="font-bold text-lg mb-2">
                Article Text
              </h3>
              <p className="whitespace-pre-wrap text-sm">
                {article.content}
              </p>
            </div>
          )}

        {!article.summary &&
          !article.content &&
          !fullArticleText && (
            <p>No content available for this article.</p>
          )}
      </div>

      {/* Action Buttons */}
      <ArticleDetailActionButtons
        isLiked={isLiked}
        isFavorite={isFavorite}
        isBookmarked={isBookmarked}
        isRead={isRead}
        onLike={onLike}
        onFavorite={onFavorite}
        onBookmark={onBookmark}
        onMarkRead={onMarkRead}
      />
    </div>
  );
}

function KeyboardShortcutsCard() {
  return (
    <div
      className="rounded-lg p-4 border text-xs"
      style={{
        backgroundColor: "var(--card)",
        borderColor: "var(--border)",
      }}
    >
      <h3 className="font-semibold text-sm text-white mb-2">
        Keyboard Shortcuts
      </h3>
      <div className="space-y-1" style={{ color: "var(--muted-foreground)" }}>
        <div>
          <kbd className="px-2 py-1 bg-gray-700 rounded text-xs mr-2">→</kbd>
          Next article
        </div>
        <div>
          <kbd className="px-2 py-1 bg-gray-700 rounded text-xs mr-2">←</kbd>
          Previous article
        </div>
        <div>
          <kbd className="px-2 py-1 bg-gray-700 rounded text-xs mr-2">M</kbd>
          Mark as read
        </div>
        <div>
          <kbd className="px-2 py-1 bg-gray-700 rounded text-xs mr-2">Esc</kbd>
          Close article
        </div>
      </div>
    </div>
  );
}

interface AiSummaryCardProps {
  aiAnalysisLoading: boolean;
  aiAnalysis: ArticleAnalysis | null;
}

function AiSummaryCard({
  aiAnalysisLoading,
  aiAnalysis,
}: AiSummaryCardProps) {
  if (aiAnalysisLoading) {
    return (
      <div
        className="flex items-center justify-center p-4 rounded-lg border"
        style={{
          backgroundColor: "var(--card)",
          borderColor: "var(--border)",
        }}
      >
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
      </div>
    );
  }
  if (!aiAnalysis?.success || !aiAnalysis.summary) {
    return undefined;
  }
  return (
    <div
      className="rounded-lg p-4 border"
      style={{
        backgroundColor:
          "rgba(168, 85, 247, 0.1)",
        borderColor: "rgba(168, 85, 247, 0.3)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm text-white">
          AI Summary
        </h3>
      </div>
      <p
        className="text-sm leading-relaxed"
        style={{
          color: "var(--foreground)",
        }}
      >
        {aiAnalysis.summary}
      </p>
    </div>
  );
}

interface BiasAnalysisCardProps {
  aiAnalysis: ArticleAnalysis | null;
}

function BiasAnalysisCard({ aiAnalysis }: BiasAnalysisCardProps) {
  if (!aiAnalysis?.success || !aiAnalysis.bias_analysis) {
    return undefined;
  }
  return (
    <div
      className="rounded-lg p-4 border"
      style={{
        backgroundColor: "var(--card)",
        borderColor: "var(--border)",
      }}
    >
      <h3 className="flex items-center gap-2 font-semibold text-sm text-white mb-2">
        <AlertTriangle className="h-4 w-4 text-yellow-400" />
        Bias Analysis
      </h3>
      {aiAnalysis.bias_analysis.overall_bias_score && (
        <Badge className="mb-2 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
          Score: {aiAnalysis.bias_analysis.overall_bias_score}/10
        </Badge>
      )}
      <div className="space-y-2 text-xs">
        {aiAnalysis.bias_analysis.tone_bias && (
          <div>
            <span style={{ color: "var(--muted-foreground)" }}>
              Tone:
            </span>
            <p style={{ color: "var(--foreground)" }}>
              {aiAnalysis.bias_analysis.tone_bias}
            </p>
          </div>
        )}
        {aiAnalysis.bias_analysis.framing_bias && (
          <div>
            <span style={{ color: "var(--muted-foreground)" }}>
              Framing:
            </span>
            <p style={{ color: "var(--foreground)" }}>
              {aiAnalysis.bias_analysis.framing_bias}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface SourceDebugPanelProps {
  debugLoading: boolean;
  debugData: SourceDebugData | null;
}

function SourceDebugPanel({
  debugLoading,
  debugData,
}: SourceDebugPanelProps) {
  if (debugLoading) {
    return (
      <div className="flex items-center justify-center">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
      </div>
    );
  }
  if (debugData) {
    return (
      <div
        style={{
          color: "var(--foreground)",
        }}
      >
        Feed has{" "}
        {debugData.parsed_entries?.length || 0} entries
      </div>
    );
  }
  return (
    <div
      style={{
        color: "var(--muted-foreground)",
      }}
    >
      No debug data
    </div>
  );
}

interface SourceCardProps {
  sourceLoading: boolean;
  source: NewsSource | null;
  showSourceDetails: boolean;
  onToggleDetails: () => void;
  debugOpen: boolean;
  onToggleDebug: () => void;
  debugLoading: boolean;
  debugData: SourceDebugData | null;
}

function SourceCard({
  sourceLoading,
  source,
  showSourceDetails,
  onToggleDetails,
  debugOpen,
  onToggleDebug,
  debugLoading,
  debugData,
}: SourceCardProps) {
  return (
    <div
      className="rounded-lg p-4 border"
      style={{
        backgroundColor: "var(--card)",
        borderColor: "var(--border)",
      }}
    >
      <h3 className="flex items-center gap-2 font-semibold text-sm text-white mb-3">
        <AlertTriangle className="h-4 w-4 text-yellow-400" />
        Source
      </h3>
      {sourceLoading ? (
        <div className="flex items-center justify-center p-4">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
        </div>
      ) : (source ? (
        <div className="space-y-2 text-xs">
          {source.funding && source.funding.length > 0 && (
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              <span
                style={{
                  color: "var(--foreground)",
                }}
              >
                {source.funding.join(", ")}
              </span>
            </div>
          )}
          {showSourceDetails && source.url && (
            <div
              className="pt-2 border-t space-y-2"
              style={{ borderColor: "var(--border)" }}
            >
              <div>
                <span
                  style={{
                    color: "var(--muted-foreground)",
                  }}
                >
                  Website:
                </span>
                <p
                  style={{
                    color: "var(--foreground)",
                  }}
                >
                  {source.url}
                </p>
              </div>
              <div>
                <span
                  style={{
                    color: "var(--muted-foreground)",
                  }}
                >
                  Category:
                </span>
                <p
                  style={{
                    color: "var(--foreground)",
                  }}
                >
                  {source.category.join(", ")}
                </p>
              </div>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onToggleDetails}
            className="w-full mt-2 text-xs"
          >
            {showSourceDetails ? "Hide" : "Show"} Details
          </Button>
        </div>
      ) : (
        <p
          className="text-xs"
          style={{ color: "var(--muted-foreground)" }}
        >
          Source info unavailable
        </p>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={onToggleDebug}
        className="w-full mt-2 text-xs"
      >
        <Bug className="h-3 w-3 mr-1" />{" "}
        {debugOpen ? "Hide" : "Show"} Debug
      </Button>
      {debugOpen && (
        <div
          className="mt-2 p-2 rounded text-xs"
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            borderColor: "var(--border)",
          }}
        >
          <SourceDebugPanel
            debugLoading={debugLoading}
            debugData={debugData}
          />
        </div>
      )}
    </div>
  );
}

interface ArticleDetailFooterProps {
  article: NewsArticle;
  isRead: boolean;
  onMarkRead: () => void;
  onRemove: () => void;
}

function ArticleDetailFooter({
  article,
  isRead,
  onMarkRead,
  onRemove,
}: ArticleDetailFooterProps) {
  return (
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
          href={article.url}
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
        onClick={onMarkRead}
        className={
          isRead
            ? "text-green-400"
            : "text-gray-400 hover:text-green-400"
        }
        title="Mark as read (M)"
       />
      <Button
        variant="ghost"
        onClick={onRemove}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface ArticleDetailViewProps {
  article: NewsArticle;
  index: number;
  count: number;
  readTime?: number;
  articleLoading: boolean;
  fullArticleText: string | null;
  aiAnalysis: ArticleAnalysis | null;
  aiAnalysisLoading: boolean;
  source: NewsSource | null;
  sourceLoading: boolean;
  showSourceDetails: boolean;
  onToggleSourceDetails: () => void;
  debugOpen: boolean;
  onToggleDebug: () => void;
  debugLoading: boolean;
  debugData: SourceDebugData | null;
  isLiked: boolean;
  isFavorite: boolean;
  isBookmarked: boolean;
  isRead: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onLike: () => void;
  onFavorite: () => void;
  onBookmark: () => void;
  onMarkRead: () => void;
  onRemove: () => void;
}

function ArticleDetailView({
  article,
  index,
  count,
  readTime,
  articleLoading,
  fullArticleText,
  aiAnalysis,
  aiAnalysisLoading,
  source,
  sourceLoading,
  showSourceDetails,
  onToggleSourceDetails,
  debugOpen,
  onToggleDebug,
  debugLoading,
  debugData,
  isLiked,
  isFavorite,
  isBookmarked,
  isRead,
  onPrevious,
  onNext,
  onClose,
  onLike,
  onFavorite,
  onBookmark,
  onMarkRead,
  onRemove,
}: ArticleDetailViewProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ArticleDetailHeader
        article={article}
        index={index}
        count={count}
        readTime={readTime}
        onPrevious={onPrevious}
        onNext={onNext}
        onClose={onClose}
      />
      {/* Detail Content - Two Column Layout */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
          {/* Main Content - 2/3 width */}
          <ArticleDetailMain
            key={`article-${article.url}`}
            article={article}
            articleLoading={articleLoading}
            fullArticleText={fullArticleText}
            isLiked={isLiked}
            isFavorite={isFavorite}
            isBookmarked={isBookmarked}
            isRead={isRead}
            onLike={onLike}
            onFavorite={onFavorite}
            onBookmark={onBookmark}
            onMarkRead={onMarkRead}
          />

          {/* AI Analysis Sidebar - 1/3 width */}
          <div className="lg:col-span-1 space-y-4" key={`sidebar-${article.url}`}>
            <KeyboardShortcutsCard />
            <AiSummaryCard
              aiAnalysisLoading={aiAnalysisLoading}
              aiAnalysis={aiAnalysis}
            />
            <BiasAnalysisCard aiAnalysis={aiAnalysis} />
            <SourceCard
              sourceLoading={sourceLoading}
              source={source}
              showSourceDetails={showSourceDetails}
              onToggleDetails={onToggleSourceDetails}
              debugOpen={debugOpen}
              onToggleDebug={onToggleDebug}
              debugLoading={debugLoading}
              debugData={debugData}
            />
          </div>
        </div>
      </div>

      <ArticleDetailFooter
        article={article}
        isRead={isRead}
        onMarkRead={onMarkRead}
        onRemove={onRemove}
      />
    </div>
  );
}

interface QueueDigestViewProps {
  articleCount: number;
  digestLoading: boolean;
  queueDigest: string | null;
  embedModalArticle: NewsArticle | null;
  embedModalOpen: boolean;
  onClose: () => void;
  onOpenArticle: (article: NewsArticle) => void;
  onEmbedClose: () => void;
  onNavigateArticle: (direction: "next" | "previous") => void;
}

function QueueDigestView({
  articleCount,
  digestLoading,
  queueDigest,
  embedModalArticle,
  embedModalOpen,
  onClose,
  onOpenArticle,
  onEmbedClose,
  onNavigateArticle,
}: QueueDigestViewProps) {
  return (
    <>
      <SheetHeader
        className="px-6 pt-6 pb-4 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <SheetTitle className="text-3xl font-semibold font-serif">
              Reading Digest
            </SheetTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {articleCount} articles summarized for quick review
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        {digestLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <p style={{ color: "var(--muted-foreground)" }}>
                Generating your digest...
              </p>
            </div>
          </div>
        ) : (queueDigest ? (
          <div
            className="px-6 py-8 prose prose-invert max-w-none"
            style={{ color: "var(--foreground)" }}
          >
            <ReactMarkdown
              components={{
                h1: ({ ...props }) => (
                  <h1
                    className="font-semibold font-serif text-2xl mt-6 mb-3"
                    style={{ color: "var(--foreground)" }}
                    {...props}
                  />
                ),
                h2: ({ ...props }) => (
                  <h2
                    className="font-semibold font-serif text-xl mt-5 mb-2"
                    style={{ color: "var(--foreground)" }}
                    {...props}
                  />
                ),
                h3: ({ ...props }) => (
                  <h3
                    className="font-semibold font-serif text-lg mt-4 mb-2"
                    style={{ color: "var(--foreground)" }}
                    {...props}
                  />
                ),
                p: ({ ...props }) => (
                  <p
                    className="mb-3 leading-relaxed text-base"
                    style={{ color: "var(--foreground)" }}
                    {...props}
                  />
                ),
                ul: ({ ...props }) => (
                  <ul
                    className="list-disc list-inside mb-3 space-y-1"
                    style={{ color: "var(--foreground)" }}
                    {...props}
                  />
                ),
                ol: ({ ...props }) => (
                  <ol
                    className="list-decimal list-inside mb-3 space-y-1"
                    style={{ color: "var(--foreground)" }}
                    {...props}
                  />
                ),
                li: ({ ...props }) => (
                  <li
                    className="ml-2"
                    style={{ color: "var(--foreground)" }}
                    {...props}
                  />
                ),
                blockquote: ({ ...props }) => (
                  <blockquote
                    className="border-l-4 pl-4 italic my-3"
                    style={{
                      borderColor: "var(--primary)",
                      color: "var(--muted-foreground)",
                    }}
                    {...props}
                  />
                ),
                // Custom code renderer: detect the special json:articles fence and render inline embeds
                code: (props) => (
                  <DigestCodeRenderer {...props} onOpenArticle={onOpenArticle} />
                ),
                pre: ({ ...props }) => (
                  <pre
                    className="p-4 rounded mb-3 overflow-x-auto text-sm"
                    style={{ backgroundColor: "rgba(0, 0, 0, 0.4)", color: "var(--foreground)" }}
                    {...props}
                  />
                ),
                strong: ({ ...props }) => (
                  <strong className="font-semibold" style={{ color: "var(--primary)" }} {...props} />
                ),
                em: ({ ...props }) => (
                  <em className="italic" style={{ color: "var(--foreground)" }} {...props} />
                ),
              }}
            >
              {queueDigest}
            </ReactMarkdown>
            {embedModalArticle && (
              <ArticleDetailModal
                article={embedModalArticle}
                isOpen={embedModalOpen}
                onClose={onEmbedClose}
                onNavigate={(direction) => {
                  if (direction === "next") {
                    onNavigateArticle("next")
                  } else {
                    onNavigateArticle("previous")
                  }
                }}
              />
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p style={{ color: "var(--muted-foreground)" }}>
              Failed to generate digest
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

export function ReadingQueueSidebar() {
  const READ_SPEED_WPM = 230, // Average adult reading speed
   { queuedArticles, removeArticleFromQueue, isLoaded } =
    useReadingQueue(),
   { isFavorite, toggleFavorite } = useFavorites(),
   { getRecentIds: getReadingHistoryIds } = useReadingHistory(),
   readingHistoryIds = useMemo(() => getReadingHistoryIds(50), [getReadingHistoryIds]),
   [expandedIndex, setExpandedIndex] = useState<number | null>(undefined),
   [selectedArticleUrl, setSelectedArticleUrl] = useState<string | null>(
    undefined
  ),
   { isLiked, toggleLike } = useLikedArticles(),
   { isBookmarked, toggleBookmark } = useBookmarks(),
   [aiAnalysis, setAiAnalysis] = useState<ArticleAnalysis | null>(undefined),
   [aiAnalysisLoading, setAiAnalysisLoading] = useState(false),
   [source, setSource] = useState<NewsSource | null>(undefined),
   [sourceLoading, setSourceLoading] = useState(false),
   [showSourceDetails, setShowSourceDetails] = useState(false),
   [debugOpen, setDebugOpen] = useState(false),
   [debugLoading, setDebugLoading] = useState(false),
   [debugData, setDebugData] = useState<SourceDebugData | null>(undefined),
   [fullArticleText, setFullArticleText] = useState<string | null>(undefined),
   [articleLoading, setArticleLoading] = useState(false),
   [readArticles, setReadArticles] = useState<Set<string>>(new Set()),
   [estimatedReadTimes, setEstimatedReadTimes] = useState<
    Record<string, number>
  >({}),
   [queueDigest, setQueueDigest] = useState<string | null>(undefined),
   [digestLoading, setDigestLoading] = useState(false),
   [showQueueOverview, setShowQueueOverview] = useState(false),
   [embedModalArticle, setEmbedModalArticle] = useState<NewsArticle | null>(undefined),
   [embedModalOpen, setEmbedModalOpen] = useState(false),

   generateQueueDigest = async () => {
    if (!queuedArticles || queuedArticles.length === 0) {return;}

    try {
      setDigestLoading(true);

      // Build article summaries without calling AI analysis (to avoid rate limiting)
      // Use existing article summaries instead of fetching AI analysis for each one
      const articleSummaries = queuedArticles.map((article) => ({
        category: article.category || "Uncategorized",
        source: article.source,
        summary: article.summary || "",
        title: article.title,
        url: article.url,
      })),

      // Group by category
       grouped = articleSummaries.reduce< Record<string, typeof articleSummaries>>(
        (acc, article) => {
          const cat = article.category;
          if (!acc[cat]) {acc[cat] = [];}
          acc[cat].push(article);
          return acc;
        },
        {}
      ),

      // Generate digest via API (single AI call for the whole digest)
       response = await fetch(
        `${API_BASE_URL}/api/queue/digest`,
        {
          body: JSON.stringify({
            articles: articleSummaries,
            grouped,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      );

      if (response.ok) {
        const data = await response.json(),
         raw = data.digest || data.content || "",
         fenceRe = /```json:articles\n[\s\S]*?\n```/gu;
        setQueueDigest(raw.replace(fenceRe, "").trim());
      } else {
        console.error("Failed to generate digest");
        setQueueDigest(undefined);
      }
    } catch (error) {
      console.error("Error generating digest:", error);
      setQueueDigest(undefined);
    } finally {
      setDigestLoading(false);
    }
  },

   calculateReadTime = (text: string): number => {
    if (!text) {return 0;}
    const wordCount = text.trim().split(/\s+/).length;
    return Math.ceil(wordCount / READ_SPEED_WPM);
  },

   handleRemove = (articleUrl: string) => {
    removeArticleFromQueue(articleUrl);
  },

   handleMarkAsRead = (articleUrl: string) => {
    setReadArticles((prev) => {
      const next = new Set(prev);
      next.add(articleUrl);
      return next;
    });
  },

   handleNavigateArticle = useCallback((direction: "next" | "previous") => {
    if (!selectedArticleUrl || !queuedArticles) {return;}

    const currentIndex = queuedArticles.findIndex(
      (a) => a.url === selectedArticleUrl
    );
    let newIndex = currentIndex;

    if (direction === "next") {
      newIndex = Math.min(currentIndex + 1, queuedArticles.length - 1);
    } else {
      newIndex = Math.max(currentIndex - 1, 0);
    }

    if (newIndex !== currentIndex) {
      setSelectedArticleUrl(queuedArticles[newIndex]!.url);
    }
  }, [queuedArticles, selectedArticleUrl]),

   loadAiAnalysis = useCallback(async (article: NewsArticle) => {
    try {
      setAiAnalysisLoading(true);
      const analysis = await analyzeArticle(article.url, article.source);
      setAiAnalysis(analysis);
    } catch (error) {
      console.error("Failed to analyze article:", error);
      setAiAnalysis({
        article_url: article.url,
        error: error instanceof Error ? error.message : "Failed to analyze article",
        success: false,
      });
    } finally {
      setAiAnalysisLoading(false);
    }
  }, []),

   loadSource = useCallback(async (article: NewsArticle) => {
    setSourceLoading(true);
    try {
      const fetchedSource = await getSourceById(article.sourceId);
      setSource(fetchedSource || null);
    } catch (error) {
      console.error("Failed to load source:", error);
      setSource(undefined);
    } finally {
      setSourceLoading(false);
    }
  }, []),

   loadDebugData = async (article: NewsArticle) => {
    try {
      setDebugLoading(true);
      const data = await fetchSourceDebugData(article.source);
      setDebugData(data);
    } catch (error) {
      console.error("Failed to fetch debug data:", error);
      setDebugData(undefined);
    } finally {
      setDebugLoading(false);
    }
  },

   loadFullArticle = useCallback(async (article: NewsArticle) => {
    try {
      setArticleLoading(true);
      setFullArticleText(undefined);

      // Check if article already has preloaded full text
      if (article._queueData?.fullText) {
        setFullArticleText(article._queueData.fullText);
        setArticleLoading(false);
        return;
      }

      const response = await fetch(
        `${API_BASE_URL}/article/extract?url=${encodeURIComponent(article.url)}`
      );
      if (response.ok) {
        const data = await response.json(),
         text = data.text || data.full_text || null;
        setFullArticleText(text);

        // Calculate and store read time
        if (text) {
          const readTime = calculateReadTime(text);
          setEstimatedReadTimes((prev) => ({
            ...prev,
            [article.url]: readTime,
          }));
        }
      }
    } catch (error) {
      console.error("Failed to fetch full article:", error);
    } finally {
      setArticleLoading(false);
    }
  }, []),

   selectedArticle =
    selectedArticleUrl && queuedArticles
      ? queuedArticles.find((a) => a.url === selectedArticleUrl)
      : null,
   selectedArticleIndex = selectedArticle
    ? queuedArticles.findIndex((a) => a.url === selectedArticleUrl)
    : -1;

  // Load AI analysis and source when article is selected
  useEffect(() => {
    if (selectedArticle) {
      // Reset all state for the new article
      // Liked state derived from backend
      // Bookmark state derived from backend
      setShowSourceDetails(false);
      setDebugOpen(false);

      // Immediately clear old content
      setAiAnalysisLoading(true);
      setSourceLoading(true);
      setArticleLoading(true);
      setAiAnalysis(undefined);
      setSource(undefined);
      setDebugData(undefined);
      setFullArticleText(undefined);

      // Load article content first (priority)
      loadFullArticle(selectedArticle);

      // Load AI analysis and source in parallel
      loadAiAnalysis(selectedArticle);
      loadSource(selectedArticle);
    }
  }, [loadAiAnalysis, loadFullArticle, loadSource, selectedArticle]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedArticle) {return;}

      if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNavigateArticle("next");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleNavigateArticle("previous");
      } else if (e.key === "m") {
        e.preventDefault();
        handleMarkAsRead(selectedArticle.url);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSelectedArticleUrl(undefined);
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    return () =>{  globalThis.removeEventListener("keydown", handleKeyDown); };
  }, [handleNavigateArticle, queuedArticles, selectedArticle, selectedArticleUrl]);

  const handleOpenDigest = () => {
    setShowQueueOverview(true);
    generateQueueDigest();
  },

   handleToggleDebug = (article: NewsArticle) => {
    setDebugOpen(!debugOpen);
    if (!debugOpen) {loadDebugData(article);}
  };

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
            maxWidth: selectedArticle ? "70vw" : "100%",
            width: selectedArticle ? "70vw" : "540px",
          }}
        >
          {/* Full-screen article detail view */}
          {selectedArticle ? (
            <ArticleDetailView
              article={selectedArticle}
              index={selectedArticleIndex}
              count={queuedArticles.length}
              readTime={estimatedReadTimes[selectedArticle.url]}
              articleLoading={articleLoading}
              fullArticleText={fullArticleText}
              aiAnalysis={aiAnalysis}
              aiAnalysisLoading={aiAnalysisLoading}
              source={source}
              sourceLoading={sourceLoading}
              showSourceDetails={showSourceDetails}
              onToggleSourceDetails={() =>{ 
                setShowSourceDetails(!showSourceDetails); }
              }
              debugOpen={debugOpen}
            onToggleDebug={() =>{  handleToggleDebug(selectedArticle); }}
              debugLoading={debugLoading}
              debugData={debugData}
              isLiked={Boolean(selectedArticle.id) && isLiked(selectedArticle.id)}
              isFavorite={isFavorite(selectedArticle.sourceId)}
              isBookmarked={Boolean(selectedArticle.id) && isBookmarked(selectedArticle.id)}
              isRead={readArticles.has(selectedArticle.url)}
              onPrevious={() =>{  handleNavigateArticle("previous"); }}
              onNext={() =>{  handleNavigateArticle("next"); }}
              onClose={() =>{  setSelectedArticleUrl(undefined); }}
              onLike={() => {
                if (selectedArticle.id) {toggleLike(selectedArticle.id);}
              }}
              onFavorite={() =>{  toggleFavorite(selectedArticle.sourceId); }}
              onBookmark={() => {
                if (selectedArticle.id) {toggleBookmark(selectedArticle.id);}
              }}
              onMarkRead={() =>{  handleMarkAsRead(selectedArticle.url); }}
              onRemove={() => {
                handleRemove(selectedArticle.url);
                setSelectedArticleUrl(undefined);
              }}
            />
          ) : (showQueueOverview ? (
            /* Queue Digest View */
            <QueueDigestView
              articleCount={queuedArticles.length}
              digestLoading={digestLoading}
              queueDigest={queueDigest}
              embedModalArticle={embedModalArticle}
              embedModalOpen={embedModalOpen}
              onClose={() =>{  setShowQueueOverview(false); }}
              onOpenArticle={(article) => {
                setEmbedModalArticle(article);
                setEmbedModalOpen(true);
              }}
              onEmbedClose={() =>{  setEmbedModalOpen(false); }}
              onNavigateArticle={handleNavigateArticle}
            />
          ) : (
            /* List View */
            <>
              <SheetHeader
                className="px-4 pt-5 pb-4 border-b sm:px-6 sm:pt-6"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <SheetTitle className="min-w-0 flex-1 truncate text-3xl font-bold font-serif sm:text-4xl">
                    Articles to Read
                  </SheetTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleOpenDigest}
                      disabled={queuedArticles.length === 0}
                      title="Generate a digest of all articles"
                      className="hidden sm:inline-flex"
                    >
                      <Sparkles className="h-4 w-4 mr-1" />
                      Reading digest
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={handleOpenDigest}
                      disabled={queuedArticles.length === 0}
                      title="Generate a digest of all articles"
                      className="h-9 w-9 sm:hidden"
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                    <span
                      className="text-sm font-medium px-3 py-1 rounded-full"
                      style={{
                        backgroundColor: "var(--primary)",
                        color: "var(--primary-foreground)",
                      }}
                    >
                      {queuedArticles.length}
                    </span>
                    <SheetClose asChild>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-9 w-9 rounded-full"
                        title="Close reading queue"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </SheetClose>
                  </div>
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto flex flex-col px-4 py-5 sm:px-6 sm:py-6">
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
                    {queuedArticles.map((article, index) => (
                      <QueueCard
                        key={`${article.url}-${index}`}
                        article={article}
                        index={index}
                        isExpanded={expandedIndex === index}
                        estimatedReadTime={estimatedReadTimes[article.url]}
                        readingHistoryIds={readingHistoryIds}
                        onToggle={() =>{ 
                          setExpandedIndex(expandedIndex === index ? null : index); }
                        }
                        onOpen={() =>{  setSelectedArticleUrl(article.url); }}
                        onRemove={() =>{  handleRemove(article.url); }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ))}
        </SheetContent>
      </Sheet>
    </>
  );
}
