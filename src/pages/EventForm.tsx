import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, MapPin, Globe, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateEvent, useUpdateEvent, useEvent } from '@/hooks/useEvents';

export default function EventForm() {
  const navigate = useNavigate();
  // Mode édition si /events/:id/edit (id présent), sinon création.
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const { data: existing } = useEvent(id || '');
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const isSubmitting = createEvent.isPending || updateEvent.isPending;

  const [formData, setFormData] = useState({
    name: '',
    type: 'salon',
    date_start: '',
    date_end: '',
    location: '',
    address: '',
    description: '',
    website_url: '',
  });

  // Préremplir le formulaire en mode édition une fois l'événement chargé.
  useEffect(() => {
    if (existing) {
      setFormData({
        name: existing.name ?? '',
        type: existing.type ?? 'salon',
        date_start: existing.date_start ? existing.date_start.slice(0, 10) : '',
        date_end: existing.date_end ? existing.date_end.slice(0, 10) : '',
        location: existing.location ?? '',
        address: existing.address ?? '',
        description: existing.description ?? '',
        website_url: existing.website_url ?? '',
      });
    }
  }, [existing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Champs nullable : chaîne vide -> null.
    const payload = {
      name: formData.name.trim(),
      type: formData.type,
      date_start: formData.date_start,
      date_end: formData.date_end || null,
      location: formData.location.trim(),
      address: formData.address.trim() || null,
      description: formData.description.trim() || null,
      website_url: formData.website_url.trim() || null,
    };

    try {
      if (isEdit && id) {
        await updateEvent.mutateAsync({ id, ...payload });
      } else {
        await createEvent.mutateAsync({ ...payload, status: 'planned', notes: null });
      }
      navigate(isEdit && id ? `/events/${id}` : '/events');
    } catch {
      // Le toast d'erreur est géré par le hook (onError).
    }
  };

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/events">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isEdit ? 'Modifier l\'événement' : 'Nouvel événement'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isEdit ? 'Mettez à jour les informations de cet événement' : 'Ajoutez un salon, une conférence ou un événement professionnel'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informations générales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nom de l'événement *</Label>
              <Input
                id="name"
                placeholder="Ex: OMYAGUE 2025"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Type d'événement</Label>
              <Select value={formData.type} onValueChange={(value) => updateField('type', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salon">Salon professionnel</SelectItem>
                  <SelectItem value="conference">Conférence</SelectItem>
                  <SelectItem value="networking">Networking</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date_start">Date de début *</Label>
                <Input
                  id="date_start"
                  type="date"
                  value={formData.date_start}
                  onChange={(e) => updateField('date_start', e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date_end">Date de fin</Label>
                <Input
                  id="date_end"
                  type="date"
                  value={formData.date_end}
                  onChange={(e) => updateField('date_end', e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Lieu *</Label>
              <Input
                id="location"
                placeholder="Ex: Paris Expo Porte de Versailles"
                value={formData.location}
                onChange={(e) => updateField('location', e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Adresse complète</Label>
              <Input
                id="address"
                placeholder="Ex: Hall 7.3, 1 Place de la Porte de Versailles, 75015 Paris"
                value={formData.address}
                onChange={(e) => updateField('address', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="website_url">Site web</Label>
              <Input
                id="website_url"
                type="url"
                placeholder="https://..."
                value={formData.website_url}
                onChange={(e) => updateField('website_url', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Décrivez l'événement, les thématiques abordées..."
                value={formData.description}
                onChange={(e) => updateField('description', e.target.value)}
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 mt-6">
          <Link to="/events">
            <Button variant="outline" type="button">
              Annuler
            </Button>
          </Link>
          <Button type="submit" disabled={isSubmitting || !formData.name || !formData.date_start || !formData.location}>
            {isSubmitting ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer l\'événement'}
          </Button>
        </div>
      </form>
    </div>
  );
}
