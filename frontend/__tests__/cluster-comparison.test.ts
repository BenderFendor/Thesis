import { describe, expect, it } from "@jest/globals";
import {
  getDefaultComparisonArticleIds,
  getSelectedComparisonArticles,
} from "@/lib/cluster-comparison";

import fc from "fast-check";

const articleIdsArbitrary = fc.uniqueArray(fc.integer({ max: 1_000_000, min: 1 }), {
  maxLength: 10,
  minLength: 2,
});
const sourceNamesArbitrary = fc.uniqueArray(fc.stringMatching(/^[A-Za-z]{1,12}$/u), {
  maxLength: 5,
  minLength: 2,
  selector: (source) => source.toLowerCase(),
});
const sourceNameArbitrary = fc.stringMatching(/^[A-Za-z]{1,12}$/u);

const createComparisonArticles = (ids: readonly number[], sources: readonly string[]) =>
  ids.map((id, index) => ({
    id,
    source: sources[index % sources.length] ?? "",
  }));

describe("cluster comparison helpers", () => {
  it("prefers two different sources when a cluster has multi-outlet coverage", () => {
    expect(() => {
      fc.assert(
        fc.property(articleIdsArbitrary, sourceNamesArbitrary, (ids, sources) => {
          const articles = createComparisonArticles(ids, sources);
          const selectedIds = getDefaultComparisonArticleIds(articles);
          const selectedArticles = getSelectedComparisonArticles(articles, selectedIds);

          expect(selectedArticles).toHaveLength(2);
          expect(new Set(selectedArticles.map((article) => article.source.toLowerCase())).size).toBe(2);
        }),
      );
    }).not.toThrow();
  });

  it("falls back to the first two articles when only one source is present", () => {
    expect(() => {
      fc.assert(
        fc.property(articleIdsArbitrary, sourceNameArbitrary, (ids, source) => {
          const articles = ids.map((id) => ({ id, source }));
          const selectedIds = getDefaultComparisonArticleIds(articles);
          const selectedArticles = getSelectedComparisonArticles(articles, selectedIds);

          expect(selectedIds).toStrictEqual(ids.slice(0, 2));
          expect(selectedArticles).toStrictEqual(articles.slice(0, 2));
        }),
      );
    }).not.toThrow();
  });
});
