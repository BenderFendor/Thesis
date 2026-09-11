import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

interface NotificationLike {
  readonly id: string;
}

const isMutableStringSet = (value: ReadonlySet<string>): value is Set<string> => value instanceof Set;

const dismissNotification = (
  dismissedIds: ReadonlySet<string>,
  notificationId: string,
): Set<string> => new Set<string>([...dismissedIds, notificationId]);

const dismissAllNotifications = function dismissAllNotifications(
  dismissedIds: ReadonlySet<string>,
  notifications: readonly NotificationLike[],
): Set<string> {
  return new Set([...dismissedIds, ...notifications.map((notification) => notification.id)]);
};

const retainActiveDismissedNotifications = function retainActiveDismissedNotifications(
  dismissedIds: ReadonlySet<string>,
  notifications: readonly NotificationLike[],
): Set<string> {
  const activeIds = new Set<string>(notifications.map((notification) => notification.id)),
    retainedIds = [...dismissedIds].filter((dismissedId) => activeIds.has(dismissedId));

  if (retainedIds.length === dismissedIds.size) {
    const unchanged = retainedIds.every((dismissedId) => dismissedIds.has(dismissedId));
    if (unchanged) {
      if (isMutableStringSet(dismissedIds)) {
        return dismissedIds;
      }
      return new Set<string>(dismissedIds);
    }
  }

  return new Set<string>(retainedIds);
};

const getVisibleNotifications = function getVisibleNotifications<NotificationType extends NotificationLike>(
  notifications: readonly NotificationType[],
  dismissedIds: ReadonlySet<string>,
): NotificationType[] {
  return notifications.filter((notification) => !dismissedIds.has(notification.id));
};

const useDismissedIdsUpdate = (
  activeDismissedIds: Set<string>,
  dismissedIds: Set<string>,
  setDismissedIds: Dispatch<SetStateAction<Set<string>>>,
): void => {
  useEffect(() => {
    if (activeDismissedIds === dismissedIds) {
      return () => {};
    }

    let cancelled = false;
    const applyStateUpdate = async (): Promise<void> => {
      await Promise.resolve();
      if (!cancelled) {
        setDismissedIds(activeDismissedIds);
      }
    };
    void applyStateUpdate();
    return () => {
      cancelled = true;
    };
  }, [activeDismissedIds, dismissedIds, setDismissedIds]);
};

const useDismissedNotifications = function useDismissedNotifications<
  NotificationType extends NotificationLike,
>(notifications: readonly NotificationType[]) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set()),
    activeDismissedIds = useMemo(
      () => retainActiveDismissedNotifications(dismissedIds, notifications),
      [dismissedIds, notifications],
    );

  useDismissedIdsUpdate(activeDismissedIds, dismissedIds, setDismissedIds);

  const dismissAll = useCallback(() => {
      setDismissedIds((current) =>
        dismissAllNotifications(
          retainActiveDismissedNotifications(current, notifications),
          notifications,
        ),
      );
    }, [notifications]),
    dismissOne = useCallback(
      (notificationId: string) => {
        setDismissedIds((current) =>
          dismissNotification(
            retainActiveDismissedNotifications(current, notifications),
            notificationId,
          ),
        );
      },
      [notifications],
    ),
    visibleNotifications = useMemo(
      () => getVisibleNotifications(notifications, activeDismissedIds),
      [notifications, activeDismissedIds],
    );

  return {
    dismissAll,
    dismissOne,
    dismissedIds: activeDismissedIds,
    visibleNotifications,
  };
};
export {
  dismissNotification,
  dismissAllNotifications,
  retainActiveDismissedNotifications,
  getVisibleNotifications,
  useDismissedNotifications,
};
