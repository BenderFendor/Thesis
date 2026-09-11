import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { InlineArticleCard } from "@/app/search/inline-article-card";
import { buildArticleUrlMap, cleanEmbeddedContent } from "../model/articles";
import type { ReadonlyNewsArticle } from "../model/types";

type MarkdownChangeEvent = Readonly<{
  target: Readonly<{ value: string }>;
}>;

type MarkdownKeyDownEvent = Readonly<{
  key: string;
  preventDefault: () => void;
  shiftKey: boolean;
}>;

type MarkdownSubmitEvent = Readonly<{
  preventDefault: () => void;
}>;

interface EmbeddedContentProps {
  readonly articles: readonly ReadonlyNewsArticle[];
  readonly content: string;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

const MARKDOWN_PLUGINS = [remarkGfm];

const resolveEmbeddedArticle = (
  href: string | undefined,
  articleMap: ReadonlyMap<string, ReadonlyNewsArticle>,
): ReadonlyNewsArticle | undefined => {
  if (href === undefined) {
    return void 0;
  }
  return articleMap.get(href) ?? articleMap.get(href.replace(/\/$/u, ""));
};

const createEmbeddedMarkdownComponents = (
  articleMap: ReadonlyMap<string, ReadonlyNewsArticle>,
  handleOpenArticle: (article: ReadonlyNewsArticle) => void,
) : Components => ({
  "a": ({ href, children }) => {
    const article = resolveEmbeddedArticle(href, articleMap);
    if (article === undefined) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary decoration-primary/30 underline-offset-2 hover:underline"
        >
          {children}
        </a>
      );
    }
    return <InlineArticleCard article={article} handleOpenArticle={handleOpenArticle} />;
  },
  h1: ({ children }) => (
    <h1 className="mb-3 mt-6 text-xl font-semibold text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 text-lg font-semibold text-foreground">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-medium text-foreground">{children}</h3>
  ),
  li: ({ children }) => <li className="text-foreground/80">{children}</li>,
  "p": ({ children }) => (
    <p className="mb-4 leading-7 text-foreground/80">{children}</p>
  ),
  strong: ({ children }) => (
    <span className="font-semibold text-foreground">{children}</span>
  ),
  ul: ({ children }) => <ul className="my-3 space-y-1">{children}</ul>,
});

const EmbeddedMarkdown = (props: Readonly<EmbeddedContentProps>) => {
  const { articles, content, onOpenArticle } = props;
  const articleMap = useMemo(() => buildArticleUrlMap(articles), [articles]);
  const components = useMemo(
    () => createEmbeddedMarkdownComponents(articleMap, onOpenArticle),
    [articleMap, onOpenArticle],
  );
  return (
    <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS} components={components}>
      {content}
    </ReactMarkdown>
  );
};

const EmbeddedContent = ({ articles, content, onOpenArticle }: Readonly<EmbeddedContentProps>) => (
  <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-transparent prose-pre:p-0">
    <EmbeddedMarkdown
      articles={articles}
      content={cleanEmbeddedContent(content)}
      onOpenArticle={onOpenArticle}
    />
  </div>
);

export type { MarkdownChangeEvent, MarkdownKeyDownEvent, MarkdownSubmitEvent };
export { EmbeddedContent };
