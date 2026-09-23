import { API_BASE_URL } from "@/lib/api";
import type { NewsArticle } from "@/lib/api";
import type { ReadonlyNewsArticle } from "@/app/search/research/model/types";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { assignRef, clearFlushTimer } from "./use-news-stream-core";
import type {
  StateSetter,
  StreamRunContext,
} from "./use-news-stream-core";

interface ImageUpdate {
  readonly article_url: string;
  readonly image_url: string;
  readonly type: "image_update";
}

interface MessageDataEvent {
  readonly data: unknown;
}

const HTTP_PROTOCOL_PATTERN = /^http/u;
const IMAGE_UPDATE_SCHEMA = z.object({
  article_url: z.string(),
  image_url: z.string(),
  type: z.literal("image_update"),
});
const WEBSOCKET_PATH = "/ws";

const parseImageUpdate = (rawData: string): ImageUpdate | undefined => {
    try {
      const parsed = IMAGE_UPDATE_SCHEMA.safeParse(JSON.parse(rawData));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      return void 0;
    }
    return void 0;
  };
const updateArticleImage = (
    article: ReadonlyNewsArticle,
    update: Readonly<ImageUpdate>,
  ): NewsArticle => {
    if (article.url === update.article_url) {
      return { ...article, image: update.image_url };
    }
    return article;
  };
const handleImageUpdate = (event: MessageDataEvent, setArticles: StateSetter<NewsArticle[]>): void => {
    const stringData = z.string().safeParse(event.data);
    if (!stringData.success) {
      return;
    }
    const update = parseImageUpdate(stringData.data);
    if (update === undefined) {
      return;
    }
    setArticles((previous: readonly NewsArticle[]) =>
      previous.map((article) => updateArticleImage(article, update)),
    );
  };
const buildWebSocketUrl = (): string =>
    `${API_BASE_URL.replace(HTTP_PROTOCOL_PATTERN, "ws")}${WEBSOCKET_PATH}`;
const cleanupStreamOnUnmount = (
    context: Readonly<
      Pick<
        StreamRunContext,
        "abortControllerRef" | "flushTimerRef" | "isMountedRef" | "isStreamingRef"
      >
    >,
  ): void => {
    clearFlushTimer(context.flushTimerRef);
    const controller = context.abortControllerRef.current;
    if (context.isStreamingRef.current && controller !== undefined) {
      logger.debug("Component unmounting, aborting stream");
      controller.abort();
    }
    assignRef(context.isMountedRef, false);
  };

export { buildWebSocketUrl, cleanupStreamOnUnmount, handleImageUpdate };
