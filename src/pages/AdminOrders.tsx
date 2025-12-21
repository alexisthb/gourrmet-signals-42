import { ShoppingCart, FileText, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function AdminOrders() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ShoppingCart className="h-6 w-6 text-primary" />
          Gestion Commandes
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Interface de gestion des commandes B2B (à implémenter)
        </p>
      </div>
      <Card className="border-dashed">
        <CardContent className="p-12 text-center">
          <ShoppingCart className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="font-semibold text-lg">Module en développement</h3>
          <p className="text-muted-foreground mt-2 max-w-md mx-auto">
            L'interface de gestion des commandes clients sera disponible prochainement.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
