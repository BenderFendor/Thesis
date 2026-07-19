"use client"

import { useEffect, useRef, type RefObject } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export type NotificationActionType = "retry" | "open-debug" | "refresh"

export interface Notification {
  id: string
  title: string
  description: string
  type: "error" | "warning" | "info" | "success"
  timestamp?: string
  meta?: Record<string, string | number>
  action?: {
    label: string
    type: NotificationActionType
  }
}

interface NotificationsPopupProps {
  notifications: Notification[]
  onClear: (id: string) => void
  onClearAll: () => void
  onAction?: (type: NotificationActionType, notification: Notification) => void
  onClose: () => void
  anchorRef?: RefObject<HTMLButtonElement | null>
}

function getTypeIcon(type: Notification["type"]) {
  switch (type) {
    case "error":
      return <XCircle className="h-4 w-4 text-primary" />
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-primary/80" />
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-foreground/70" />
    default:
      return <Info className="h-4 w-4 text-muted-foreground" />
  }
}

export function NotificationsPopup({
  notifications,
  onClear,
  onClearAll,
  onAction,
  onClose,
  anchorRef,
}: NotificationsPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null)
  const unreadCount = notifications.filter(
    (item) => item.type === "error" || item.type === "warning",
  ).length

  const handleNotificationAction = (notification: Notification) => {
    const action = notification.action
    if (action) {
      onAction?.(action.type, notification)
    }
  }

  useEffect(() => {
    popupRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        popupRef.current &&
        !popupRef.current.contains(target) &&
        (!anchorRef?.current || !anchorRef.current.contains(target))
      ) {
        onClose()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleEscape)

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [anchorRef, onClose])

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      ref={popupRef}
      role="dialog"
      aria-label="Notifications"
      aria-live="polite"
      tabIndex={-1}
      className="fixed inset-x-3 top-16 z-[100] outline-none sm:left-auto sm:right-4 sm:w-96"
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
          {notifications.length > 0 ? (
            <div className="flex max-h-[min(30rem,calc(100vh-7rem))] flex-col overflow-y-auto">
              {notifications.map((notification) => (
                <article key={notification.id} className="group relative border-b border-white/10 p-4 hover:bg-[var(--news-bg-primary)]">
                  <div className="flex items-start gap-3 pr-7">
                    <div className="mt-0.5">{getTypeIcon(notification.type)}</div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold">{notification.title}</h3>
                          {notification.timestamp && (
                            <time className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                              {new Date(notification.timestamp).toLocaleTimeString()}
                            </time>
                          )}
                        </div>
                        {notification.action && (
                          <button
                            type="button"
                            onClick={() => handleNotificationAction(notification)}
                            className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-primary hover:underline"
                          >
                            {notification.action.label}
                          </button>
                        )}
                      </div>

                      <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {notification.description}
                      </p>

                      {notification.meta && (
                        <dl className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                          {Object.entries(notification.meta).map(([label, value]) => (
                            <div key={label} className="flex items-center justify-between gap-2">
                              <dt className="text-[10px] uppercase tracking-wide">{label}</dt>
                              <dd className="font-mono text-[11px]">{String(value)}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onClear(notification.id)
                    }}
                    className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                    aria-label={`Clear ${notification.title}`}
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </article>
              ))}

              <div className="p-3 text-center">
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Clear all notifications
                </button>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center">
              <Bell className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-sm font-medium text-muted-foreground">You&apos;re all caught up.</p>
              <p className="mt-1 text-xs text-muted-foreground">No new notifications.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>,
    document.body,
  )
}
