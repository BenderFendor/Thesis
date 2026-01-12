"use client";

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, XCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export type NotificationActionType = 'retry' | 'open-debug' | 'refresh';

export interface Notification {
  id: string;
  title: string;
  description: string;
  type: 'error' | 'warning' | 'info' | 'success';
  timestamp?: string;
  meta?: Record<string, string | number>;
  action?: {
    label: string;
    type: NotificationActionType;
  };
}

interface NotificationsPopupProps {
  notifications: Notification[];
  onClear: (id: string) => void;
  onClearAll: () => void;
  onAction?: (type: NotificationActionType, notification: Notification) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

const getTypeIcon = (type: Notification['type']) => {
  switch (type) {
    case 'error':
      return <XCircle className="w-4 h-4 text-primary" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-primary/80" />;
    case 'success':
      return <CheckCircle2 className="w-4 h-4 text-foreground/70" />;
    default:
      return <Info className="w-4 h-4 text-muted-foreground" />;
  }
};

export function NotificationsPopup({ notifications, onClear, onClearAll, onAction, onClose, anchorRef }: NotificationsPopupProps) {
  const unreadCount = notifications.filter(
    (item) => item.type === "error" || item.type === "warning"
  ).length;
  
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!anchorRef.current) return;
    
    const updatePosition = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top - 8,
        left: rect.right + 8,
      });
    };
    
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose, anchorRef]);

  if (!mounted) return null;

  const popup = (
    <div
      ref={popupRef}
      className="fixed z-[100]"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      <Card className="w-96 rounded-none shadow-2xl border border-white/10 bg-[var(--news-bg-secondary)]/95 backdrop-blur">
        <CardHeader className="flex flex-row items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            <CardTitle className="text-sm font-mono uppercase tracking-[0.3em] text-muted-foreground">Notifications</CardTitle>
          </div>
          {unreadCount > 0 && (
            <Badge variant="outline" className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.2em] border-primary/40 bg-primary/15 text-primary">{unreadCount}</Badge>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {notifications.length > 0 ? (
            <div className="flex flex-col max-h-96 overflow-y-auto">
              {notifications.map(notification => (
                <div key={notification.id} className="group relative">
                  <div className="flex items-start gap-3 p-4 border-b border-white/10 hover:bg-[var(--news-bg-primary)] transition-colors">
                    <div className="mt-0.5">
                      {getTypeIcon(notification.type)}
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-sm">{notification.title}</div>
                          {notification.timestamp && (
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {new Date(notification.timestamp).toLocaleTimeString()}
                            </div>
                          )}
                        </div>
                        {notification.action && (
                          <button
                            onClick={() => onAction?.(notification.action!.type, notification)}
                            className="text-[11px] font-semibold uppercase tracking-wide text-primary hover:underline"
                          >
                            {notification.action.label}
                          </button>
                        )}
                      </div>
                      <p className="text-xs whitespace-pre-wrap break-words max-h-24 overflow-y-auto" style={{ color: 'var(--muted-foreground)' }}>{notification.description}</p>
                      {notification.meta && (
                        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                          {Object.entries(notification.meta).map(([label, value]) => (
                            <div key={label} className="flex items-center justify-between gap-2">
                              <span className="uppercase tracking-wide text-[10px]">{label}</span>
                              <span className="font-mono text-[11px]">{String(value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); onClear(notification.id); }} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100">
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="p-2 text-center border-t border-white/10">
                  <button onClick={onClearAll} className="text-sm font-medium text-primary hover:underline">
                      Clear all notifications
                  </button>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center">
              <Bell className="mx-auto w-12 h-12 text-muted-foreground/50" />
              <p className="mt-4 text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>You're all caught up!</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>No new notifications.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return createPortal(popup, document.body);
}
