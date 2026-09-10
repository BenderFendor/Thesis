import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasText } from "@/lib/utils";
import type { Notification, PopupClickEvent } from "./notification-popup-types";

interface NotificationPopupCardProps {
  readonly notifications: readonly Notification[];
  readonly unreadCount: number;
  readonly onClearAll: () => void;
  readonly onClose: () => void;
  readonly handleNotificationAction: (event: Readonly<PopupClickEvent>) => void;
  readonly handleClearNotification: (event: Readonly<PopupClickEvent>) => void;
}

const NotificationPopupCard = (props: NotificationPopupCardProps) => {
  const {
    notifications,
    unreadCount,
    onClearAll,
    onClose,
    handleNotificationAction,
    handleClearNotification,
  } = props;
  const handleClose = onClose;
  const handleClearAll = onClearAll;
  return (
    <Card className="w-full overflow-hidden rounded-lg border border-white/10 bg-[var(--news-bg-secondary)]/95 shadow-2xl backdrop-blur-xl">
      <NotificationHeader unreadCount={unreadCount} onClose={handleClose} />
      <NotificationBody
        notifications={notifications}
        onClearAll={handleClearAll}
        handleNotificationAction={handleNotificationAction}
        handleClearNotification={handleClearNotification}
      />
    </Card>
  );
};

const NotificationHeader = ({
  unreadCount,
  onClose,
}: Readonly<{ unreadCount: number; onClose: () => void }>) => (
  <CardHeader className="flex flex-row items-center justify-between border-b border-white/10 p-4">
    <NotificationHeading unreadCount={unreadCount} />
    <button
      type="button"
      onClick={onClose}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label="Close notifications"
    >
      <X className="h-4 w-4" />
    </button>
  </CardHeader>
);

const NotificationHeading = ({ unreadCount }: Readonly<{ unreadCount: number }>) => (
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
);

const NotificationBody = (props: Omit<NotificationPopupCardProps, "unreadCount" | "onClose">) => {
  const { notifications, onClearAll, handleNotificationAction, handleClearNotification } = props;
  const handleClearAll = onClearAll;
  return (
    <CardContent className="p-0">
      <NotificationList
        notifications={notifications}
        onClearAll={handleClearAll}
        handleNotificationAction={handleNotificationAction}
        handleClearNotification={handleClearNotification}
      />
    </CardContent>
  );
};

const NotificationList = ({
  notifications,
  onClearAll,
  handleNotificationAction,
  handleClearNotification,
}: Omit<NotificationPopupCardProps, "unreadCount" | "onClose">) => {
  if (notifications.length === 0) {
    return <NotificationEmptyState />;
  }
  const handleClearAll = onClearAll;
  return (
    <div className="flex max-h-[min(30rem,calc(100vh-7rem))] flex-col overflow-y-auto">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          handleNotificationAction={handleNotificationAction}
          handleClearNotification={handleClearNotification}
        />
      ))}
      <ClearAllButton onClearAll={handleClearAll} />
    </div>
  );
};

const NotificationItem = ({
  notification,
  handleNotificationAction,
  handleClearNotification,
}: Readonly<{
  notification: Notification;
  handleNotificationAction: (event: Readonly<PopupClickEvent>) => void;
  handleClearNotification: (event: Readonly<PopupClickEvent>) => void;
}>) => (
  <article className="group relative border-b border-white/10 p-4 hover:bg-[var(--news-bg-primary)]">
    <NotificationItemBody
      notification={notification}
      handleNotificationAction={handleNotificationAction}
    />
    <button
      type="button"
      data-notification-id={notification.id}
      onClick={handleClearNotification}
      className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
      aria-label={`Clear ${notification.title}`}
    >
      <XCircle className="h-4 w-4" />
    </button>
  </article>
);

const NotificationItemBody = ({
  notification,
  handleNotificationAction,
}: Readonly<{
  notification: Notification;
  handleNotificationAction: (event: Readonly<PopupClickEvent>) => void;
}>) => (
  <div className="flex items-start gap-3 pr-7">
    <NotificationIcon type={notification.type} />
    <NotificationDetails
      notification={notification}
      handleNotificationAction={handleNotificationAction}
    />
  </div>
);

const NotificationIcon = ({ type }: Readonly<{ type: Notification["type"] }>) => (
  <div className="mt-0.5">{getTypeIcon(type)}</div>
);

const NotificationDetails = ({
  notification,
  handleNotificationAction,
}: Readonly<{
  notification: Notification;
  handleNotificationAction: (event: Readonly<PopupClickEvent>) => void;
}>) => (
  <div className="min-w-0 flex-1 space-y-2">
    <NotificationItemHeading
      notification={notification}
      handleNotificationAction={handleNotificationAction}
    />
    <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
      {notification.description}
    </p>
    <NotificationMeta meta={notification.meta} />
  </div>
);

const NotificationItemHeading = ({
  notification,
  handleNotificationAction,
}: Readonly<{
  notification: Notification;
  handleNotificationAction: (event: Readonly<PopupClickEvent>) => void;
}>) => (
  <div className="flex items-start justify-between gap-3">
    <NotificationText notification={notification} />
    {notification.action && (
      <button
        type="button"
        data-notification-id={notification.id}
        onClick={handleNotificationAction}
        className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-primary hover:underline"
      >
        {notification.action.label}
      </button>
    )}
  </div>
);

const NotificationText = ({ notification }: Readonly<{ notification: Notification }>) => (
  <div className="min-w-0">
    <h3 className="text-sm font-semibold">{notification.title}</h3>
    {hasText(notification.timestamp) && (
      <time className="block text-[10px] uppercase tracking-wide text-muted-foreground">
        {new Date(notification.timestamp).toLocaleTimeString()}
      </time>
    )}
  </div>
);

const NotificationMeta = ({
  meta,
}: Readonly<{ meta?: Readonly<Record<string, string | number>> }>) => {
  if (meta === undefined) {
    return null;
  }
  return (
    <dl className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
      {Object.entries(meta).map(([label, value]) => (
        <NotificationMetaRow key={label} label={label} value={String(value)} />
      ))}
    </dl>
  );
};

const NotificationMetaRow = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <div className="flex items-center justify-between gap-2">
    <dt className="text-[10px] uppercase tracking-wide">{label}</dt>
    <dd className="font-mono text-[11px]">{value}</dd>
  </div>
);

const NotificationEmptyState = () => (
  <div className="p-8 text-center">
    <Bell className="mx-auto h-12 w-12 text-muted-foreground/50" />
    <p className="mt-4 text-sm font-medium text-muted-foreground">You&apos;re all caught up.</p>
    <p className="mt-1 text-xs text-muted-foreground">No new notifications.</p>
  </div>
);

const ClearAllButton = ({ onClearAll }: Readonly<{ onClearAll: () => void }>) => (
  <div className="p-3 text-center">
    <button
      type="button"
      onClick={onClearAll}
      className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      Clear all notifications
    </button>
  </div>
);

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
    case "info": {
      return <Info className="h-4 w-4 text-muted-foreground" />;
    }
    default: {
      return <Info className="h-4 w-4 text-muted-foreground" />;
    }
  }
};

export { NotificationPopupCard };
