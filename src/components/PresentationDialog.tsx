import { useEffect, useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Upload, FileText, Image, X } from 'lucide-react';
import { 
  usePresentation, 
  useCreatePresentation, 
  useUpdatePresentation,
  useUploadPresentationFile,
  useUploadThumbnail
} from '@/hooks/usePresentations';
import { cn } from '@/lib/utils';

interface PresentationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presentationId: string | null;
}

export function PresentationDialog({ open, onOpenChange, presentationId }: PresentationDialogProps) {
  const { data: presentation } = usePresentation(presentationId || undefined);
  const createPresentation = useCreatePresentation();
  const updatePresentation = useUpdatePresentation();
  const uploadFile = useUploadPresentationFile();
  const uploadThumbnail = useUploadThumbnail();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    file_type: 'pdf',
    slides_count: 1,
    is_active: true,
    display_order: 0,
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedThumbnail, setSelectedThumbnail] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (presentation && presentationId) {
      setFormData({
        title: presentation.title || '',
        description: presentation.description || '',
        file_type: presentation.file_type || 'pdf',
        slides_count: presentation.slides_count || 1,
        is_active: presentation.is_active ?? true,
        display_order: presentation.display_order || 0,
      });
    } else if (!presentationId) {
      setFormData({
        title: '',
        description: '',
        file_type: 'pdf',
        slides_count: 1,
        is_active: true,
        display_order: 0,
      });
      setSelectedFile(null);
      setSelectedThumbnail(null);
    }
  }, [presentation, presentationId, open]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // Auto-detect file type
      if (file.type === 'application/pdf') {
        setFormData(prev => ({ ...prev, file_type: 'pdf' }));
      } else if (file.type.startsWith('image/')) {
        setFormData(prev => ({ ...prev, file_type: 'image' }));
      }
    }
  };

  const handleThumbnailSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedThumbnail(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUploading(true);

    try {
      let fileUrl = presentation?.file_url || null;
      let thumbnailUrl = presentation?.thumbnail_url || null;
      let newPresentationId = presentationId;

      // Create presentation first if new
      if (!presentationId) {
        const newPresentation = await createPresentation.mutateAsync({
          ...formData,
          file_url: null,
          thumbnail_url: null,
        });
        newPresentationId = newPresentation.id;
      }

      // Upload file if selected
      if (selectedFile && newPresentationId) {
        fileUrl = await uploadFile.mutateAsync({
          file: selectedFile,
          presentationId: newPresentationId,
        });
      }

      // Upload thumbnail if selected
      if (selectedThumbnail && newPresentationId) {
        thumbnailUrl = await uploadThumbnail.mutateAsync({
          file: selectedThumbnail,
          presentationId: newPresentationId,
        });
      }

      // Update with file URLs
      if (newPresentationId && (selectedFile || selectedThumbnail || presentationId)) {
        await updatePresentation.mutateAsync({
          id: newPresentationId,
          ...formData,
          file_url: fileUrl,
          thumbnail_url: thumbnailUrl,
        });
      }

      onOpenChange(false);
    } catch (error) {
      console.error('Error saving presentation:', error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>
            {presentationId ? 'Modifier la présentation' : 'Nouvelle Présentation'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titre *</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Présentation commerciale Q4 2024"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Description de la présentation..."
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="file_type">Type de fichier</Label>
              <Select
                value={formData.file_type}
                onValueChange={(value) => setFormData({ ...formData, file_type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      PDF
                    </div>
                  </SelectItem>
                  <SelectItem value="image">
                    <div className="flex items-center gap-2">
                      <Image className="h-4 w-4" />
                      Image
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="slides_count">Nombre de slides</Label>
              <Input
                id="slides_count"
                type="number"
                min={1}
                value={formData.slides_count}
                onChange={(e) => setFormData({ ...formData, slides_count: parseInt(e.target.value) || 1 })}
              />
            </div>
          </div>

          {/* File upload */}
          <div className="space-y-2">
            <Label>Fichier de présentation</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                "hover:border-primary/50 hover:bg-muted/30",
                selectedFile && "border-primary bg-primary/5"
              )}
            >
              {selectedFile ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText className="h-8 w-8 text-primary" />
                  <div className="text-left">
                    <p className="font-medium">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Cliquez pour uploader un fichier PDF ou image
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Thumbnail upload */}
          <div className="space-y-2">
            <Label>Miniature (optionnel)</Label>
            <input
              ref={thumbnailInputRef}
              type="file"
              accept="image/*"
              onChange={handleThumbnailSelect}
              className="hidden"
            />
            <div
              onClick={() => thumbnailInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
                "hover:border-primary/50 hover:bg-muted/30",
                selectedThumbnail && "border-primary bg-primary/5"
              )}
            >
              {selectedThumbnail ? (
                <div className="flex items-center justify-center gap-3">
                  <Image className="h-6 w-6 text-primary" />
                  <span className="font-medium">{selectedThumbnail.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => { e.stopPropagation(); setSelectedThumbnail(null); }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Cliquez pour ajouter une miniature
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
            <div>
              <Label htmlFor="is_active">Présentation active</Label>
              <p className="text-sm text-muted-foreground">Visible dans la liste</p>
            </div>
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={isUploading}>
              {isUploading ? 'Upload en cours...' : presentationId ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
