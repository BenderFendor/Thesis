import { API_BASE_URL } from "@/lib/api/client";
import { z } from "zod";

const ARTICLE_CONTENT_RESPONSE_SCHEMA = z.object({
  full_text: z.string().optional(),
  text: z.string().optional(),
});

const articleContentQueryKey = (articleUrl: string) => ["article-full-text", articleUrl] as const;

const fetchArticleContentText = async (
  articleUrl: string,
  signal?: Readonly<AbortSignal>,
): Promise<string | null> => {
  const response = await fetch(
    `${API_BASE_URL}/article/extract?url=${encodeURIComponent(articleUrl)}`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(`Article extraction failed (${response.status})`);
  }
  const payload: unknown = await response.json();
  const parsed = ARTICLE_CONTENT_RESPONSE_SCHEMA.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Article extraction returned an invalid response");
  }
  if (parsed.data.text !== undefined && parsed.data.text !== "") {
    return parsed.data.text;
  }
  return parsed.data.full_text ?? null;
};

export { articleContentQueryKey, fetchArticleContentText };
