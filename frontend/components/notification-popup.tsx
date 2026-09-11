"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef } from "react";
import { useNotificationPopupHandlers } from "./notification-popup-hooks";
import { NotificationPopupCard } from "./notification-popup-content";
import type {
  Notification,
  PopupKeyboardEvent,
  PopupMouseEvent,
  NotificationsPopupProps,
  PopupClickEvent,
} from "./notification-popup-types";

const useNotificationPortalEffects = (
  getPopup: () => HTMLDialogElement | null,
  anchorId: string | undefined,
  onClose: () => void,
): void => {
  useEffect(() => {
    getPopup()?.focus();
  }, [getPopup]);

  useEffect(() => {
    const handleClickOutside = (event: Readonly<PopupMouseEvent>) => {
      const target = event.target;
      const popup = getPopup();
      if (
        popup &&
        target instanceof globalThis.Node &&
        !popup.contains(target) &&
        (anchorId === undefined ||
          anchorId === "" ||
          globalThis.document.querySelector(`#${anchorId}`)?.contains(target) !== true)
      ) {
        onClose();
      }
    };
    const handleEscape = (event: Readonly<PopupKeyboardEvent>) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    globalThis.document.addEventListener("mousedown", handleClickOutside);
    globalThis.document.addEventListener("keydown", handleEscape);
    return () => {
      globalThis.document.removeEventListener("mousedown", handleClickOutside);
      globalThis.document.removeEventListener("keydown", handleEscape);
    };
  }, [anchorId, getPopup, onClose]);
};

const NotificationsPopup = (props: NotificationsPopupProps) => {
  const { notifications, onClear, onClearAll, onAction, onClose, anchorId } = props;
  const { handleClearNotification, handleNotificationAction } = useNotificationPopupHandlers(
    notifications,
    onClear,
    onAction,
  );
  const unreadCount = notifications.filter(
    (item) => item.type === "error" || item.type === "warning",
  ).length;
  return (
    <NotificationPortal
      notifications={notifications}
      unreadCount={unreadCount}
      onClearAll={onClearAll}
      onClose={onClose}
      anchorId={anchorId}
      handleNotificationAction={handleNotificationAction}
      handleClearNotification={handleClearNotification}
    />
  );
};

const NotificationPortal = ({
  notifications,
  unreadCount,
  onClearAll,
  onClose,
  anchorId,
  handleNotificationAction,
  handleClearNotification,
}: Readonly<{
  notifications: readonly Notification[];
  unreadCount: number;
  onClearAll: () => void;
  onClose: () => void;
  anchorId?: string;
  handleNotificationAction: (event: Readonly<PopupClickEvent>) => void;
  handleClearNotification: (event: Readonly<PopupClickEvent>) => void;
}>) => {
  const popupRef = useRef<HTMLDialogElement>(null);
  const getPopup = useCallback(() => popupRef.current, []);
  useNotificationPortalEffects(getPopup, anchorId, onClose);
  const portalTarget = globalThis.document?.body ?? null;
  if (portalTarget === null) {
    return null;
  }
  return createPortal(
    <dialog
      ref={popupRef}
      open
      aria-label="Notifications"
      aria-live="polite"
      tabIndex={-1}
      className="m-0 fixed inset-x-3 top-16 z-[100] outline-none sm:left-auto sm:right-4 sm:w-96"
    >
      <NotificationPopupCard
        notifications={notifications}
        unreadCount={unreadCount}
        onClearAll={onClearAll}
        onClose={onClose}
        handleNotificationAction={handleNotificationAction}
        handleClearNotification={handleClearNotification}
      />
    </dialog>,
    portalTarget,
  );
};

export { NotificationsPopup };
export type * from "./notification-popup-types";
