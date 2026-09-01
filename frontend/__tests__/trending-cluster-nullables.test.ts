import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  fetchAllClusters,
  fetchBreaking,
  fetchClusterDetail,
  fetchTrending,
} from "@/lib/api";

describe("cluster payload nullables", () => {
  const originalFetch = global.fetch,
   gdeltContext = {
    goldstein_avg: -1.8,
    goldstein_bucket: "conflict",
    goldstein_max: 0.8,
    goldstein_min: -4.2,
    tone_avg: -0.7,
    tone_baseline_avg: -0.3,
    tone_delta_vs_cluster: -0.4,
    top_cameo: [
      { code: "14", count: 2, label: "Protest" },
      { code: "05", count: 1, label: "Diplomatic engagement" },
    ],
    total_events: 3,
  };

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  function mockFetchJson(payload: unknown) {
    // SAFETY: These API functions only read `ok` and `json` from the response fixture.
    const response = {
      json: async () => payload,
      ok: true,
    } as Response;
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(response);
  }

  it("parses trending clusters when image_url and summary are undefined", async () => {  expect.hasAssertions();
  
    const payload = {
      clusters: [
        {
          article_count: 2,
          articles: [
            {
              gdelt_context: null,
              id: 11,
              image_url: null,
              published_at: "2026-03-06T12:00:00.000Z",
              source: "Source A",
              summary: null,
              title: "Representative",
              url: "https://example.com/a",
            },
          ],
          cluster_id: 1,
          gdelt_context: null,
          keywords: ["topic"],
          label: "Topic",
          representative_article: {
            gdelt_context: null,
            id: 11,
            image_url: null,
            published_at: "2026-03-06T12:00:00.000Z",
            source: "Source A",
            summary: null,
            title: "Representative",
            url: "https://example.com/a",
          },
          source_diversity: 2,
          trending_score: 1.2,
          velocity: 0.8,
          window_count: 2,
        },
      ],
      total: 1,
      window: "1d",
    };

    mockFetchJson(payload);

    await expect(fetchTrending("1d", 10)).resolves.toStrictEqual(payload);
  });

  it("parses breaking clusters when image_url and summary are undefined", async () => {  expect.hasAssertions();
  
    const payload = {
      clusters: [
        {
          article_count_3h: 4,
          articles: [
            {
              gdelt_context: gdeltContext,
              id: 21,
              image_url: null,
              published_at: "2026-03-06T12:00:00.000Z",
              source: "Source B",
              summary: null,
              title: "Breaking Representative",
              url: "https://example.com/b",
            },
          ],
          cluster_id: 2,
          gdelt_context: gdeltContext,
          is_new_story: true,
          keywords: ["breaking"],
          label: null,
          representative_article: {
            gdelt_context: gdeltContext,
            id: 21,
            image_url: null,
            published_at: "2026-03-06T12:00:00.000Z",
            source: "Source B",
            summary: null,
            title: "Breaking Representative",
            url: "https://example.com/b",
          },
          source_count_3h: 2,
          spike_magnitude: 3.4,
        },
      ],
      total: 1,
      window_hours: 3,
    };

    mockFetchJson(payload);

    await expect(fetchBreaking(5)).resolves.toStrictEqual(payload);
  });

  it("parses all clusters when image_url and summary are undefined", async () => {  expect.hasAssertions();
  
    const payload = {
      clusters: [
        {
          article_count: 3,
          articles: [
            {
              gdelt_context: gdeltContext,
              id: 31,
              image_url: null,
              published_at: "2026-03-06T12:00:00.000Z",
              source: "Source C",
              summary: null,
              title: "Cluster Representative",
              url: "https://example.com/c",
            },
          ],
          cluster_id: 3,
          gdelt_context: gdeltContext,
          keywords: ["all"],
          label: "All clusters topic",
          representative_article: {
            gdelt_context: gdeltContext,
            id: 31,
            image_url: null,
            published_at: "2026-03-06T12:00:00.000Z",
            source: "Source C",
            summary: null,
            title: "Cluster Representative",
            url: "https://example.com/c",
          },
          source_diversity: 2,
          window_count: 3,
        },
      ],
      computed_at: "2026-03-06T12:00:00.000Z",
      status: "ok",
      total: 1,
      window: "1d",
    };

    mockFetchJson(payload);

    await expect(fetchAllClusters("1d", 2, 100)).resolves.toStrictEqual(payload);
  });

  it("parses cluster detail responses with nested gdelt_context", async () => {  expect.hasAssertions();
  
    const payload = {
      article_count: 2,
      articles: [
        {
          author: "Reporter",
          authors: ["Reporter"],
          gdelt_context: null,
          id: 41,
          image_url: null,
          published_at: "2026-03-06T12:00:00.000Z",
          similarity: 1,
          source: "Source D",
          source_id: "source-d",
          summary: null,
          title: "Detail Article",
          url: "https://example.com/d",
        },
      ],
      first_seen: "2026-03-06T11:00:00.000Z",
      gdelt_context: gdeltContext,
      id: 41,
      is_active: true,
      keywords: ["detail"],
      label: "Cluster Detail",
      last_seen: "2026-03-06T12:00:00.000Z",
    };

    mockFetchJson(payload);

    await expect(fetchClusterDetail(41)).resolves.toStrictEqual(payload);
  });
});
