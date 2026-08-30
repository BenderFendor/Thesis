import { describe, expect, it } from '@jest/globals';
import { serializeSources } from "@/lib/utils";

describe("serializeSources", () => {
  it("returns undefined for missing or empty source lists", () => {  expect.hasAssertions();
  
    expect(serializeSources()).toBeNull();
    expect(serializeSources([])).toBeNull();
  });

  it("sorts and joins source names deterministically", () => {  expect.hasAssertions();
  
    expect(serializeSources(["Reuters", "Associated Press", "BBC"])).toBe(
      "Associated Press,BBC,Reuters",
    );
  });

  it("does not mutate the caller's array", () => {  expect.hasAssertions();
  
    const sources = ["beta", "alpha"];
    serializeSources(sources);
    expect(sources).toStrictEqual(["beta", "alpha"]);
  });
});
