import fc from "fast-check";
import {
  mapBackendArticles,
  removeDuplicateArticles,
  type BackendArticle,
} from "@/lib/api";

const shortStringArb = fc.string({ maxLength: 120 });
const isoDateArb = fc
  .integer({
    min: Date.parse("2000-01-01T00:00:00.000Z"),
    max: Date.parse("2100-12-31T23:59:59.999Z"),
  })
  .map((timestampMs) => new Date(timestampMs).toISOString());

const backendArticleArb: fc.Arbitrary<BackendArticle> = fc.record({
  id: fc.option(fc.integer({ min: 1, max: 1_000_000 }), { nil: undefined }),
  article_id: fc.option(fc.integer({ min: 1, max: 1_000_000 }), {
    nil: undefined,
  }),
  title: fc.option(shortStringArb, { nil: undefined }),
  source: fc.option(shortStringArb, { nil: undefined }),
  source_name: fc.option(shortStringArb, { nil: undefined }),
  source_id: fc.option(shortStringArb, { nil: undefined }),
  description: fc.option(shortStringArb, { nil: undefined }),
  summary: fc.option(shortStringArb, { nil: undefined }),
  content: fc.option(shortStringArb, { nil: undefined }),
  image: fc.option(shortStringArb, { nil: undefined }),
  image_url: fc.option(shortStringArb, { nil: undefined }),
  published_at: fc.option(isoDateArb, { nil: undefined }),
  publishedAt: fc.option(isoDateArb, { nil: undefined }),
  published: fc.option(isoDateArb, { nil: undefined }),
  category: fc.option(shortStringArb, { nil: undefined }),
  country: fc.option(shortStringArb, { nil: undefined }),
  credibility: fc.option(shortStringArb, { nil: undefined }),
  bias: fc.option(shortStringArb, { nil: undefined }),
  url: fc.option(shortStringArb, { nil: undefined }),
  link: fc.option(shortStringArb, { nil: undefined }),
  article_url: fc.option(shortStringArb, { nil: undefined }),
  original_url: fc.option(shortStringArb, { nil: undefined }),
  author: fc.option(shortStringArb, { nil: undefined }),
  authors: fc.option(fc.array(shortStringArb, { maxLength: 3 }), {
    nil: undefined,
  }),
  original_language: fc.option(fc.string({ minLength: 2, maxLength: 5 }), {
    nil: undefined,
  }),
  translated: fc.option(fc.boolean(), { nil: undefined }),
});

describe("api mapping property tests", () => {
  it("maps explicit none image marker to placeholder", () => {
    fc.assert(
      fc.property(backendArticleArb, (article) => {
        const [mapped] = mapBackendArticles([
          { ...article, image: "none", image_url: undefined },
        ]);
        expect(mapped.image).toBe("/placeholder.svg");
      }),
    );
  });

  it("deduplicates by title-source key", () => {
    fc.assert(
      fc.property(
        fc.array(backendArticleArb, { minLength: 1, maxLength: 40 }),
        (backendArticles) => {
          const mapped = mapBackendArticles(backendArticles);
          const deduped = removeDuplicateArticles(mapped);

          expect(deduped.length).toBeLessThanOrEqual(mapped.length);

          const keys = deduped.map((article) => `${article.title}-${article.source}`);
          expect(new Set(keys).size).toBe(keys.length);
        },
      ),
    );
  });
});
