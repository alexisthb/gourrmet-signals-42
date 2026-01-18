import { useState } from 'react';
import { Plus, User, Briefcase, Building2, Mail, Phone, Linkedin, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { useAddEventContact, useEvents } from '@/hooks/useEvents';

export function AddEventContactFromListDialog() {
  const [open, setOpen] = useState(false);
  const { data: events, isLoading: eventsLoading } = useEvents();
  const addContact = useAddEventContact();

  const [formData, setFormData] = useState({
    event_id: '',
    full_name: '',
    first_name: '',
    last_name: '',
    job_title: '',
    company_name: '',
    email: '',
    phone: '',
    linkedin_url: '',
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.full_name.trim() || !formData.event_id) return;

    await addContact.mutateAsync({
      event_id: formData.event_id,
      full_name: formData.full_name.trim(),
      first_name: formData.first_name.trim() || null,
      last_name: formData.last_name.trim() || null,
      job_title: formData.job_title.trim() || null,
      company_name: formData.company_name.trim() || null,
      email: formData.email.trim() || null,
      phone: formData.phone.trim() || null,
      linkedin_url: formData.linkedin_url.trim() || null,
      notes: formData.notes.trim() || null,
      outreach_status: 'not_contacted',
    });

    setFormData({
      event_id: '',
      full_name: '',
      first_name: '',
      last_name: '',
      job_title: '',
      company_name: '',
      email: '',
      phone: '',
      linkedin_url: '',
      notes: '',
    });
    setOpen(false);
  };

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleNameChange = (field: 'first_name' | 'last_name') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFormData(prev => {
      const newData = { ...prev, [field]: value };
      const firstName = field === 'first_name' ? value : prev.first_name;
      const lastName = field === 'last_name' ? value : prev.last_name;
      newData.full_name = `${firstName} ${lastName}`.trim();
      return newData;
    });
  };

  const selectedEvent = events?.find(e => e.id === formData.event_id);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-lg shadow-amber-500/20">
          <Plus className="h-4 w-4 mr-2" />
          Ajouter un contact
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-amber-500" />
              Nouveau contact événementiel
            </DialogTitle>
            <DialogDescription>
              Ajouter un contact rencontré lors d'un événement
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Event selector */}
            <div className="space-y-2">
              <Label htmlFor="event" className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Événement <span className="text-destructive">*</span>
              </Label>
              <Select 
                value={formData.event_id} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, event_id: value }))}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Sélectionner un événement" />
                </SelectTrigger>
                <SelectContent>
                  {eventsLoading ? (
                    <SelectItem value="loading" disabled>Chargement...</SelectItem>
                  ) : events && events.length > 0 ? (
                    events.map(event => (
                      <SelectItem key={event.id} value={event.id}>
                        {event.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="none" disabled>Aucun événement</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {selectedEvent && (
                <p className="text-xs text-muted-foreground">
                  {selectedEvent.type} • {selectedEvent.location}
                </p>
              )}
            </div>

            {/* Nom */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="first_name">Prénom</Label>
                <Input
                  id="first_name"
                  placeholder="Jean"
                  value={formData.first_name}
                  onChange={handleNameChange('first_name')}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Nom</Label>
                <Input
                  id="last_name"
                  placeholder="Dupont"
                  value={formData.last_name}
                  onChange={handleNameChange('last_name')}
                  className="rounded-xl"
                />
              </div>
            </div>

            {/* Job & Company */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="job_title" className="flex items-center gap-1">
                  <Briefcase className="h-3 w-3" />
                  Poste
                </Label>
                <Input
                  id="job_title"
                  placeholder="Directeur Commercial"
                  value={formData.job_title}
                  onChange={handleChange('job_title')}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company_name" className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  Entreprise
                </Label>
                <Input
                  id="company_name"
                  placeholder="Acme Corp"
                  value={formData.company_name}
                  onChange={handleChange('company_name')}
                  className="rounded-xl"
                />
              </div>
            </div>

            {/* Contact info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="jean@acme.com"
                  value={formData.email}
                  onChange={handleChange('email')}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  Téléphone
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+33 6 12 34 56 78"
                  value={formData.phone}
                  onChange={handleChange('phone')}
                  className="rounded-xl"
                />
              </div>
            </div>

            {/* LinkedIn */}
            <div className="space-y-2">
              <Label htmlFor="linkedin_url" className="flex items-center gap-1">
                <Linkedin className="h-3 w-3" />
                Profil LinkedIn
              </Label>
              <Input
                id="linkedin_url"
                placeholder="https://linkedin.com/in/jeandupont"
                value={formData.linkedin_url}
                onChange={handleChange('linkedin_url')}
                className="rounded-xl"
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Notes sur le contact, contexte de la rencontre..."
                value={formData.notes}
                onChange={handleChange('notes')}
                rows={3}
                className="rounded-xl"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-xl">
              Annuler
            </Button>
            <Button 
              type="submit" 
              disabled={!formData.full_name.trim() || !formData.event_id || addContact.isPending}
              className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
            >
              {addContact.isPending ? 'Ajout...' : 'Ajouter le contact'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
