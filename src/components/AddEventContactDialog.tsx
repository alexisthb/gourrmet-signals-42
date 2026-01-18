import { useState } from 'react';
import { Plus, User, Briefcase, Building2, Mail, Phone, Linkedin } from 'lucide-react';
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
import { useAddEventContact } from '@/hooks/useEvents';

interface AddEventContactDialogProps {
  eventId: string;
  eventName: string;
  trigger?: React.ReactNode;
}

export function AddEventContactDialog({ eventId, eventName, trigger }: AddEventContactDialogProps) {
  const [open, setOpen] = useState(false);
  const addContact = useAddEventContact();

  const [formData, setFormData] = useState({
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
    
    if (!formData.full_name.trim()) return;

    await addContact.mutateAsync({
      event_id: eventId,
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

  // Auto-fill full_name when first/last name changes
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Ajouter contact
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              Nouveau contact
            </DialogTitle>
            <DialogDescription>
              Ajouter un contact rencontré lors de <span className="font-medium text-foreground">{eventName}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Nom */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="first_name">Prénom</Label>
                <Input
                  id="first_name"
                  placeholder="Jean"
                  value={formData.first_name}
                  onChange={handleNameChange('first_name')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Nom</Label>
                <Input
                  id="last_name"
                  placeholder="Dupont"
                  value={formData.last_name}
                  onChange={handleNameChange('last_name')}
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
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={!formData.full_name.trim() || addContact.isPending}>
              {addContact.isPending ? 'Ajout...' : 'Ajouter le contact'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
