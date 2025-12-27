import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Presentation as PresentationIcon, Plus, Play, MoreHorizontal, Pencil, Trash2, FileText, Image, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { usePresentations, useDeletePresentation } from '@/hooks/usePresentations';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { PresentationDialog } from '@/components/PresentationDialog';

const MAX_SLOTS = 10;

export default function PresentationsList() {
  const { data: presentations, isLoading } = usePresentations();
  const deletePresentation = useDeletePresentation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleEdit = (id: string) => {
    setEditingId(id);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (deleteId) {
      await deletePresentation.mutateAsync(deleteId);
      setDeleteId(null);
    }
  };

  const emptySlots = Math.max(0, MAX_SLOTS - (presentations?.length || 0));

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">GOUR<span className="text-primary">Я</span>MET Présentations</h1>
          <p className="text-muted-foreground mt-1">
            Gérez vos présentations commerciales et marketing
          </p>
        </div>
        {(presentations?.length || 0) < MAX_SLOTS && (
          <Button onClick={() => { setEditingId(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Nouvelle Présentation
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {presentations?.map((presentation, index) => (
          <Card key={presentation.id} className="group hover:shadow-lg transition-all overflow-hidden">
            <div className="relative aspect-video bg-muted">
              {presentation.thumbnail_url ? (
                <img
                  src={presentation.thumbnail_url}
                  alt={presentation.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                  {presentation.file_type === 'pdf' ? (
                    <FileText className="h-12 w-12 text-primary/50" />
                  ) : (
                    <Image className="h-12 w-12 text-primary/50" />
                  )}
                </div>
              )}
              
              {/* Overlay with play button */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Link to={`/presentations/${presentation.id}/view`}>
                  <Button size="lg" className="rounded-full h-14 w-14">
                    <Play className="h-6 w-6 ml-1" />
                  </Button>
                </Link>
              </div>

              {/* Order badge */}
              <div className="absolute top-2 left-2">
                <Badge variant="secondary" className="bg-background/80 backdrop-blur-sm">
                  <GripVertical className="h-3 w-3 mr-1" />
                  {index + 1}
                </Badge>
              </div>

              {/* Actions menu */}
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="icon" className="h-8 w-8 bg-background/80 backdrop-blur-sm">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleEdit(presentation.id)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Modifier
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setDeleteId(presentation.id)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Status badge */}
              {!presentation.is_active && (
                <div className="absolute bottom-2 left-2">
                  <Badge variant="outline" className="bg-background/80 backdrop-blur-sm text-muted-foreground">
                    Désactivée
                  </Badge>
                </div>
              )}
            </div>
            <CardContent className="p-4">
              <h3 className="font-semibold truncate">{presentation.title}</h3>
              {presentation.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                  {presentation.description}
                </p>
              )}
              <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                {presentation.file_type && (
                  <Badge variant="outline" className="uppercase">
                    {presentation.file_type}
                  </Badge>
                )}
                {presentation.slides_count && presentation.slides_count > 0 && (
                  <span>{presentation.slides_count} slides</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Empty slots */}
        {Array.from({ length: emptySlots }).map((_, index) => (
          <Card 
            key={`empty-${index}`} 
            className="border-dashed cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
            onClick={() => { setEditingId(null); setDialogOpen(true); }}
          >
            <div className="aspect-video flex items-center justify-center">
              <div className="text-center">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <Plus className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">Emplacement {(presentations?.length || 0) + index + 1}</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Cliquez pour ajouter</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <PresentationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        presentationId={editingId}
      />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette présentation ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le fichier sera également supprimé.
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
