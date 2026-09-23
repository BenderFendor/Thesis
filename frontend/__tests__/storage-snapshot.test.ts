import { describe, expect, it } from "@jest/globals";
import {
  createStorageSchema,
  getStorageSnapshot,
  removeFromStorage,
  saveToStorage,
} from "@/lib/storage";
import { z } from "zod";

const StringArraySchema = createStorageSchema(z.array(z.string()));

describe("getStorageSnapshot", () => {
  it("reuses the fallback reference when storage is empty", () => {
    expect.hasAssertions();
    globalThis.localStorage.clear();
    const fallback: string[] = [],
      firstSnapshot = getStorageSnapshot("missing-key", fallback, StringArraySchema),
      secondSnapshot = getStorageSnapshot("missing-key", fallback, StringArraySchema);

    expect(firstSnapshot).toBe(fallback);
    expect(secondSnapshot).toBe(fallback);
    expect(secondSnapshot).toBe(firstSnapshot);
  });

  it("reuses the parsed snapshot while the stored value is unchanged", () => {
    expect.hasAssertions();
    globalThis.localStorage.clear();
    saveToStorage("favoriteSourceIds", ["bbc", "reuters"]);

    const firstSnapshot = getStorageSnapshot("favoriteSourceIds", [], StringArraySchema),
      secondSnapshot = getStorageSnapshot("favoriteSourceIds", [], StringArraySchema);

    expect(secondSnapshot).toBe(firstSnapshot);
    expect(secondSnapshot).toStrictEqual(["bbc", "reuters"]);
  });

  it("returns a new snapshot after the stored value changes", () => {
    expect.hasAssertions();
    globalThis.localStorage.clear();
    saveToStorage("favoriteSourceIds", ["bbc"]);
    const firstSnapshot = getStorageSnapshot("favoriteSourceIds", [], StringArraySchema),
      secondSnapshot = (() => {
        saveToStorage("favoriteSourceIds", ["bbc", "reuters"]);
        return getStorageSnapshot("favoriteSourceIds", [], StringArraySchema);
      })();

    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(secondSnapshot).toStrictEqual(["bbc", "reuters"]);
  });

  it("returns the fallback after the key is removed", () => {
    expect.hasAssertions();
    globalThis.localStorage.clear();
    const fallback: string[] = [],
      nextSnapshot = (() => {
        saveToStorage("favoriteSourceIds", ["bbc"]);
        getStorageSnapshot("favoriteSourceIds", fallback, StringArraySchema);
        removeFromStorage("favoriteSourceIds");
        return getStorageSnapshot("favoriteSourceIds", fallback, StringArraySchema);
      })();

    expect(nextSnapshot).toBe(fallback);
  });
});
