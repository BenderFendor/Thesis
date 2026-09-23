"use client";

import { useCallback, useState } from "react";
import type { NewsArticle } from "@/lib/api";

interface ArticleDetailController {
  readonly article: NewsArticle | null;
  readonly close: () => void;
  readonly isOpen: boolean;
  readonly open: (article: Readonly<NewsArticle>) => void;
}

const useArticleDetail = (): ArticleDetailController => {
  const [article, setArticle] = useState<NewsArticle | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback((nextArticle: Readonly<NewsArticle>) => {
    setArticle(nextArticle);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
    setArticle(null);
  }, []);

  return { article, close, isOpen, open };
};

export { useArticleDetail };
