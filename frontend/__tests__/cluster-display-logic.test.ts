import fc from "fast-check";
import {
  clusterArticlesToNewsArticles,
  filterTrendingClusters,
  getClusterPreviewStats,
  pickClusterImageUrl,
} from "@/lib/cluster-display";
import type { BreakingCluster, TrendingArticle, TrendingCluster } from "@/lib/api";

describe("cluster display logic", () => {
  it("removes trending clusters that already appear in breaking", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
          minLength: 1,
          maxLength: 20,
        }),
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
          minLength: 1,
          maxLength: 20,
        }),
        (trendingIds, breakingIds) => {
          const trending: TrendingCluster[] = trendingIds.map((cluster_id) => ({
            cluster_id,
            label: null,
            keywords: [],
            article_count: 1,
            window_count: 1,
            source_diversity: 1,
            trending_score: 1,
            velocity: 1,
            representative_article: null,
            articles: [],
          }));
          const breaking: BreakingCluster[] = breakingIds.map((cluster_id) => ({
            cluster_id,
            label: null,
            keywords: [],
            article_count_3h: 1,
            source_count_3h: 1,
            spike_magnitude: 1,
            is_new_story: true,
            representative_article: null,
            articles: [],
          }));

          const filtered = filterTrendingClusters(trending, breaking);
          const filteredIds = new Set(filtered.map((cluster) => cluster.cluster_id));

          for (const clusterId of breakingIds) {
            expect(filteredIds.has(clusterId)).toBe(false);
          }
        },
      ),
    );
  });

  it("preserves snapshot article summary and image values when expanding a cluster", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (ids) => {
          const articles: TrendingArticle[] = ids.map((id, index) => ({
            id,
            title: `Title ${id}`,
            source: `Source ${index}`,
            url: `https://example.com/${id}`,
            image_url: index % 2 === 0 ? null : `https://img.example.com/${id}.jpg`,
            published_at: index % 2 === 0 ? undefined : "2026-03-06T12:00:00.000Z",
            summary: index % 2 === 0 ? null : `Summary ${id}`,
          }));

          const mapped = clusterArticlesToNewsArticles(articles);

          expect(mapped).toHaveLength(articles.length);
          mapped.forEach((article, index) => {
            expect(article.title).toBe(articles[index].title);
            expect(article.url).toBe(articles[index].url);
            expect(article.summary).toBe(articles[index].summary || "");
            expect(article.image).toBe(articles[index].image_url || "");
          });
        },
      ),
    );
  });

  it("falls back to another cluster article image when the representative has none", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (id) => {
        const imageUrl = `https://img.example.com/${id}.jpg`;

        expect(
          pickClusterImageUrl({
            representative_article: {
              id,
              title: "Representative",
              source: "Source A",
              url: `https://example.com/${id}`,
              image_url: null,
            },
            articles: [
              {
                id,
                title: "Representative",
                source: "Source A",
                url: `https://example.com/${id}`,
                image_url: null,
              },
              {
                id: id + 1,
                title: "With image",
                source: "Source B",
                url: `https://example.com/${id + 1}`,
                image_url: imageUrl,
              },
            ],
          }),
        ).toBe(imageUrl);
      }),
    );
  });

  it("derives topic card counts from the preview articles shown to the user", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), {
          minLength: 2,
          maxLength: 5,
        }),
        (ids) => {
          const previewArticles = ids.map((id, index) => ({
            id,
            title: `Title ${id}`,
            source: `Source ${index % 2}`,
            url: `https://example.com/${id}`,
          }));

          const stats = getClusterPreviewStats({
            article_count: 999,
            source_diversity: 888,
            representative_article: null,
            articles: previewArticles,
          });

          expect(stats.articleCount).toBe(previewArticles.length);
          expect(stats.sourceCount).toBe(new Set(previewArticles.map((a) => a.source)).size);
        },
      ),
    );
  });
});
