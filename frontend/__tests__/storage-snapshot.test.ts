import {
  getStorageSnapshot,
  removeFromStorage,
  saveToStorage,
} from "@/lib/storage";

describe("getStorageSnapshot", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reuses the fallback reference when storage is empty", () => {
    const fallback: string[] = [];

    const firstSnapshot = getStorageSnapshot("missing-key", fallback);
    const secondSnapshot = getStorageSnapshot("missing-key", fallback);

    expect(firstSnapshot).toBe(fallback);
    expect(secondSnapshot).toBe(fallback);
    expect(secondSnapshot).toBe(firstSnapshot);
  });

  it("reuses the parsed snapshot while the stored value is unchanged", () => {
    saveToStorage("favoriteSourceIds", ["bbc", "reuters"]);

    const firstSnapshot = getStorageSnapshot<string[]>("favoriteSourceIds", []);
    const secondSnapshot = getStorageSnapshot<string[]>("favoriteSourceIds", []);

    expect(secondSnapshot).toBe(firstSnapshot);
    expect(secondSnapshot).toEqual(["bbc", "reuters"]);
  });

  it("returns a new snapshot after the stored value changes", () => {
    saveToStorage("favoriteSourceIds", ["bbc"]);
    const firstSnapshot = getStorageSnapshot<string[]>("favoriteSourceIds", []);

    saveToStorage("favoriteSourceIds", ["bbc", "reuters"]);
    const secondSnapshot = getStorageSnapshot<string[]>("favoriteSourceIds", []);

    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(secondSnapshot).toEqual(["bbc", "reuters"]);
  });

  it("returns the fallback after the key is removed", () => {
    const fallback: string[] = [];
    saveToStorage("favoriteSourceIds", ["bbc"]);
    getStorageSnapshot<string[]>("favoriteSourceIds", fallback);

    removeFromStorage("favoriteSourceIds");
    const nextSnapshot = getStorageSnapshot("favoriteSourceIds", fallback);

    expect(nextSnapshot).toBe(fallback);
  });
});
