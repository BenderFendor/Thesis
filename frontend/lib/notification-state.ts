import { useCallback, useEffect, useMemo, useState } from "react"

interface NotificationLike {
  id: string
}

function enqueueStateSync(callback: () => void): () => void {
  let cancelled = false
  const schedule =
    typeof queueMicrotask === "function"
      ? queueMicrotask
      : (task: () => void) => {
          void Promise.resolve().then(task)
        }

  schedule(() => {
    if (!cancelled) {
      callback()
    }
  })

  return () => {
    cancelled = true
  }
}

export function dismissNotification(
  dismissedIds: Set<string>,
  notificationId: string,
): Set<string> {
  const next = new Set(dismissedIds)
  next.add(notificationId)
  return next
}

export function dismissAllNotifications<T extends NotificationLike>(
  dismissedIds: Set<string>,
  notifications: T[],
): Set<string> {
  const next = new Set(dismissedIds)
  notifications.forEach((notification) => next.add(notification.id))
  return next
}

export function retainActiveDismissedNotifications<T extends NotificationLike>(
  dismissedIds: Set<string>,
  notifications: T[],
): Set<string> {
  const activeIds = new Set(notifications.map((notification) => notification.id))
  const retainedIds = [...dismissedIds].filter((id) => activeIds.has(id))

  if (retainedIds.length === dismissedIds.size) {
    const unchanged = retainedIds.every((id) => dismissedIds.has(id))
    if (unchanged) {
      return dismissedIds
    }
  }

  return new Set(retainedIds)
}

export function getVisibleNotifications<T extends NotificationLike>(
  notifications: T[],
  dismissedIds: Set<string>,
): T[] {
  return notifications.filter((notification) => !dismissedIds.has(notification.id))
}

export function useDismissedNotifications<T extends NotificationLike>(
  notifications: T[],
) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set())

  const activeDismissedIds = useMemo(
    () => retainActiveDismissedNotifications(dismissedIds, notifications),
    [dismissedIds, notifications],
  )

  useEffect(() => {
    if (activeDismissedIds === dismissedIds) {
      return
    }

    return enqueueStateSync(() => {
      setDismissedIds(activeDismissedIds)
    })
  }, [activeDismissedIds, dismissedIds])

  const dismissOne = useCallback(
    (notificationId: string) => {
      setDismissedIds((current) =>
        dismissNotification(
          retainActiveDismissedNotifications(current, notifications),
          notificationId,
        ),
      )
    },
    [notifications],
  )

  const dismissAll = useCallback(() => {
    setDismissedIds((current) =>
      dismissAllNotifications(
        retainActiveDismissedNotifications(current, notifications),
        notifications,
      ),
    )
  }, [notifications])

  const visibleNotifications = useMemo(
    () => getVisibleNotifications(notifications, activeDismissedIds),
    [notifications, activeDismissedIds],
  )

  return {
    dismissedIds: activeDismissedIds,
    visibleNotifications,
    dismissOne,
    dismissAll,
  }
}
