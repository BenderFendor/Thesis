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

    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ categories: ["general", "technology", "politics"] }), { status: 200 }),
    );

    const categories = await fetchCategories();

    expect(categories).toStrictEqual(["general", "technology", "politics"]);
  });
});
