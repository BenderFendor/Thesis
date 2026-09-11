import type { BreakingCluster, TrendingCluster } from "@/lib/api";
import { describe, expect, it } from "@jest/globals";
import {
  filterTrendingClusters,
  getClusterPreviewStats,
  pickClusterImageUrl,
} from "@/lib/cluster-display";
import fc from "fast-check";

const clusterIdsArbitrary = fc.uniqueArray(fc.integer({ max: 10_000, min: 1 }), {
  maxLength: 20,
  minLength: 1,
});
const previewIdsArbitrary = fc.uniqueArray(fc.integer({ max: 1_000_000, min: 1 }), {
  maxLength: 5,
  minLength: 2,
});

describe("cluster display logic", () => {
  it("removes trending clusters that already appear in breaking", () => {
    expect.hasAssertions();

    fc.assert(
      fc.property(
        clusterIdsArbitrary,
        clusterIdsArbitrary,
        (trendingIds, breakingIds) => {
          const trending: TrendingCluster[] = trendingIds.map((cluster_id) => ({
              article_count: 1,
              articles: [],
              cluster_id,
              keywords: [],
              label: null,
              representative_article: null,
              source_diversity: 1,
              trending_score: 1,
              velocity: 1,
              window_count: 1,
            }));
          const breaking: BreakingCluster[] = breakingIds.map((cluster_id) => ({
              article_count_3h: 1,
              articles: [],
              cluster_id,
              is_new_story: true,
              keywords: [],
              label: null,
              representative_article: null,
              source_count_3h: 1,
              spike_magnitude: 1,
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

  it("falls back to another cluster article image when the representative has none", () => {
    expect.hasAssertions();

    fc.assert(
      fc.property(fc.integer({ max: 1_000_000, min: 1 }), (id) => {
        const imageUrl = `https://img.example.com/${id}.jpg`;

        expect(
          pickClusterImageUrl({
            articles: [
              {
                id,
                image_url: null,
                source: "Source A",
                title: "Representative",
                url: `https://example.com/${id}`,
              },
              {
                id: id + 1,
                image_url: imageUrl,
                source: "Source B",
                title: "With image",
                url: `https://example.com/${id + 1}`,
              },
            ],
            representative_article: {
              id,
              image_url: null,
              source: "Source A",
              title: "Representative",
              url: `https://example.com/${id}`,
            },
          }),
        ).toBe(imageUrl);
      }),
    );
  });

  it("derives topic card counts from the preview articles shown to the user", () => {
    expect.hasAssertions();

    fc.assert(
      fc.property(
        previewIdsArbitrary,
        (ids) => {
          const previewArticles = ids.map((id, index) => ({
              id,
              source: `Source ${index % 2}`,
              title: `Title ${id}`,
              url: `https://example.com/${id}`,
            })),
            stats = getClusterPreviewStats({
              article_count: 999,
              articles: previewArticles,
              representative_article: null,
              source_diversity: 888,
            });

          expect(stats.articleCount).toBe(previewArticles.length);
          expect(stats.sourceCount).toBe(new Set(previewArticles.map((article) => article.source)).size);
        },
      ),
    );
  });
});
