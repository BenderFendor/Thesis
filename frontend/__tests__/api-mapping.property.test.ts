import { describe, expect, it, jest } from '@jest/globals';
import { fetchSources, mapBackendArticles, removeDuplicateArticles } from '@/lib/api';
import type { ReadonlyBackendArticle } from '@/lib/api';
import fc from "fast-check";

interface SourcePayload {
  readonly bias_rating: string;
  readonly category: string;
  readonly country: string;
  readonly factual_rating: string;
  readonly funding_type: string;
  readonly is_paywalled: boolean;
  readonly name: string;
  readonly ownership_label: string;
  readonly source_type: string;
  readonly url: string;
}

interface SourceResponse {
  readonly json: () => Promise<readonly SourcePayload[]>;
  readonly ok: boolean;
  readonly status: number;
}

const articleStringArb = fc.string({ maxLength: 120 }),
 dateValueArb = fc
  .integer({
    max: Date.parse("2100-12-31T23:59:59.999Z"),
    min: Date.parse("2000-01-01T00:00:00.000Z"),
  })
  .map((timestampMs) => new Date(timestampMs).toISOString()),

 recordArticleArb: fc.Arbitrary<ReadonlyBackendArticle> = fc.record({
  article_id: fc.option(fc.integer({ max: 1_000_000, min: 1 }), {
    nil: undefined,
  }),
  article_url: fc.option(articleStringArb, { nil: undefined }),
  author: fc.option(articleStringArb, { nil: undefined }),
  authors: fc.option(fc.array(articleStringArb, { maxLength: 3 }), {
    nil: undefined,
  }),
  bias: fc.option(articleStringArb, { nil: undefined }),
  category: fc.option(articleStringArb, { nil: undefined }),
  content: fc.option(articleStringArb, { nil: undefined }),
  country: fc.option(articleStringArb, { nil: undefined }),
  credibility: fc.option(articleStringArb, { nil: undefined }),
  description: fc.option(articleStringArb, { nil: undefined }),
  id: fc.option(fc.integer({ max: 1_000_000, min: 1 }), { nil: undefined }),
  image: fc.option(articleStringArb, { nil: undefined }),
  image_url: fc.option(articleStringArb, { nil: undefined }),
  is_persisted: fc.option(fc.boolean(), { nil: undefined }),
  link: fc.option(articleStringArb, { nil: undefined }),
  original_language: fc.option(fc.string({ maxLength: 5, minLength: 2 }), {
    nil: undefined,
  }),
  original_url: fc.option(articleStringArb, { nil: undefined }),
  published: fc.option(dateValueArb, { nil: undefined }),
  publishedAt: fc.option(dateValueArb, { nil: undefined }),
  published_at: fc.option(dateValueArb, { nil: undefined }),
  source: fc.option(articleStringArb, { nil: undefined }),
  source_id: fc.option(articleStringArb, { nil: undefined }),
  source_name: fc.option(articleStringArb, { nil: undefined }),
  summary: fc.option(articleStringArb, { nil: undefined }),
  title: fc.option(articleStringArb, { nil: undefined }),
  translated: fc.option(fc.boolean(), { nil: undefined }),
  url: fc.option(articleStringArb, { nil: undefined }),
}),

 // SAFETY: fetchSources only reads ok, status, and json from this response boundary.
 sourceResponse: SourceResponse = {
   json: () => Promise.resolve([
     {
       bias_rating: "left-leaning",
       category: "world",
       country: "GB",
       factual_rating: "high",
       funding_type: "public",
       is_paywalled: true,
       name: "Example News",
       ownership_label: "Example Trust",
       source_type: "newspaper",
       url: "https://example.com",
     },
   ]),
   ok: true,
   status: 200,
 };

describe("api image mapping property", () => {
  it("maps explicit none image marker to placeholder", () => {expect.hasAssertions();
    const checkResult = fc.check(
      fc.property(recordArticleArb, (article: ReadonlyBackendArticle) => {
        const [mapped] = mapBackendArticles([
          { ...article, image: "none", image_url: undefined },
        ]);
        expect(mapped).toStrictEqual(expect.objectContaining({ image: "/placeholder.svg" }));
      }),
    );
    expect(checkResult.failed).toBe(false);
  });
});

describe("api deduplication property", () => {
  it("deduplicates by title-source key", () => {expect.hasAssertions();
    const checkResult = fc.check(
      fc.property(
        fc.array(recordArticleArb, { maxLength: 40, minLength: 1 }),
        (backendArticles: readonly ReadonlyBackendArticle[]) => {
          const articleKeys = new Set<string>(),
            sourceArticles = mapBackendArticles(backendArticles),
            uniqueArticles = removeDuplicateArticles(sourceArticles);

          expect(uniqueArticles.length).toBeLessThanOrEqual(sourceArticles.length);

          for (const article of uniqueArticles) {
            articleKeys.add(`${article.title}-${article.source}`);
          }
          expect(articleKeys.size).toStrictEqual(uniqueArticles.length);
        },
      ),
    );
    expect(checkResult.failed).toBe(false);
  });
});

describe("api persistence property", () => {
  it("keeps rows without backend ids non-persisted even when a stable fallback id is synthesized", () => {expect.hasAssertions();
    const checkResult = fc.check(
      fc.property(recordArticleArb, (article: ReadonlyBackendArticle) => {
        const [mapped] = mapBackendArticles([
          {
            ...article,
            article_id: undefined,
            id: undefined,
            is_persisted: false,
          },
        ]);

          expect(mapped).toStrictEqual(expect.objectContaining({
            id: expect.any(Number),
            isPersisted: false,
          }));
      }),
    );
    expect(checkResult.failed).toBe(false);
  });
});

describe("api source contract", () => {
  const originalFetch = globalThis.fetch;

  it("maps source metadata into the UI source contract", async () => { expect.hasAssertions();
      const fetchMock = jest.fn<(url: string) => Promise<SourceResponse>>().mockResolvedValue(sourceResponse);
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
    try {
      await expect(fetchSources()).resolves.toStrictEqual([
        {
          bias: "left",
          category: ["world"],
          country: "GB",
          credibility: "high",
          credibilityScore: undefined,
          factualRating: "high",
          funding: ["public"],
          id: "example-news",
          isPaywalled: true,
          language: "en",
          name: "Example News",
          rssUrl: "https://example.com",
          slug: "example-news",
          sourceType: "newspaper",
          url: "https://example.com",
        },
      ]);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
        writable: true,
      });
    }
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/news/sources"));
  });
});
