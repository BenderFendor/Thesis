import { describe, expect, it } from '@jest/globals';
import {
  getDefaultComparisonArticleIds,
  getSelectedComparisonArticles,
} from "@/lib/cluster-comparison";

import fc from "fast-check";

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
          const articles = ids.map((id, index) => {
            const source = sources[index % sources.length];
            if (source === undefined) { throw new Error("missing generated source"); }
            return { id, source };
          }),

           selectedIds = getDefaultComparisonArticleIds(articles),
           selectedArticles = getSelectedComparisonArticles(
            articles,
            selectedIds,
          );

          expect(selectedArticles).toHaveLength(2);
          const [firstArticle, secondArticle] = selectedArticles;
          if (firstArticle === undefined || secondArticle === undefined) {
            throw new Error("expected two selected articles");
          }
          expect(firstArticle.source.toLowerCase()).not.toBe(
            secondArticle.source.toLowerCase(),
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
