import { describe, expect, it } from '@jest/globals';
import { selectSourceResearchData } from "@/components/source-research-panel"

describe("selectSourceResearchData", () => {
  it("prefers fresh research data over cached data", () => {  expect.hasAssertions();
  
    const cached = { cached: true, overview: "stale" },
     live = { cached: false, overview: "fresh" }

    expect(selectSourceResearchData(cached, live)).toStrictEqual(live)
  })

  it("falls back to cached data when no live result exists", () => {  expect.hasAssertions();
  
    const cached = { cached: true, overview: "stale" }

    expect(selectSourceResearchData(cached)).toStrictEqual(cached)
  })
})
