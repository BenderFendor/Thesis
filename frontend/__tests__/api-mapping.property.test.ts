import { describe, expect, it } from '@jest/globals';
import fc from "fast-check";
import { mapBackendArticles, removeDuplicateArticles } from '@/lib/api';
import type { BackendArticle } from '@/lib/api';

const shortStringArb = fc.string({ maxLength: 120 }),
 isoDateArb = fc
  .integer({
    max: Date.parse("2100-12-31T23:59:59.999Z"),
    min: Date.parse("2000-01-01T00:00:00.000Z"),
  })
  .map((timestampMs) => new Date(timestampMs).toISOString()),

 backendArticleArb: fc.Arbitrary<BackendArticle> = fc.record({
  article_id: fc.option(fc.integer({ max: 1_000_000, min: 1 }), {
    nil: undefined,
  }),
  article_url: fc.option(shortStringArb, { nil: undefined }),
  author: fc.option(shortStringArb, { nil: undefined }),
  authors: fc.option(fc.array(shortStringArb, { maxLength: 3 }), {
    nil: undefined,
  }),
  bias: fc.option(shortStringArb, { nil: undefined }),
  category: fc.option(shortStringArb, { nil: undefined }),
  content: fc.option(shortStringArb, { nil: undefined }),
  country: fc.option(shortStringArb, { nil: undefined }),
  credibility: fc.option(shortStringArb, { nil: undefined }),
  description: fc.option(shortStringArb, { nil: undefined }),
  id: fc.option(fc.integer({ max: 1_000_000, min: 1 }), { nil: undefined }),
  image: fc.option(shortStringArb, { nil: undefined }),
  image_url: fc.option(shortStringArb, { nil: undefined }),
  is_persisted: fc.option(fc.boolean(), { nil: undefined }),
  link: fc.option(shortStringArb, { nil: undefined }),
  original_language: fc.option(fc.string({ maxLength: 5, minLength: 2 }), {
    nil: undefined,
  }),
  original_url: fc.option(shortStringArb, { nil: undefined }),
  published: fc.option(isoDateArb, { nil: undefined }),
  publishedAt: fc.option(isoDateArb, { nil: undefined }),
  published_at: fc.option(isoDateArb, { nil: undefined }),
  source: fc.option(shortStringArb, { nil: undefined }),
  source_id: fc.option(shortStringArb, { nil: undefined }),
  source_name: fc.option(shortStringArb, { nil: undefined }),
  summary: fc.option(shortStringArb, { nil: undefined }),
  title: fc.option(shortStringArb, { nil: undefined }),
  translated: fc.option(fc.boolean(), { nil: undefined }),
  url: fc.option(shortStringArb, { nil: undefined }),
});

describe("api mapping property tests", () => {
  it("maps explicit none image marker to placeholder", () => {expect.hasAssertions();
    fc.assert(
      fc.property(backendArticleArb, (article) => {
        const [mapped] = mapBackendArticles([
          { ...article, image: "none", image_url: undefined },
        ]);
        expect(mapped!.image).toBe("/placeholder.svg");
      }),
    );
  });

  it("deduplicates by title-source key", () => {expect.hasAssertions();
    fc.assert(
      fc.property(
        fc.array(backendArticleArb, { maxLength: 40, minLength: 1 }),
        (backendArticles) => {
          const mapped = mapBackendArticles(backendArticles),
           deduped = removeDuplicateArticles(mapped);

          expect(deduped.length).toBeLessThanOrEqual(mapped.length);

          const keys = deduped.map((article) => `${article.title}-${article.source}`);
          expect(new Set(keys).size).toBe(keys.length);
        },
      ),
    );
  });

  it("keeps rows without backend ids non-persisted even when a stable fallback id is synthesized", () => {expect.hasAssertions();
    fc.assert(
      fc.property(backendArticleArb, (article) => {
        const [mapped] = mapBackendArticles([
          {
            ...article,
            article_id: undefined,
            id: undefined,
            is_persisted: false,
          },
        ]);

        expect(mapped!.id).toStrictEqual(expect.any(Number));
        expect(mapped!.isPersisted).toBe(false);
      }),
    );
  });
});
