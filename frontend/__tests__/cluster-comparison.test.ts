import fc from "fast-check";

import {
  getDefaultComparisonArticleIds,
  getSelectedComparisonArticles,
} from "@/lib/cluster-comparison";

describe("cluster comparison helpers", () => {
  it("prefers two different sources when a cluster has multi-outlet coverage", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), {
          minLength: 2,
          maxLength: 10,
        }),
        fc.uniqueArray(fc.stringMatching(/^[A-Za-z]{1,12}$/), {
          minLength: 2,
          maxLength: 5,
        }),
        (ids, sources) => {
          const articles = ids.map((id, index) => ({
            id,
            source: sources[index % sources.length],
          }));

          const selectedIds = getDefaultComparisonArticleIds(articles);
          const selectedArticles = getSelectedComparisonArticles(
            articles,
            selectedIds,
          );

          expect(selectedArticles).toHaveLength(2);
          expect(selectedArticles[0].source.toLowerCase()).not.toBe(
            selectedArticles[1].source.toLowerCase(),
          );
        },
      ),
    );
  });

  it("falls back to the first two articles when only one source is present", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), {
          minLength: 2,
          maxLength: 10,
        }),
        fc.stringMatching(/^[A-Za-z]{1,12}$/),
        (ids, source) => {
          const articles = ids.map((id) => ({ id, source }));

          const selectedIds = getDefaultComparisonArticleIds(articles);
          const selectedArticles = getSelectedComparisonArticles(
            articles,
            selectedIds,
          );

          expect(selectedIds).toEqual(ids.slice(0, 2));
          expect(selectedArticles).toEqual(articles.slice(0, 2));
        },
      ),
    );
  });
});
