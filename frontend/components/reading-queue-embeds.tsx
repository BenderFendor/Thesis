"use client";

import type { FunctionComponent, ReactElement, ReactNode } from "react";
import { ArticleInlineEmbed } from "@/components/article-inline-embed";
import type { NewsArticle } from "@/lib/api";
import { z } from "zod";

const StructuredArticleSchema = z.object({
  link: z.string().optional(),
  url: z.string().optional(),
});

const StructuredArticlesResponseSchema = z.object({
  articles: z.array(StructuredArticleSchema).optional(),
});
const MarkdownCodeTextSchema = z.string();

type StructuredArticle = z.infer<typeof StructuredArticleSchema>;

const CODE_STYLE = {
  backgroundColor: "rgba(0, 0, 0, 0.3)",
  color: "rgb(168, 85, 247)",
};

const getStructuredArticleUrl = (article: StructuredArticle, index: number): string => {
  if (article.url !== undefined && article.url !== "") {
    return article.url;
  }
  if (article.link !== undefined && article.link !== "") {
    return article.link;
  }
  return `about:blank#${index}`;
};

const parseStructuredArticles = (text: string): readonly StructuredArticle[] => {
  try {
    const parsed: unknown = JSON.parse(text);
    const result = StructuredArticlesResponseSchema.safeParse(parsed);
    if (result.success) {
      return result.data.articles ?? [];
    }
    return [];
  } catch (error) {
    console.error("Failed to parse structured articles JSON:", error);
    return [];
  }
};

const isStructuredDigestCode = (className: string | undefined, text: string): boolean => {
  if (className === "language-json:articles") {
    return true;
  }
  const trimmedText = text.trim();
  return trimmedText.startsWith("{") && trimmedText.includes('"articles"');
};

interface DigestCodeRendererProps {
  readonly className?: string;
  readonly children?: ReactNode;
  readonly onOpenArticle: (article: NewsArticle) => void;
}

const StructuredArticleEmbeds = ({
  onOpenArticle,
  text,
}: Readonly<{
  readonly text: string;
  readonly onOpenArticle: (article: NewsArticle) => void;
}>): ReactElement => {
  const articles = parseStructuredArticles(text);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-3">
      {articles.map((article, index) => {
        const url = getStructuredArticleUrl(article, index);
        return <ArticleInlineEmbed key={url} url={url} onOpen={onOpenArticle} />;
      })}
    </div>
  );
};

export const DigestCodeRenderer: FunctionComponent<DigestCodeRendererProps> = ({
  children,
  className,
  onOpenArticle,
}) => {
  const parsedText = MarkdownCodeTextSchema.safeParse(children);
  let text = "";
  if (parsedText.success) {
    text = parsedText.data.replace(/\n$/u, "");
  }
  if (isStructuredDigestCode(className, text)) {
    return <StructuredArticleEmbeds text={text} onOpenArticle={onOpenArticle} />;
  }
  return (
    <code className="px-2 py-1 rounded text-sm" style={CODE_STYLE}>
      {text}
    </code>
  );
};
