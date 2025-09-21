import { Bell, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface Notification {
  id: string;
  title: string;
  description: string;
  type: 'error' | 'info' | 'success';
}

interface NotificationsPopupProps {
  notifications: Notification[];
  onClear: (id: string) => void;
  onClearAll: () => void;
  onRetry: (error: string) => void;
}

export function NotificationsPopup({ notifications, onClear, onClearAll, onRetry }: NotificationsPopupProps) {
  const unreadCount = notifications.length;

  return (
    <Card className="absolute top-16 right-0 w-96 rounded-xl shadow-2xl z-50 border-2 backdrop-blur-xl" style={{ backgroundColor: 'rgba(var(--card-rgb), 0.8)', borderColor: 'var(--border)' }}>
      <CardHeader className="flex flex-row items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5" />
          <CardTitle className="text-lg font-semibold">Notifications</CardTitle>
        </div>
        {unreadCount > 0 && (
          <Badge variant="destructive" className="px-2.5 py-1 text-xs font-bold rounded-full">{unreadCount}</Badge>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {notifications.length > 0 ? (
          <div className="flex flex-col max-h-96 overflow-y-auto">
            {notifications.map(notification => (
              <div key={notification.id} className="group relative">
                <button onClick={() => onRetry(notification.description)} className="w-full text-left">
                  <div className="flex items-start gap-4 p-4 border-b hover:bg-muted/50 transition-colors" style={{ borderColor: 'var(--border)' }}>
                    <div className="mt-1">
                      <XCircle className="w-5 h-5 text-destructive" />
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-sm">{notification.title}</div>
                      <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>{notification.description}</p>
                    </div>
                  </div>
                </button>
                <button onClick={(e) => { e.stopPropagation(); onClear(notification.id); }} className="absolute top-1/2 right-4 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
            ))}
            <div className="p-2 text-center border-t" style={{ borderColor: 'var(--border)' }}>
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
  );
}
