import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { semanticSearch } from "@/lib/api";

interface SemanticSearchPayloadArticle {
  readonly category: string;
  readonly id: number;
  readonly image_url: string;
  readonly is_persisted: boolean;
  readonly published_at: string;
  readonly source: string;
  readonly summary: string;
  readonly title: string;
  readonly translated: boolean;
  readonly url: string;
}

interface SemanticSearchPayload {
  readonly query: string;
  readonly results: readonly {
    readonly article: SemanticSearchPayloadArticle;
    readonly distance: number;
    readonly similarity_score: number;
  }[];
  readonly total: number;
}

interface FetchResponse {
  readonly json: () => Promise<SemanticSearchPayload>;
  readonly ok: boolean;
  readonly status: number;
}

type FetchMock = (input: string) => Promise<FetchResponse>;

const fetchMock = jest.fn<FetchMock>();
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
const CANONICAL_SEARCH_RESPONSE: SemanticSearchPayload = {
  query: "climate policy",
  results: [
    {
      article: {
        category: "world",
        id: 11,
        image_url: "https://example.com/image.jpg",
        is_persisted: true,
        published_at: "2026-04-09T00:00:00Z",
        source: "Example News",
        summary: "Canonical summary",
        title: "Canonical headline",
        translated: false,
        url: "https://example.com/article",
      },
      distance: 0.2,
      similarity_score: 0.8,
    },
  ],
  total: 1,
};

describe("semanticSearch", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalFetchDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "fetch");
    } else {
      Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
    }
  });

  it("maps canonical article results once at the API boundary", async () => {
    expect.hasAssertions();

    fetchMock.mockResolvedValue({
      json: () => Promise.resolve(CANONICAL_SEARCH_RESPONSE),
      ok: true,
      status: 200,
    });

    const response = await semanticSearch("climate policy");
    const [result] = response.results;

    expect(response.query).toBe("climate policy");
    expect(result?.article.title).toBe("Canonical headline");
    expect(result?.article.image).toBe("https://example.com/image.jpg");
    expect(result?.similarityScore).toBe(0.8);
    expect(result?.distance).toBe(0.2);
  });
});
