import { serializeSources } from "@/lib/utils";

describe("serializeSources", () => {
  it("returns null for missing or empty source lists", () => {
    expect(serializeSources(undefined)).toBeNull();
    expect(serializeSources([])).toBeNull();
  });

  it("sorts and joins source names deterministically", () => {
    expect(serializeSources(["Reuters", "Associated Press", "BBC"])).toBe(
      "Associated Press,BBC,Reuters",
    );
  });

  it("does not mutate the caller's array", () => {
    const sources = ["beta", "alpha"];
    serializeSources(sources);
    expect(sources).toEqual(["beta", "alpha"]);
  });
});
