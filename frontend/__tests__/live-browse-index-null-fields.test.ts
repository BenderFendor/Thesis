/* @jest-environment node */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { PaginatedPayloadSchema, fetchLiveBrowseIndex } from "@/lib/api";

const EXPECTED_COUNT = 1;

interface BrowseIndexFixture {
  readonly articles?: readonly object[];
  readonly total?: number;
}

// Regression (2026-09-03): backend emits null for unset article fields.
// Schema used `.optional()` which rejects null, failing the index parse.
// Fixture carries JSON nulls via JSON.parse so the source has no nulls.
const createPayload = (): BrowseIndexFixture =>
  PaginatedPayloadSchema.parse(
    JSON.parse(
      '{"articles":[{"article_id":1,"author":null,"author_urls":null,"category":"politics","content":null,"id":1,"image":null,"image_url":null,"original_language":null,"published_at":"2026-09-03T12:00:00","source":"Example","tags":null,"title":"Null-field article","url":"https://example.com/story"}],"total":1}',
    ),
  );

const mockFetchJson = (apiPayload: BrowseIndexFixture) => {
  const response = Response.json(apiPayload, { status: 200 });
  globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(response);
};

describe('live browse index null article fields', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses and maps articles with null content, tags, image, and author', async () => {
    expect.hasAssertions();

    mockFetchJson(createPayload());

    const result = await fetchLiveBrowseIndex();
    const [first] = result.articles;

    expect(result.total).toBe(EXPECTED_COUNT);
    expect(result.articles).toHaveLength(EXPECTED_COUNT);
    expect(first?.title).toBe('Null-field article');
    expect(first?.publishedAt).toBe('2026-09-03T12:00:00');
  });
});
