import { Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function AdminClients() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          Gestion Clients
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestion des ~50 clients B2B
        </p>
      </div>
      <Card className="border-dashed">
        <CardContent className="p-12 text-center">
          <Users className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="font-semibold text-lg">Module en développement</h3>
          <p className="text-muted-foreground mt-2">La gestion clients sera disponible prochainement.</p>
        </CardContent>
      </Card>
    </div>
  );
}
