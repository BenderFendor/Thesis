"use client";
import { hasText } from "@/lib/utils";

import type { ArticleAnalysis, NewsArticle } from "@/lib/api";
import { ExternalLink, ImageOff } from "lucide-react";
import { analyzeArticle, mapBackendArticle } from "@/lib/api";
import { SafeImage } from "@/components/safe-image";
import type { DeepReadonly } from "@/lib/deep-readonly";
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const EMBED_LOADING_STYLE = {
  backgroundColor: "var(--news-bg-secondary)",
  borderColor: "var(--border)",
} as const;
const EMBED_BUTTON_STYLE = { borderColor: "#18181b" } as const;
const EMBED_ICON_STYLE = { color: "#7dd3fc" } as const;

interface ArticleInlineEmbedProps {
  readonly url: string;
  readonly onOpen: (article: NewsArticle) => void;
  readonly services?: ArticleInlineEmbedServices;
}
interface ArticleInlineEmbedServices {
  readonly analyzeArticle: typeof analyzeArticle;
}

const DEFAULT_ARTICLE_INLINE_EMBED_SERVICES: ArticleInlineEmbedServices = {
  analyzeArticle,
};

const toSourceName = (url: string): string => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname.replace("www.", "");
  } catch {
    return "unknown";
  }
};

const buildNewsArticle = (url: string, analysis?: DeepReadonly<ArticleAnalysis>): NewsArticle => {
  const source = articleSource(analysis, url),
    summary = articleSummary(analysis),
    title = articleTitle(analysis, url);
  return mapBackendArticle({
    category: "general",
    content: articleContent(analysis),
    country: "United States",
    credibility: "medium",
    image_url: null,
    original_language: "en",
    published_at: analysis?.publish_date ?? new Date().toISOString(),
    source,
    summary: summary || "",
    title: title || "Untitled",
    translated: false,
    url,
  });
};

function articleTitle(analysis: DeepReadonly<ArticleAnalysis> | undefined, url: string): string {
  const title = analysis?.title ?? analysis?.summary?.slice(0, 120);
  if (title === undefined || title === "") {
    return toSourceName(url);
  }
  return title;
}

function articleSummary(analysis: DeepReadonly<ArticleAnalysis> | undefined): string {
  return (
    analysis?.summary ??
    (() => {
      if (hasText(analysis?.full_text)) {
        return `${analysis.full_text.slice(0, 220)}…`;
      }
      return "";
    })()
  );
}

function articleSource(analysis: DeepReadonly<ArticleAnalysis> | undefined, url: string): string {
  return analysis?.source_analysis?.ownership ?? toSourceName(url);
}

function articleContent(analysis: DeepReadonly<ArticleAnalysis> | undefined): string | undefined {
  return analysis?.full_text ?? analysis?.summary;
}

const truncateText = (value: string, maxLength: number): string => {
  if (value.length > maxLength) {
    return `${value.slice(0, maxLength)}...`;
  }
  return value;
};

interface ArticleInlinePreviewImageProps {
  readonly hasPreviewImage: boolean;
}

const ArticleInlinePreviewImage = ({ hasPreviewImage }: ArticleInlinePreviewImageProps) => {
  if (hasPreviewImage) {
    return (
      <SafeImage
        src="/placeholder.svg"
        alt="preview"
        width={96}
        height={64}
        className="w-full h-full object-cover opacity-80"
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center text-zinc-700">
      <ImageOff className="w-5 h-5" />
    </div>
  );
};

interface ArticleInlinePreviewProps {
  readonly article: NewsArticle;
  readonly hasPreviewImage: boolean;
  readonly onOpen: () => void;
}

const ArticleInlinePreview = ({ article, hasPreviewImage, onOpen }: ArticleInlinePreviewProps) => (
  <button
    onClick={onOpen}
    className="rounded-xl p-4 flex gap-4 items-center text-left hover:border-primary transition-all w-full shadow-lg border border-zinc-800 bg-gradient-to-br from-black via-zinc-900 to-zinc-950"
    style={EMBED_BUTTON_STYLE}
  >
    <div className="h-16 w-24 overflow-hidden rounded-lg bg-zinc-950 border border-zinc-900 flex-shrink-0">
      <ArticleInlinePreviewImage hasPreviewImage={hasPreviewImage} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-sm font-semibold text-slate-50 line-clamp-2">
        {truncateText(article.title, 100)}
      </div>
      <div className="text-xs mt-1 truncate text-slate-400">{article.source}</div>
      {article.summary && (
        <div className="text-xs mt-1 line-clamp-2 text-slate-400">
          {truncateText(article.summary, 120)}
        </div>
      )}
    </div>
    <ExternalLink className="w-4 h-4" style={EMBED_ICON_STYLE} />
  </button>
);

export const ArticleInlineEmbed = ({
  url,
  onOpen,
  services = DEFAULT_ARTICLE_INLINE_EMBED_SERVICES,
}: ArticleInlineEmbedProps) => {
  const { data: analysis, isLoading: loading } = useQuery<ArticleAnalysis | null>({
      queryFn: async () => {
        try {
          return await services.analyzeArticle(url);
        } catch {
          return null;
        }
      },
      queryKey: ["article-inline-embed", url],
      retry: 1,
    }),
    article = useMemo(() => buildNewsArticle(url, analysis ?? undefined), [url, analysis]),
    handleOpen = useCallback(() => {
      onOpen(article);
    }, [article, onOpen]);

  if (loading) {
    return (
      <div className="border rounded-lg p-3 flex gap-3 items-center" style={EMBED_LOADING_STYLE}>
        <div className="h-16 w-24 rounded-md bg-gray-800 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 bg-gray-800 rounded animate-pulse" />
          <div className="h-3 w-1/2 bg-gray-800 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <ArticleInlinePreview
      article={article}
      hasPreviewImage={(analysis?.grounding_metadata?.grounding_chunks?.length ?? 0) > 0}
      onOpen={handleOpen}
    />
  );
};
