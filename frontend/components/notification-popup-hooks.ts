import { useCallback } from "react";
import type {
  Notification,
  NotificationActionType,
  PopupClickEvent,
} from "./notification-popup-types";

const useNotificationPopupHandlers = (
  notifications: readonly Notification[],
  onClear: (id: string) => void,
  onAction: ((type: NotificationActionType, notification: Notification) => void) | undefined,
) => {
  const handleNotificationAction = useCallback(
    (event: Readonly<PopupClickEvent>) => {
      const notification = notifications.find(
        (item) => item.id === event.currentTarget.dataset.notificationId,
      );
      if (notification?.action) {
        onAction?.(notification.action.type, notification);
      }
    },
    [notifications, onAction],
  );
  const handleClearNotification = useCallback(
    (event: Readonly<PopupClickEvent>) => {
      event.stopPropagation();
      const notificationId = event.currentTarget.dataset.notificationId;
      if (notificationId !== undefined && notificationId !== "") {
        onClear(notificationId);
      }
    },
    [onClear],
  );
  return { handleClearNotification, handleNotificationAction };
};

export { useNotificationPopupHandlers };
