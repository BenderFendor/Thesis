import { useCallback, useEffect, useMemo, useState } from "react"

interface NotificationLike {
  id: string
}

const enqueueStateSync = (callback: () => void): () => void => {
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

function dismissNotification(
  dismissedIds: Set<string>,
  notificationId: string,
): Set<string> {
  const next = new Set(dismissedIds)
  next.add(notificationId)
  return next
}

function dismissAllNotifications<T extends NotificationLike>(
  dismissedIds: Set<string>,
  notifications:readonly  T[],
): Set<string> {
  const next = new Set(dismissedIds)
  notifications.forEach((notification) => next.add(notification.id))
  return next
}

function retainActiveDismissedNotifications<T extends NotificationLike>(
  dismissedIds: Set<string>,
  notifications:readonly  T[],
): Set<string> {
  const activeIds = new Set(notifications.map((notification) => notification.id)),
   retainedIds = [...dismissedIds].filter((id) => activeIds.has(id))

  if (retainedIds.length === dismissedIds.size) {
    const unchanged = retainedIds.every((id) => dismissedIds.has(id))
    if (unchanged) {
      return dismissedIds
    }
  }

  return new Set(retainedIds)
}

function getVisibleNotifications<T extends NotificationLike>(
  notifications:readonly  T[],
  dismissedIds: Set<string>,
): T[] {
  return notifications.filter((notification) => !dismissedIds.has(notification.id))
}

function useDismissedNotifications<T extends NotificationLike>(
  notifications:readonly  T[],
) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set()),

   activeDismissedIds = useMemo(
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

  const dismissAll = useCallback(() => {
    setDismissedIds((current) =>
      dismissAllNotifications(
        retainActiveDismissedNotifications(current, notifications),
        notifications,
      ),
    )
  }, [notifications]),

   dismissOne = useCallback(
    (notificationId: string) => {
      setDismissedIds((current) =>
        dismissNotification(
          retainActiveDismissedNotifications(current, notifications),
          notificationId,
        ),
      )
    },
    [notifications],
  ),

   visibleNotifications = useMemo(
    () => getVisibleNotifications(notifications, activeDismissedIds),
    [notifications, activeDismissedIds],
  )

  return {
    dismissAll,
    dismissOne,
    dismissedIds: activeDismissedIds,
    visibleNotifications,
  }
}
export { dismissNotification, dismissAllNotifications, retainActiveDismissedNotifications, getVisibleNotifications, useDismissedNotifications };
