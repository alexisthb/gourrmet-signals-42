import { FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function AdminProducts() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" />
          Catalogue Produits
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestion du catalogue (Chapon, Durance, ELY, Plantin)
        </p>
      </div>
      <Card className="border-dashed">
        <CardContent className="p-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="font-semibold text-lg">Module en développement</h3>
          <p className="text-muted-foreground mt-2">Le catalogue produits sera disponible prochainement.</p>
        </CardContent>
      </Card>
    </div>
  );
}
