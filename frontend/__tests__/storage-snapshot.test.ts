import { describe, expect, it } from '@jest/globals';
import {
  getStorageSnapshot,
  removeFromStorage,
  saveToStorage,
} from "@/lib/storage";

describe("getStorageSnapshot", () => {
  it("reuses the fallback reference when storage is empty", () => {expect.hasAssertions();
    globalThis.localStorage.clear();
    const fallback: string[] = [],

     firstSnapshot = getStorageSnapshot("missing-key", fallback),
     secondSnapshot = getStorageSnapshot("missing-key", fallback);

    expect(firstSnapshot).toBe(fallback);
    expect(secondSnapshot).toBe(fallback);
    expect(secondSnapshot).toBe(firstSnapshot);
  });

  it("reuses the parsed snapshot while the stored value is unchanged", () => {expect.hasAssertions();
    globalThis.localStorage.clear();
    saveToStorage("favoriteSourceIds", ["bbc", "reuters"]);

    const firstSnapshot = getStorageSnapshot<string[]>("favoriteSourceIds", []),
     secondSnapshot = getStorageSnapshot<string[]>("favoriteSourceIds", []);

    expect(secondSnapshot).toBe(firstSnapshot);
    expect(secondSnapshot).toStrictEqual(["bbc", "reuters"]);
  });

  it("returns a new snapshot after the stored value changes", () => {expect.hasAssertions();
    globalThis.localStorage.clear();
    saveToStorage("favoriteSourceIds", ["bbc"]);
    const firstSnapshot = getStorageSnapshot<string[]>("favoriteSourceIds", []),
      secondSnapshot = (() => {
        saveToStorage("favoriteSourceIds", ["bbc", "reuters"]);
        return getStorageSnapshot<string[]>("favoriteSourceIds", []);
      })();

    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(secondSnapshot).toStrictEqual(["bbc", "reuters"]);
  });

  it("returns the fallback after the key is removed", () => {expect.hasAssertions();
    globalThis.localStorage.clear();
    const fallback: string[] = [],
      nextSnapshot = (() => {
        saveToStorage("favoriteSourceIds", ["bbc"]);
        getStorageSnapshot<string[]>("favoriteSourceIds", fallback);
        removeFromStorage("favoriteSourceIds");
        return getStorageSnapshot("favoriteSourceIds", fallback);
      })();

    expect(nextSnapshot).toBe(fallback);
  });
});
