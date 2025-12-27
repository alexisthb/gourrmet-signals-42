import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, Globe, Linkedin, Instagram, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePartnerHouses, useDeletePartnerHouse } from '@/hooks/usePartnerHouses';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { PartnerHouseDialog } from '@/components/PartnerHouseDialog';

export default function PartnersList() {
  const { data: houses, isLoading } = usePartnerHouses();
  const deleteHouse = useDeletePartnerHouse();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingHouse, setEditingHouse] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleEdit = (id: string) => {
    setEditingHouse(id);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (deleteId) {
      await deleteHouse.mutateAsync(deleteId);
      setDeleteId(null);
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Maisons Partenaires</h1>
          <p className="text-muted-foreground mt-1">
            Gérez vos maisons partenaires et suivez leur actualité
          </p>
        </div>
        <Button onClick={() => { setEditingHouse(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle Maison
        </Button>
      </div>

      {!houses || houses.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Aucune maison partenaire"
          description="Ajoutez votre première maison partenaire pour commencer à suivre son actualité."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter une Maison
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {houses.map((house) => (
            <Card key={house.id} className="group hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <Link to={`/partners/${house.id}`} className="flex-1">
                    <div className="flex items-center gap-3">
                      {house.logo_url ? (
                        <img
                          src={house.logo_url}
                          alt={house.name}
                          className="h-12 w-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Building2 className="h-6 w-6 text-primary" />
                        </div>
                      )}
                      <div>
                        <h3 className="font-semibold hover:text-primary transition-colors">
                          {house.name}
                        </h3>
                        {house.category && (
                          <Badge variant="secondary" className="mt-1 text-xs">
                            {house.category}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(house.id)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Modifier
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDeleteId(house.id)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Supprimer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                {house.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {house.description}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  {house.website_url && (
                    <a
                      href={house.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Globe className="h-4 w-4" />
                    </a>
                  )}
                  {house.linkedin_url && (
                    <a
                      href={house.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Linkedin className="h-4 w-4" />
                    </a>
                  )}
                  {house.instagram_url && (
                    <a
                      href={house.instagram_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Instagram className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <PartnerHouseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        houseId={editingHouse}
      />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette maison ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Toutes les actualités associées seront également supprimées.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
