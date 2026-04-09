import {
  dismissAllNotifications,
  dismissNotification,
  getVisibleNotifications,
  retainActiveDismissedNotifications,
  useDismissedNotifications,
} from "@/lib/notification-state"
import { renderHook, waitFor, act } from "@testing-library/react"

describe("notification state helpers", () => {
  const notifications = [
    { id: "a" },
    { id: "b" },
  ]

  it("dismisses individual notifications", () => {
    const dismissed = dismissNotification(new Set<string>(), "a")
    expect(getVisibleNotifications(notifications, dismissed)).toEqual([{ id: "b" }])
  })

  it("dismisses all current notifications", () => {
    const dismissed = dismissAllNotifications(new Set<string>(), notifications)
    expect(getVisibleNotifications(notifications, dismissed)).toEqual([])
  })

  it("drops dismissed ids once the notification disappears", () => {
    const retained = retainActiveDismissedNotifications(new Set(["a", "stale"]), notifications)
    expect([...retained]).toEqual(["a"])
  })

  it("forgets stale dismissed ids so recurring notifications become visible again", async () => {
    const { result, rerender } = renderHook(
      ({ items }) => useDismissedNotifications(items),
      {
        initialProps: {
          items: notifications,
        },
      },
    )

    act(() => {
      result.current.dismissOne("a")
    })

    await waitFor(() => {
      expect(result.current.dismissedIds.has("a")).toBe(true)
    })
    expect(result.current.visibleNotifications).toEqual([{ id: "b" }])

    rerender({ items: [{ id: "b" }] })

    await waitFor(() => {
      expect(result.current.dismissedIds.has("a")).toBe(false)
    })
    expect(result.current.visibleNotifications).toEqual([{ id: "b" }])

    rerender({ items: notifications })

    await waitFor(() => {
      expect(result.current.visibleNotifications).toEqual(notifications)
    })
  })
})
