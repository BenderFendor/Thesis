import {
  fetchAllClusters,
  fetchBreaking,
  fetchClusterDetail,
  fetchTrending,
} from "@/lib/api";

describe("cluster payload nullables", () => {
  const originalFetch = global.fetch;
  const gdeltContext = {
    total_events: 3,
    top_cameo: [
      { code: "14", label: "Protest", count: 2 },
      { code: "05", label: "Diplomatic engagement", count: 1 },
    ],
    goldstein_avg: -1.8,
    goldstein_min: -4.2,
    goldstein_max: 0.8,
    goldstein_bucket: "conflict",
    tone_avg: -0.7,
    tone_baseline_avg: -0.3,
    tone_delta_vs_cluster: -0.4,
  };

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  function mockFetchJson(payload: unknown) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response) as typeof fetch;
  }

  it("parses trending clusters when image_url and summary are null", async () => {
    const payload = {
      window: "1d",
      total: 1,
      clusters: [
        {
          cluster_id: 1,
          label: "Topic",
          keywords: ["topic"],
          article_count: 2,
          window_count: 2,
          source_diversity: 2,
          trending_score: 1.2,
          velocity: 0.8,
          representative_article: {
            id: 11,
            title: "Representative",
            source: "Source A",
            url: "https://example.com/a",
            image_url: null,
            published_at: "2026-03-06T12:00:00.000Z",
            summary: null,
            gdelt_context: null,
          },
          articles: [
            {
              id: 11,
              title: "Representative",
              source: "Source A",
              url: "https://example.com/a",
              image_url: null,
              published_at: "2026-03-06T12:00:00.000Z",
              summary: null,
              gdelt_context: null,
            },
          ],
          gdelt_context: null,
        },
      ],
    };

    mockFetchJson(payload);

    await expect(fetchTrending("1d", 10)).resolves.toEqual(payload);
  });

  it("parses breaking clusters when image_url and summary are null", async () => {
    const payload = {
      window_hours: 3,
      total: 1,
      clusters: [
        {
          cluster_id: 2,
          label: null,
          keywords: ["breaking"],
          article_count_3h: 4,
          source_count_3h: 2,
          spike_magnitude: 3.4,
          is_new_story: true,
          representative_article: {
            id: 21,
            title: "Breaking Representative",
            source: "Source B",
            url: "https://example.com/b",
            image_url: null,
            published_at: "2026-03-06T12:00:00.000Z",
            summary: null,
            gdelt_context: gdeltContext,
          },
          articles: [
            {
              id: 21,
              title: "Breaking Representative",
              source: "Source B",
              url: "https://example.com/b",
              image_url: null,
              published_at: "2026-03-06T12:00:00.000Z",
              summary: null,
              gdelt_context: gdeltContext,
            },
          ],
          gdelt_context: gdeltContext,
        },
      ],
    };

    mockFetchJson(payload);

    await expect(fetchBreaking(5)).resolves.toEqual(payload);
  });

  it("parses all clusters when image_url and summary are null", async () => {
    const payload = {
      window: "1d",
      total: 1,
      computed_at: "2026-03-06T12:00:00.000Z",
      status: "ok",
      clusters: [
        {
          cluster_id: 3,
          label: "All clusters topic",
          keywords: ["all"],
          article_count: 3,
          window_count: 3,
          source_diversity: 2,
          representative_article: {
            id: 31,
            title: "Cluster Representative",
            source: "Source C",
            url: "https://example.com/c",
            image_url: null,
            published_at: "2026-03-06T12:00:00.000Z",
            summary: null,
            gdelt_context: gdeltContext,
          },
          articles: [
            {
              id: 31,
              title: "Cluster Representative",
              source: "Source C",
              url: "https://example.com/c",
              image_url: null,
              published_at: "2026-03-06T12:00:00.000Z",
              summary: null,
              gdelt_context: gdeltContext,
            },
          ],
          gdelt_context: gdeltContext,
        },
      ],
    };

    mockFetchJson(payload);

    await expect(fetchAllClusters("1d", 2, 100)).resolves.toEqual(payload);
  });

  it("parses cluster detail responses with nested gdelt_context", async () => {
    const payload = {
      id: 41,
      label: "Cluster Detail",
      keywords: ["detail"],
      article_count: 2,
      first_seen: "2026-03-06T11:00:00.000Z",
      last_seen: "2026-03-06T12:00:00.000Z",
      is_active: true,
      gdelt_context: gdeltContext,
      articles: [
        {
          id: 41,
          title: "Detail Article",
          source: "Source D",
          source_id: "source-d",
          url: "https://example.com/d",
          image_url: null,
          published_at: "2026-03-06T12:00:00.000Z",
          summary: null,
          similarity: 1,
          author: "Reporter",
          authors: ["Reporter"],
          gdelt_context: null,
        },
      ],
    };

    mockFetchJson(payload);

    await expect(fetchClusterDetail(41)).resolves.toEqual(payload);
  });
});
