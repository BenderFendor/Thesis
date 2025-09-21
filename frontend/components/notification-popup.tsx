import { Bell } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const notifications = [
  {
    id: 1,
    title: 'New Feature Alert',
    description: 'We\'ve just launched a new feature that you might like.',
    time: '15m ago',
    read: false,
  },
  {
    id: 2,
    title: 'System Update',
    description: 'Our servers will be down for maintenance tonight.',
    time: '1h ago',
    read: true,
  },
  {
    id: 3,
    title: 'Your subscription is expiring soon',
    description: 'Please update your billing information.',
    time: '1d ago',
    read: false,
  },
];

export function NotificationsPopup() {
  return (
    <Card className="absolute top-12 right-0 w-80 rounded-lg shadow-lg z-50" style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-bold">Notifications</CardTitle>
        <Badge variant="destructive">{notifications.filter(n => !n.read).length} new</Badge>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {notifications.map(notification => (
            <div key={notification.id} className={`p-2 rounded-md ${notification.read ? '' : 'bg-primary/10'}`}>
              <div className="font-semibold">{notification.title}</div>
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>{notification.description}</p>
              <div className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>{notification.time}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
