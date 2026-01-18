import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { 
  ArrowLeft, 
  Calendar, 
  MapPin, 
  ExternalLink,
  Edit,
  Clock,
  CheckCircle2,
  MessageSquare,
  Mail,
  Phone,
  Linkedin,
  Copy
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { AddEventContactDialog } from '@/components/AddEventContactDialog';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useEvent, useEventContacts, useUpdateEvent } from '@/hooks/useEvents';
import { toast } from 'sonner';

const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  salon: { label: 'Salon', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  conference: { label: 'Conférence', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  workshop: { label: 'Workshop', color: 'bg-purple-100 text-purple-800 border-purple-200' },
  networking: { label: 'Networking', color: 'bg-green-100 text-green-800 border-green-200' },
  other: { label: 'Autre', color: 'bg-gray-100 text-gray-800 border-gray-200' },
};

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast: toastUI } = useToast();
  const { data: event, isLoading: eventLoading } = useEvent(id || '');
  const { data: contacts = [], isLoading: contactsLoading } = useEventContacts(id || '');
  const updateEvent = useUpdateEvent();
  
  const [notes, setNotes] = useState('');
  const [notesInitialized, setNotesInitialized] = useState(false);

  // Initialize notes when event loads
  if (event && !notesInitialized) {
    setNotes(event.notes || '');
    setNotesInitialized(true);
  }

  const handleSaveNotes = async () => {
    if (!id) return;
    await updateEvent.mutateAsync({ id, notes });
    toastUI({
      title: 'Notes sauvegardées',
      description: 'Vos notes ont été mises à jour.',
    });
  };

  const handleMarkAttended = async () => {
    if (!id) return;
    await updateEvent.mutateAsync({ id, status: 'attended' });
    toastUI({
      title: 'Événement marqué comme participé',
      description: 'Vous pouvez maintenant ajouter les contacts rencontrés.',
    });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copié`);
  };

  if (eventLoading) {
    return <LoadingSpinner />;
  }

  if (!event) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <EmptyState
          title="Événement introuvable"
          description="Cet événement n'existe pas ou a été supprimé."
        />
      </div>
    );
  }

  const typeConfig = EVENT_TYPE_CONFIG[event.type] || EVENT_TYPE_CONFIG.other;
  const daysUntil = Math.ceil((new Date(event.date_start).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

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
              <Badge variant="outline" className={typeConfig.color}>
                {typeConfig.label}
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
            <Button variant="outline" onClick={handleMarkAttended} disabled={updateEvent.isPending}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Marquer participé
            </Button>
          )}
          <Link to={`/events/${id}/edit`}>
            <Button variant="outline" size="icon">
              <Edit className="h-4 w-4" />
            </Button>
          </Link>
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
              <CardTitle className="text-base">Contacts rencontrés ({contacts.length})</CardTitle>
              <AddEventContactDialog eventId={id || ''} eventName={event.name} />
            </CardHeader>
            <CardContent>
              {contactsLoading ? (
                <LoadingSpinner />
              ) : contacts.length > 0 ? (
                <div className="space-y-3">
                  {contacts.map((contact) => (
                    <div key={contact.id} className="flex items-center justify-between p-4 bg-muted/30 rounded-xl border">
                      <div className="flex-1">
                        <div className="font-medium font-display">{contact.full_name}</div>
                        <div className="text-sm text-muted-foreground">
                          {contact.job_title} {contact.company_name && `• ${contact.company_name}`}
                        </div>
                        {/* Contact info icons */}
                        <div className="flex items-center gap-3 mt-2">
                          {contact.email && (
                            <button
                              onClick={() => copyToClipboard(contact.email!, 'Email')}
                              className="flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Mail className="h-3 w-3" />
                              <span className="max-w-[120px] truncate">{contact.email}</span>
                              <Copy className="h-3 w-3 opacity-50" />
                            </button>
                          )}
                          {contact.phone && (
                            <button
                              onClick={() => copyToClipboard(contact.phone!, 'Téléphone')}
                              className="flex items-center gap-1 text-xs text-secondary hover:underline"
                            >
                              <Phone className="h-3 w-3" />
                              <span>{contact.phone}</span>
                              <Copy className="h-3 w-3 opacity-50" />
                            </button>
                          )}
                          {contact.linkedin_url && (
                            <a
                              href={contact.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-accent hover:underline"
                            >
                              <Linkedin className="h-3 w-3" />
                              LinkedIn
                            </a>
                          )}
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
                        {daysUntil > 0 ? `Dans ${daysUntil} jours` : 'Aujourd\'hui'}
                      </div>
                    </div>
                  </>
                ) : event.status === 'attended' ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <div>
                      <div className="font-medium">Participé</div>
                      <div className="text-sm text-muted-foreground">
                        {contacts.length} contacts collectés
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <Clock className="h-5 w-5 text-gray-400" />
                    <div>
                      <div className="font-medium">Annulé</div>
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
              <Button 
                size="sm" 
                onClick={handleSaveNotes} 
                className="w-full"
                disabled={updateEvent.isPending}
              >
                {updateEvent.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
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
                  <span className="text-sm text-muted-foreground">Avec email</span>
                  <span className="font-medium">{contacts.filter(c => c.email).length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Avec LinkedIn</span>
                  <span className="font-medium">{contacts.filter(c => c.linkedin_url).length}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
