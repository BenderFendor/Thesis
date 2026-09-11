import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from '@jest/globals';
import {
  dismissAllNotifications,
  dismissNotification,
  getVisibleNotifications,
  retainActiveDismissedNotifications,
  useDismissedNotifications,
} from "@/lib/notification-state"

interface NotificationItem {
  readonly id: string
}

interface NotificationHookProps {
  readonly items: readonly NotificationItem[]
}

const renderNotificationsHook = (items: readonly NotificationItem[]) =>
  renderHook(
    (props: Readonly<NotificationHookProps>) =>
      useDismissedNotifications(props.items),
    {
      initialProps: { items },
    },
  )

describe("notification state helpers", () => {
  const notifications: readonly NotificationItem[] = [
    { id: "a" },
    { id: "b" },
  ]

  it("dismisses individual notifications", () => {expect.hasAssertions();
    const dismissed = dismissNotification(new Set<string>(), "a")
    expect(getVisibleNotifications(notifications, dismissed)).toStrictEqual([{ id: "b" }])
  })

  it("dismisses all current notifications", () => {expect.hasAssertions();
    const dismissed = dismissAllNotifications(new Set<string>(), notifications)
    expect(getVisibleNotifications(notifications, dismissed)).toStrictEqual([])
  })

  it("drops dismissed ids once the notification disappears", () => {expect.hasAssertions();
    const retained = retainActiveDismissedNotifications(new Set(["a", "stale"]), notifications)
    expect([...retained]).toStrictEqual(["a"])
  })

  it("forgets stale dismissed ids so recurring notifications become visible again", async () => {expect.hasAssertions();
    const { result, rerender } = renderNotificationsHook(notifications)

    act(() => {
      result.current.dismissOne("a")
    })

    await waitFor(() => {
      expect(result.current.dismissedIds.has("a")).toBe(true)
      expect(result.current.visibleNotifications).toStrictEqual([{ id: "b" }])
    })

    rerender({ items: [{ id: "b" }] })

    await waitFor(() => {
      expect(result.current.dismissedIds.has("a")).toBe(false)
    })
    expect(result.current.visibleNotifications).toStrictEqual([{ id: "b" }])

    rerender({ items: notifications })

    await waitFor(() => {
      expect(result.current.visibleNotifications).toStrictEqual(notifications)
    })
    expect(result.current.visibleNotifications).toStrictEqual(notifications)
  })
})
