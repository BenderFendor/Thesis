import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { performAgenticSearch } from "@/lib/api";

describe("performAgenticSearch", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("uses the supported news research endpoint and normalizes the response", async () => {  expect.hasAssertions();

    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      json: async () => ({
        answer: "Current evidence summary",
        query: "fact check this",
        referenced_articles: [{ id: 1, title: "Source article" }],
        success: true,
        thinking_steps: [{ content: "checked sources", timestamp: "2026-04-23T12:00:00Z", type: "thought" }],
      }),
      ok: true,
    } as Response);

    const result = await performAgenticSearch("fact check this", 10);

    expect(global.fetch).toHaveBeenCalledWith(
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
