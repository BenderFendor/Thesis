import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { fetchCategories } from "@/lib/api";

interface CategoryResponse {
  readonly json: () => Promise<Readonly<{ categories: readonly string[] }>>;
  readonly ok: boolean;
  readonly status: number;
}

type CategoryFetch = () => Promise<CategoryResponse>;

describe("fetchCategories", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns the categories array from the backend's object-wrapped response", async () => {
    expect.hasAssertions();

    const fetchMock = jest.fn<CategoryFetch>();
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ categories: ["general", "technology", "politics"] }),
      ok: true,
      status: 200,
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: fetchMock,
      writable: true,
    });

    const categories = await fetchCategories();

    expect(categories).toStrictEqual(["general", "technology", "politics"]);
  });
});
