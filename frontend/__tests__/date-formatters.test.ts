import { describe, expect, it } from "@jest/globals";
import {
  formatArticleDate,
  formatArticleDateTime,
  formatMonthYear,
  formatShortDate,
} from "@/lib/date-formatters";

describe("semantic article date formatters", () => {
  it("uses the requested semantic date shapes", () => {
    expect.hasAssertions();
    const value = "2026-03-04T15:30:00.000Z";

    expect(formatArticleDate(value)).toBe("Mar 4, 2026");
    expect(formatArticleDateTime(value)).toMatch(/^Mar 4, 2026, \d{1,2}:30 [AP]M$/u);
    expect(formatShortDate(value)).toBe("Mar 4");
    expect(formatMonthYear(value)).toBe("Mar 2026");
  });

  it("preserves empty and invalid values without throwing", () => {
    expect.hasAssertions();
    expect(formatArticleDate()).toBe("");
    expect(formatArticleDateTime(null)).toBe("");
    expect(formatShortDate("not-a-date")).toBe("not-a-date");
    expect(formatMonthYear("not-a-date")).toBe("not-a-date");
  });
});
