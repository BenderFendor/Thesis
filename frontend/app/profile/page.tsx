import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export default function ProfilePage() {
  return (
    <div className="min-h-screen p-8" style={{ backgroundColor: 'var(--news-bg-primary)', color: 'white' }}>
      <div className="container mx-auto">
        <h1 className="text-4xl font-bold mb-8">Profile</h1>
        <Card style={{ backgroundColor: 'var(--news-bg-secondary)', borderColor: 'var(--border)' }}>
          <CardHeader>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
                <AvatarFallback>CN</AvatarFallback>
              </Avatar>
              <div>
                <CardTitle className="text-2xl">Bender</CardTitle>
                <p style={{ color: 'var(--muted-foreground)' }}>Bender@Bender.com</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p>Welcome to your profile page.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
