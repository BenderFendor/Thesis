import { describe, expect, it } from '@jest/globals';
import fc from "fast-check";

import {
  getDefaultComparisonArticleIds,
  getSelectedComparisonArticles,
} from "@/lib/cluster-comparison";

describe("cluster comparison helpers", () => {
  it("prefers two different sources when a cluster has multi-outlet coverage", () => {  expect.hasAssertions();
  
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ max: 1_000_000, min: 1 }), {
          maxLength: 10,
          minLength: 2,
        }),
        fc.uniqueArray(fc.stringMatching(/^[A-Za-z]{1,12}$/u), {
          maxLength: 5,
          minLength: 2,
        }),
        (ids, sources) => {
          const articles = ids.map((id, index) => ({
            id,
            source: sources[index % sources.length]!,
          })),

           selectedIds = getDefaultComparisonArticleIds(articles),
           selectedArticles = getSelectedComparisonArticles(
            articles,
            selectedIds,
          );

          expect(selectedArticles).toHaveLength(2);
          expect(selectedArticles[0]!.source.toLowerCase()).not.toBe(
            selectedArticles[1]!.source.toLowerCase(),
          );
        },
      ),
    );
  });

  it("falls back to the first two articles when only one source is present", () => {  expect.hasAssertions();
  
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ max: 1_000_000, min: 1 }), {
          maxLength: 10,
          minLength: 2,
        }),
        fc.stringMatching(/^[A-Za-z]{1,12}$/u),
        (ids, source) => {
          const articles = ids.map((id) => ({ id, source })),

           selectedIds = getDefaultComparisonArticleIds(articles),
           selectedArticles = getSelectedComparisonArticles(
            articles,
            selectedIds,
          );

          expect(selectedIds).toStrictEqual(ids.slice(0, 2));
          expect(selectedArticles).toStrictEqual(articles.slice(0, 2));
        },
      ),
    );
  });
});
