import { fetchAllClusters, fetchBreaking, fetchTrending } from "@/lib/api";

describe("cluster payload nullables", () => {
  const originalFetch = global.fetch;

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
            },
          ],
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
            },
          ],
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
            },
          ],
        },
      ],
    };

    mockFetchJson(payload);

    await expect(fetchAllClusters("1d", 2, 100)).resolves.toEqual(payload);
  });
});
