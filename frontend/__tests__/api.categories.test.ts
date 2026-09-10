import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { fetchCategories } from "@/lib/api";

describe("fetchCategories", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns the categories array from the backend's object-wrapped response", async () => {
    expect.hasAssertions();

    global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
      json: () => Promise.resolve({ categories: ["general", "technology", "politics"] }),
      ok: true,
      status: 200,
      // SAFETY: test boundary; only ok/status/json are consumed by the api client.
    } as Response);

    const categories = await fetchCategories();

    expect(categories).toStrictEqual(["general", "technology", "politics"]);
  });
});
