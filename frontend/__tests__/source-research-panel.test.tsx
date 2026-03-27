import { selectSourceResearchData } from "@/components/source-research-panel"

describe("selectSourceResearchData", () => {
  it("prefers fresh research data over cached data", () => {
    const cached = { cached: true, overview: "stale" }
    const live = { cached: false, overview: "fresh" }

    expect(selectSourceResearchData(cached, live)).toEqual(live)
  })

  it("falls back to cached data when no live result exists", () => {
    const cached = { cached: true, overview: "stale" }

    expect(selectSourceResearchData(cached, undefined)).toEqual(cached)
  })
})
