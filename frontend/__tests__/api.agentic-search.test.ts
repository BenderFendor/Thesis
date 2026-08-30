import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { performAgenticSearch } from "@/lib/api";

describe("performAgenticSearch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the supported news research endpoint and normalizes the response", async () => {  expect.hasAssertions();
  
    const fetcher = jest.fn(async (_input: string, _init: RequestInit) => ({
      json: async () => ({
        answer: "Current evidence summary",
        query: "fact check this",
        referenced_articles: [{ id: 1, title: "Source article" }],
        success: true,
        thinking_steps: [{ content: "checked sources", timestamp: "2026-04-23T12:00:00Z", type: "thought" }],
      }),
      ok: true,
      status: 200,
    })),

     result = await performAgenticSearch("fact check this", 10, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:8000/api/news/research",
      {
        body: JSON.stringify({
          include_thinking: false,
          query: "fact check this",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(result).toStrictEqual({
      answer: "Current evidence summary",
      citations: [{ id: 1, title: "Source article" }],
      reasoning: [{ content: "checked sources", timestamp: "2026-04-23T12:00:00Z", type: "thought" }],
      success: true,
    });
  });
});
