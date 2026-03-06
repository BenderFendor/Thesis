import { act, renderHook } from "@testing-library/react";
import { useReadingHistory } from "@/hooks/useReadingHistory";

describe("useReadingHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does not rewrite an existing article when it is marked as read again", () => {
    const { result } = renderHook(() => useReadingHistory());

    act(() => {
      result.current.markAsRead(42, "Test title", "Reuters");
    });

    const firstEntry = result.current.history[0];

    act(() => {
      result.current.markAsRead(42, "Test title", "Reuters");
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]).toEqual(firstEntry);
  });

  it("fills missing metadata once without duplicating the entry", () => {
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
      title: "Filled title",
      source: "AP",
    });
  });
});
