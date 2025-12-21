import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { 
  ArrowLeft, 
  Calendar, 
  MapPin, 
  Users, 
  ExternalLink,
  Edit,
  Plus,
  Trash2,
  Clock,
  CheckCircle2,
  MessageSquare
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/EmptyState';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

interface EventContact {
  id: string;
  full_name: string;
  job_title?: string;
  company_name?: string;
  email?: string;
  linkedin_url?: string;
  notes?: string;
  created_at: string;
}

// Mock event data
const mockEvent = {
  id: '1',
  name: 'OMYAGUE',
  type: 'salon' as const,
  date_start: new Date(2025, 2, 15).toISOString(),
  date_end: new Date(2025, 2, 17).toISOString(),
  location: 'Paris Expo Porte de Versailles',
  address: 'Hall 7.3, Porte de Versailles, 75015 Paris',
  description: 'Salon professionnel du cadeau d\'affaires et de la communication par l\'objet. Plus de 300 exposants, 10 000 visiteurs professionnels.',
  website_url: 'https://www.omyague.com',
  status: 'planned' as const,
  notes: '',
};

const mockContacts: EventContact[] = [];

export default function EventDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const [event] = useState(mockEvent);
  const [contacts] = useState<EventContact[]>(mockContacts);
  const [notes, setNotes] = useState(event.notes);

  const handleSaveNotes = () => {
    toast({
      title: 'Notes sauvegardées',
      description: 'Vos notes ont été mises à jour.',
    });
  };

  const handleMarkAttended = () => {
    toast({
      title: 'Événement marqué comme participé',
      description: 'Vous pouvez maintenant ajouter les contacts rencontrés.',
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/events">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">{event.name}</h1>
              <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                Salon
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              {event.location}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {event.status === 'planned' && (
            <Button variant="outline" onClick={handleMarkAttended}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Marquer participé
            </Button>
          )}
          <Button variant="outline" size="icon">
            <Edit className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Event info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Informations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Date</div>
                  <div className="font-medium flex items-center gap-2 mt-1">
                    <Calendar className="h-4 w-4 text-primary" />
                    {format(new Date(event.date_start), 'd MMMM yyyy', { locale: fr })}
                    {event.date_end && ` - ${format(new Date(event.date_end), 'd MMMM yyyy', { locale: fr })}`}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Lieu</div>
                  <div className="font-medium mt-1">{event.address || event.location}</div>
                </div>
              </div>
              
              {event.description && (
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Description</div>
                  <p className="text-sm">{event.description}</p>
                </div>
              )}

              {event.website_url && (
                <a 
                  href={event.website_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  Voir le site web
                </a>
              )}
            </CardContent>
          </Card>

          {/* Contacts */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Contacts rencontrés</CardTitle>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Ajouter contact
              </Button>
            </CardHeader>
            <CardContent>
              {contacts.length > 0 ? (
                <div className="space-y-3">
                  {contacts.map((contact) => (
                    <div key={contact.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                      <div>
                        <div className="font-medium">{contact.full_name}</div>
                        <div className="text-sm text-muted-foreground">
                          {contact.job_title} {contact.company_name && `• ${contact.company_name}`}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm">
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Aucun contact"
                  description="Ajoutez les contacts rencontrés lors de cet événement."
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Statut</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                {event.status === 'planned' ? (
                  <>
                    <Clock className="h-5 w-5 text-amber-500" />
                    <div>
                      <div className="font-medium">Planifié</div>
                      <div className="text-sm text-muted-foreground">
                        Dans {Math.ceil((new Date(event.date_start).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} jours
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-success" />
                    <div>
                      <div className="font-medium">Participé</div>
                      <div className="text-sm text-muted-foreground">
                        {contacts.length} contacts collectés
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="Ajoutez vos notes sur cet événement..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
              />
              <Button size="sm" onClick={handleSaveNotes} className="w-full">
                Sauvegarder
              </Button>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Statistiques</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Contacts</span>
                  <span className="font-medium">{contacts.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Messages envoyés</span>
                  <span className="font-medium">0</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Réponses</span>
                  <span className="font-medium">0</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
