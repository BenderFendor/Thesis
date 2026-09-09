"use client";
import { hasText } from "@/lib/utils";

import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCallback, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";

import { createPortal } from "react-dom";

type NotificationActionType = "retry" | "open-debug" | "refresh";

interface Notification {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly type: "error" | "warning" | "info" | "success";
  readonly timestamp?: string;
  readonly meta?: Readonly<Record<string, string | number>>;
  readonly action?: {
    readonly label: string;
    readonly type: NotificationActionType;
  };
}

interface NotificationsPopupProps {
  readonly notifications: readonly Notification[];
  readonly onClear: (id: string) => void;
  readonly onClearAll: () => void;
  readonly onAction?: (type: NotificationActionType, notification: Notification) => void;
  readonly onClose: () => void;
  readonly anchorId?: string;
}

interface PopupClickEvent {
  readonly currentTarget: Readonly<{ dataset: Readonly<DOMStringMap> }>;
  readonly stopPropagation: () => void;
}

interface PopupMouseEvent {
  readonly target: EventTarget | null;
}

interface PopupKeyboardEvent {
  readonly key: string;
}

const getTypeIcon = (type: Notification["type"]) => {
  switch (type) {
    case "error": {
      return <XCircle className="h-4 w-4 text-primary" />;
    }
    case "warning": {
      return <AlertTriangle className="h-4 w-4 text-primary/80" />;
    }
    case "success": {
      return <CheckCircle2 className="h-4 w-4 text-foreground/70" />;
    }
    case "info":
    default: {
      return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  }
};

const NotificationsPopup = (props: NotificationsPopupProps) => {
  const { notifications, onClear, onClearAll, onAction, onClose, anchorId } = props;
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
        if (hasText(notificationId)) {
          onClear(notificationId);
        }
      },
      [onClear],
    );
  const popupRef = useRef<HTMLDialogElement>(null);
  const unreadCount = notifications.filter(
      (item) => item.type === "error" || item.type === "warning",
    ).length;

  useEffect(() => {
    popupRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: Readonly<PopupMouseEvent>) => {
        const target = event.target;
        if (
          popupRef.current &&
          target instanceof globalThis.Node &&
          !popupRef.current.contains(target) &&
          (!hasText(anchorId) || globalThis.document.querySelector(`#${anchorId}`)?.contains(target) !== true)
        ) {
          onClose();
        }
      },
      handleEscape = (event: Readonly<PopupKeyboardEvent>) => {
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
  }, [anchorId, onClose]);

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
      <Card className="w-full overflow-hidden rounded-lg border border-white/10 bg-[var(--news-bg-secondary)]/95 shadow-2xl backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between border-b border-white/10 p-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            <CardTitle className="font-mono text-sm uppercase tracking-[0.3em] text-muted-foreground">
              Notifications
            </CardTitle>
            {unreadCount > 0 && (
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-primary"
              >
                {unreadCount}
              </Badge>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Close notifications"
          >
            <X className="h-4 w-4" />
          </button>
        </CardHeader>

        <CardContent className="p-0">
          {(() => {
  if (notifications.length > 0) {
    return <div className="flex max-h-[min(30rem,calc(100vh-7rem))] flex-col overflow-y-auto">
              {notifications.map(notification => <article key={notification.id} className="group relative border-b border-white/10 p-4 hover:bg-[var(--news-bg-primary)]">
                  <div className="flex items-start gap-3 pr-7">
                    <div className="mt-0.5">{getTypeIcon(notification.type)}</div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold">{notification.title}</h3>
                          {hasText(notification.timestamp) && <time className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                              {new Date(notification.timestamp).toLocaleTimeString()}
                            </time>}
                        </div>
                        {notification.action && <button type="button" data-notification-id={notification.id} onClick={handleNotificationAction} className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-primary hover:underline">
                            {notification.action.label}
                          </button>}
                      </div>

                      <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {notification.description}
                      </p>

                      {notification.meta && <dl className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                          {Object.entries(notification.meta).map(([label, value]) => <div key={label} className="flex items-center justify-between gap-2">
                              <dt className="text-[10px] uppercase tracking-wide">{label}</dt>
                              <dd className="font-mono text-[11px]">{String(value)}</dd>
                            </div>)}
                        </dl>}
                    </div>
                  </div>

                  <button type="button" data-notification-id={notification.id} onClick={handleClearNotification} className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label={`Clear ${notification.title}`}>
                    <XCircle className="h-4 w-4" />
                  </button>
                </article>)}

              <div className="p-3 text-center">
                <button type="button" onClick={onClearAll} className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  Clear all notifications
                </button>
              </div>
            </div>;
  }
  return <div className="p-8 text-center">
              <Bell className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-sm font-medium text-muted-foreground">
                You&apos;re all caught up.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">No new notifications.</p>
            </div>;
})()}
        </CardContent>
      </Card>
    </dialog>,
    portalTarget,
  );
};
export { NotificationsPopup };
export type { NotificationActionType, Notification };
