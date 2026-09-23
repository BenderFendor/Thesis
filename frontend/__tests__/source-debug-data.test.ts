import type { SourceDebugData } from "@/lib/api";
import { describe, expect, it } from "@jest/globals";
import { filterSourceDebugData, getImagePercentage } from "@/app/sources/[source]/debug/source-debug-data";

const DEBUG_DATA: SourceDebugData = {
  cached_articles: [],
  debug_timestamp: "2026-09-09T00:00:00Z",
  feed_metadata: {
    description: "Feed",
    generator: "Test",
    language: "en",
    link: "https://example.test",
    title: "Feed",
    updated: "2026-09-09",
  },
  feed_status: {
    bozo: false,
    bozo_exception: "",
    entries_count: 2,
    http_status: 200,
  },
  image_analysis: {
    entries_with_images: 1,
    image_sources: [],
    total_entries: 4,
  },
  parsed_entries: [
    {
      author: "Reporter",
      content_images: [],
      description: "Target description",
      description_images: [],
      has_images: false,
      image_sources: [],
      index: 0,
      link: "https://example.test/target",
      published: "2026-09-09",
      raw_entry_keys: ["title"],
      tags: [],
      title: "Target story",
    },
    {
      author: "Reporter",
      content_images: [],
      description: "Other description",
      description_images: [],
      has_images: false,
      image_sources: [],
      index: 1,
      link: "https://example.test/other",
      published: "2026-09-09",
      raw_entry_keys: ["title"],
      tags: [],
      title: "Other story",
    },
  ],
  rss_url: "https://example.test/feed.xml",
  source_config: null,
  source_name: "Example",
  source_statistics: null,
};

describe("source debug data helpers", () => {
  it("filters nested debug JSON without retaining unrelated entries", () => {  expect.hasAssertions();

    expect(filterSourceDebugData(DEBUG_DATA, "target")).toStrictEqual({
      parsed_entries: [
        {
          description: "Target description",
          link: "https://example.test/target",
          title: "Target story",
        },
      ],
    });
  });

  it("returns a safe zero percentage for empty image analysis", () => {  expect.hasAssertions();

    expect(getImagePercentage(DEBUG_DATA)).toBe(25);
    expect(
      getImagePercentage({
        ...DEBUG_DATA,
        image_analysis: { entries_with_images: 0, image_sources: [], total_entries: 0 },
      }),
    ).toBe(0);
  });
});
