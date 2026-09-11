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

type NotificationActionType = "retry" | "open-debug" | "refresh";

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

export type {
  Notification,
  NotificationActionType,
  NotificationsPopupProps,
  PopupClickEvent,
  PopupKeyboardEvent,
  PopupMouseEvent,
};
