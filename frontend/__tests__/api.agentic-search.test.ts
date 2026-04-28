import { performAgenticSearch } from "@/lib/api";

describe("performAgenticSearch", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("uses the supported news research endpoint and normalizes the response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        query: "fact check this",
        answer: "Current evidence summary",
        thinking_steps: [{ type: "thought", content: "checked sources", timestamp: "2026-04-23T12:00:00Z" }],
        referenced_articles: [{ id: 1, title: "Source article" }],
      }),
    }) as typeof fetch;

    const result = await performAgenticSearch("fact check this", 10);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/news/research",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "fact check this",
          include_thinking: false,
        }),
      },
    );
    expect(result).toEqual({
      success: true,
      answer: "Current evidence summary",
      reasoning: [{ type: "thought", content: "checked sources", timestamp: "2026-04-23T12:00:00Z" }],
      citations: [{ id: 1, title: "Source article" }],
    });
  });
});
