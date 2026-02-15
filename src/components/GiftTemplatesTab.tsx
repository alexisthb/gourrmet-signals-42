import { useState } from 'react';
import { Gift, Upload, Trash2, GripVertical, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useGiftTemplates, useCreateGiftTemplate, useUpdateGiftTemplate, useDeleteGiftTemplate } from '@/hooks/useGiftTemplates';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function GiftTemplatesTab() {
  const { toast } = useToast();
  const { data: templates = [], isLoading } = useGiftTemplates(false);
  const createTemplate = useCreateGiftTemplate();
  const updateTemplate = useUpdateGiftTemplate();
  const deleteTemplate = useDeleteGiftTemplate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Fichier invalide', description: 'Veuillez sélectionner une image.', variant: 'destructive' });
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleAdd = async () => {
    if (!newName || !selectedFile) {
      toast({ title: 'Champs requis', description: 'Nom et image sont obligatoires.', variant: 'destructive' });
      return;
    }

    setUploading(true);
    try {
      const fileName = `template_${Date.now()}_${selectedFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from('gift-templates')
        .upload(fileName, selectedFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('gift-templates')
        .getPublicUrl(fileName);

      await createTemplate.mutateAsync({
        name: newName,
        description: newDescription || undefined,
        image_url: urlData.publicUrl,
        display_order: templates.length,
      });

      setDialogOpen(false);
      setNewName('');
      setNewDescription('');
      setSelectedFile(null);
      setPreviewUrl(null);
    } catch (error) {
      toast({ title: 'Erreur', description: "Impossible d'uploader l'image.", variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await updateTemplate.mutateAsync({ id, updates: { is_active: !isActive } });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Gift className="h-5 w-5 text-primary" />
                Photos de mise en scène
              </CardTitle>
              <CardDescription>
                Gérez les 8 photos templates utilisées pour les cadeaux personnalisés.
                Le logo de l'entreprise prospectée remplacera le logo existant sur la photo.
              </CardDescription>
            </div>
            <Button onClick={() => setDialogOpen(true)} disabled={templates.length >= 8}>
              <Upload className="h-4 w-4 mr-2" />
              Ajouter une photo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-border rounded-lg">
              <Gift className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">Aucune photo template ajoutée</p>
              <p className="text-sm text-muted-foreground mt-1">Ajoutez jusqu'à 8 photos de mise en scène</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className={`relative group rounded-lg border overflow-hidden transition-opacity ${!t.is_active ? 'opacity-50' : ''}`}
                >
                  {t.image_url && (
                    <img
                      src={t.image_url}
                      alt={t.name}
                      className="w-full aspect-square object-cover"
                    />
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end">
                    <div className="w-full p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-white text-sm font-medium truncate">{t.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-white hover:text-white hover:bg-white/20"
                          onClick={() => handleToggleActive(t.id, t.is_active)}
                        >
                          {t.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-white hover:text-red-400 hover:bg-white/20"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Supprimer ce template ?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Cette action est irréversible. La photo sera définitivement supprimée.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Annuler</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteTemplate.mutate(t.id)}>
                                Supprimer
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4">
            {templates.length}/8 photos • Les photos inactives ne seront pas proposées lors de la sélection.
          </p>
        </CardContent>
      </Card>

      {/* Add Template Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter une photo de mise en scène</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nom</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: Coffret Champagne Premium"
              />
            </div>
            <div>
              <Label>Description (optionnel)</Label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Description courte du produit"
              />
            </div>
            <div>
              <Label>Photo</Label>
              <Input
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="cursor-pointer"
              />
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="mt-2 rounded-lg max-h-48 object-cover"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={handleAdd} disabled={uploading || !newName || !selectedFile}>
              {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {uploading ? 'Upload...' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
