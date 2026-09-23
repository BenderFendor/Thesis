/* @jest-environment node */

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { refreshCache } from "@/lib/api";

describe("refreshCache", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("keeps an SSE event together when the network splits its line", async () => {
    expect.hasAssertions();
    const chunks = [
      new TextEncoder().encode('data: {"source":"news","total_'),
      new TextEncoder().encode('articles":2}\n'),
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));
    const progress: { source?: string; totalArticles?: number }[] = [];

    await expect(
      refreshCache((event) => {
        progress.push(event);
      }),
    ).resolves.toBe(true);
    expect(progress).toHaveLength(1);
    expect(progress[0]?.source).toBe("news");
    expect(progress[0]?.totalArticles).toBe(2);
  });
});
