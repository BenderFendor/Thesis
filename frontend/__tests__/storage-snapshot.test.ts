import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  getStorageSnapshot,
  removeFromStorage,
  saveToStorage,
} from "@/lib/storage";

describe("getStorageSnapshot", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("reuses the fallback reference when storage is empty", () => {expect.hasAssertions();
    const fallback: string[] = [],

     firstSnapshot = getStorageSnapshot("missing-key", fallback),
     secondSnapshot = getStorageSnapshot("missing-key", fallback);

    expect(firstSnapshot).toBe(fallback);
    expect(secondSnapshot).toBe(fallback);
    expect(secondSnapshot).toBe(firstSnapshot);
  });

  it("reuses the parsed snapshot while the stored value is unchanged", () => {expect.hasAssertions();
    saveToStorage("favoriteSourceIds", ["bbc", "reuters"]);

    const firstSnapshot = getStorageSnapshot<string[]>("favoriteSourceIds", []),
     secondSnapshot = getStorageSnapshot<string[]>("favoriteSourceIds", []);

    expect(secondSnapshot).toBe(firstSnapshot);
    expect(secondSnapshot).toStrictEqual(["bbc", "reuters"]);
  });

  it("returns a new snapshot after the stored value changes", () => {expect.hasAssertions();
    saveToStorage("favoriteSourceIds", ["bbc"]);
    const firstSnapshot = getStorageSnapshot<string[]>("favoriteSourceIds", []);

    saveToStorage("favoriteSourceIds", ["bbc", "reuters"]);
    const secondSnapshot = getStorageSnapshot<string[]>("favoriteSourceIds", []);

    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(secondSnapshot).toStrictEqual(["bbc", "reuters"]);
  });

  it("returns the fallback after the key is removed", () => {expect.hasAssertions();
    const fallback: string[] = [];
    saveToStorage("favoriteSourceIds", ["bbc"]);
    getStorageSnapshot<string[]>("favoriteSourceIds", fallback);

    removeFromStorage("favoriteSourceIds");
    const nextSnapshot = getStorageSnapshot("favoriteSourceIds", fallback);

    expect(nextSnapshot).toBe(fallback);
  });
});
