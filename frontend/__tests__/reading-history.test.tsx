import { beforeEach, describe, expect, it } from '@jest/globals';
import { act, renderHook } from "@testing-library/react";
import { useReadingHistory } from "@/hooks/useReadingHistory";

describe("useReadingHistory", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("does not rewrite an existing article when it is marked as read again", () => {expect.hasAssertions();
    const { result } = renderHook(() => useReadingHistory());

    act(() => {
      result.current.markAsRead(42, "Test title", "Reuters");
    });

    const firstEntry = result.current.history[0];

    act(() => {
      result.current.markAsRead(42, "Test title", "Reuters");
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]).toStrictEqual(firstEntry);
  });

  it("fills missing metadata once without duplicating the entry", () => {expect.hasAssertions();
    const { result } = renderHook(() => useReadingHistory());

    act(() => {
      result.current.markAsRead(7);
    });

    act(() => {
      result.current.markAsRead(7, "Filled title", "AP");
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]).toMatchObject({
      articleId: 7,
      source: "AP",
      title: "Filled title",
    });
  });
});
