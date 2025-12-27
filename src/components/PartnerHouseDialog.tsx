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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePartnerHouse, useCreatePartnerHouse, useUpdatePartnerHouse } from '@/hooks/usePartnerHouses';

interface PartnerHouseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  houseId: string | null;
}

const CATEGORIES = [
  'champagne',
  'vin',
  'spiritueux',
  'gastronomie',
  'luxe',
  'autre',
];

export function PartnerHouseDialog({ open, onOpenChange, houseId }: PartnerHouseDialogProps) {
  const { data: house } = usePartnerHouse(houseId || undefined);
  const createHouse = useCreatePartnerHouse();
  const updateHouse = useUpdatePartnerHouse();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'champagne',
    logo_url: '',
    website_url: '',
    linkedin_url: '',
    instagram_url: '',
    is_active: true,
  });

  useEffect(() => {
    if (house && houseId) {
      setFormData({
        name: house.name || '',
        description: house.description || '',
        category: house.category || 'champagne',
        logo_url: house.logo_url || '',
        website_url: house.website_url || '',
        linkedin_url: house.linkedin_url || '',
        instagram_url: house.instagram_url || '',
        is_active: house.is_active ?? true,
      });
    } else if (!houseId) {
      setFormData({
        name: '',
        description: '',
        category: 'champagne',
        logo_url: '',
        website_url: '',
        linkedin_url: '',
        instagram_url: '',
        is_active: true,
      });
    }
  }, [house, houseId, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (houseId) {
      await updateHouse.mutateAsync({ id: houseId, ...formData });
    } else {
      await createHouse.mutateAsync(formData);
    }
    
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {houseId ? 'Modifier la Maison' : 'Nouvelle Maison Partenaire'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nom *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Maison Exemple"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Catégorie</Label>
            <Select
              value={formData.category}
              onValueChange={(value) => setFormData({ ...formData, category: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Description de la maison..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="logo_url">URL du logo</Label>
            <Input
              id="logo_url"
              value={formData.logo_url}
              onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
              placeholder="https://..."
              type="url"
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label htmlFor="website_url">Site web</Label>
              <Input
                id="website_url"
                value={formData.website_url}
                onChange={(e) => setFormData({ ...formData, website_url: e.target.value })}
                placeholder="https://..."
                type="url"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="linkedin_url">LinkedIn</Label>
              <Input
                id="linkedin_url"
                value={formData.linkedin_url}
                onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })}
                placeholder="https://linkedin.com/company/..."
                type="url"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="instagram_url">Instagram</Label>
              <Input
                id="instagram_url"
                value={formData.instagram_url}
                onChange={(e) => setFormData({ ...formData, instagram_url: e.target.value })}
                placeholder="https://instagram.com/..."
                type="url"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={createHouse.isPending || updateHouse.isPending}>
              {houseId ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
