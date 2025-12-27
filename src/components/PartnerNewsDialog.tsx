import { useEffect, useState } from 'react';
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
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCreatePartnerNews, useUpdatePartnerNews, PartnerNews } from '@/hooks/usePartnerHouses';
import { Package, Calendar, Newspaper, MessageSquare } from 'lucide-react';

interface PartnerNewsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  houseId: string;
  newsId: string | null;
}

const NEWS_TYPES = [
  { value: 'product', label: 'Nouveau Produit', icon: Package },
  { value: 'event', label: 'Événement', icon: Calendar },
  { value: 'press', label: 'Actualité Presse', icon: Newspaper },
  { value: 'social', label: 'Réseaux Sociaux', icon: MessageSquare },
];

export function PartnerNewsDialog({ open, onOpenChange, houseId, newsId }: PartnerNewsDialogProps) {
  const { data: news } = useQuery({
    queryKey: ['partner-news-item', newsId],
    queryFn: async () => {
      if (!newsId) return null;
      const { data, error } = await supabase
        .from('partner_news')
        .select('*')
        .eq('id', newsId)
        .single();
      if (error) throw error;
      return data as PartnerNews;
    },
    enabled: !!newsId,
  });

  const createNews = useCreatePartnerNews();
  const updateNews = useUpdatePartnerNews();

  const [formData, setFormData] = useState({
    title: '',
    content: '',
    news_type: 'product' as 'product' | 'event' | 'press' | 'social',
    image_url: '',
    source_url: '',
    published_at: new Date().toISOString().split('T')[0],
    event_date: '',
    event_location: '',
    product_name: '',
    product_category: '',
    is_featured: false,
  });

  useEffect(() => {
    if (news && newsId) {
      setFormData({
        title: news.title || '',
        content: news.content || '',
        news_type: news.news_type,
        image_url: news.image_url || '',
        source_url: news.source_url || '',
        published_at: news.published_at ? news.published_at.split('T')[0] : '',
        event_date: news.event_date || '',
        event_location: news.event_location || '',
        product_name: news.product_name || '',
        product_category: news.product_category || '',
        is_featured: news.is_featured ?? false,
      });
    } else if (!newsId) {
      setFormData({
        title: '',
        content: '',
        news_type: 'product',
        image_url: '',
        source_url: '',
        published_at: new Date().toISOString().split('T')[0],
        event_date: '',
        event_location: '',
        product_name: '',
        product_category: '',
        is_featured: false,
      });
    }
  }, [news, newsId, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const payload = {
      ...formData,
      house_id: houseId,
      published_at: formData.published_at ? new Date(formData.published_at).toISOString() : null,
      event_date: formData.event_date || null,
    };

    if (newsId) {
      await updateNews.mutateAsync({ id: newsId, ...payload });
    } else {
      await createNews.mutateAsync(payload);
    }
    
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {newsId ? 'Modifier l\'actualité' : 'Nouvelle Actualité'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="news_type">Type *</Label>
              <Select
                value={formData.news_type}
                onValueChange={(value: 'product' | 'event' | 'press' | 'social') => 
                  setFormData({ ...formData, news_type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NEWS_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex items-center gap-2">
                        <type.icon className="h-4 w-4" />
                        {type.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="published_at">Date de publication</Label>
              <Input
                id="published_at"
                type="date"
                value={formData.published_at}
                onChange={(e) => setFormData({ ...formData, published_at: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Titre *</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Titre de l'actualité"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Contenu</Label>
            <Textarea
              id="content"
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              placeholder="Description détaillée..."
              rows={4}
            />
          </div>

          {formData.news_type === 'product' && (
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="space-y-2">
                <Label htmlFor="product_name">Nom du produit</Label>
                <Input
                  id="product_name"
                  value={formData.product_name}
                  onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
                  placeholder="Cuvée Prestige 2020"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product_category">Catégorie</Label>
                <Input
                  id="product_category"
                  value={formData.product_category}
                  onChange={(e) => setFormData({ ...formData, product_category: e.target.value })}
                  placeholder="Champagne Millésimé"
                />
              </div>
            </div>
          )}

          {formData.news_type === 'event' && (
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="space-y-2">
                <Label htmlFor="event_date">Date de l'événement</Label>
                <Input
                  id="event_date"
                  type="date"
                  value={formData.event_date}
                  onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event_location">Lieu</Label>
                <Input
                  id="event_location"
                  value={formData.event_location}
                  onChange={(e) => setFormData({ ...formData, event_location: e.target.value })}
                  placeholder="Paris, France"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="image_url">URL de l'image</Label>
            <Input
              id="image_url"
              value={formData.image_url}
              onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
              placeholder="https://..."
              type="url"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="source_url">URL source</Label>
            <Input
              id="source_url"
              value={formData.source_url}
              onChange={(e) => setFormData({ ...formData, source_url: e.target.value })}
              placeholder="https://..."
              type="url"
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
            <div>
              <Label htmlFor="is_featured">Mettre à la une</Label>
              <p className="text-sm text-muted-foreground">Cette actualité apparaîtra en priorité</p>
            </div>
            <Switch
              id="is_featured"
              checked={formData.is_featured}
              onCheckedChange={(checked) => setFormData({ ...formData, is_featured: checked })}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={createNews.isPending || updateNews.isPending}>
              {newsId ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
