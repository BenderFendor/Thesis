// OG image fetch with TTL cache and in-flight dedupe.

import { api } from "./client";

const SUCCESS_TTL_MS = 10 * 60 * 1000;
const MISS_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;

const ogImageCache = new Map<string, { imageUrl: string | null; expiresAt: number }>();
const ogImageInFlight = new Map<string, Promise<string | null>>();

function cacheOgImage(
  url: string,
  imageUrl: string | null,
  ttlMs: number,
): string | null {
  ogImageCache.set(url, { expiresAt: Date.now() + ttlMs, imageUrl });
  if (ogImageCache.size > MAX_CACHE_ENTRIES) {
    const oldest = ogImageCache.keys().next().value;
    if (oldest !== undefined) {
      ogImageCache.delete(oldest);
    }
  }
  return imageUrl;
}

export async function fetchOGImage(url: string): Promise<string | null> {
  const now = Date.now();
  const cached = ogImageCache.get(url);
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.imageUrl;
  }
  ogImageCache.delete(url);

  const inFlight = ogImageInFlight.get(url);
  if (inFlight !== undefined) {
    return inFlight;
  }

  const pending = api<{ image_url: string | null }>(
    `/image/og?${new URLSearchParams({ url })}`,
  )
    .then((result) => cacheOgImage(url, result.image_url, SUCCESS_TTL_MS))
    .catch(() => {
      try {
        return cacheOgImage(url, null, MISS_TTL_MS);
      } catch {
        return null;
      }
    })
    .finally(() => {
      ogImageInFlight.delete(url);
    });
  ogImageInFlight.set(url, pending);
  return pending;
}
