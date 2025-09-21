import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function SettingsPage() {
  return (
    <div className="min-h-screen p-8" style={{ backgroundColor: 'var(--news-bg-primary)', color: 'white' }}>
      <div className="container mx-auto">
        <h1 className="text-4xl font-bold mb-8">Settings</h1>
        <Card style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
          <CardHeader>
            <CardTitle>Account Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Manage your account settings here.</p>
            <Button className="mt-4">Save Changes</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
