import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Calendar, 
  Plus, 
  MapPin, 
  Users, 
  Clock,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/EmptyState';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useEvents, useEventsStats } from '@/hooks/useEvents';
import { format, isPast, isFuture } from 'date-fns';
import { fr } from 'date-fns/locale';

const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  salon: { label: 'Salon', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  conference: { label: 'Conférence', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  networking: { label: 'Networking', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  other: { label: 'Autre', color: 'bg-gray-100 text-gray-800 border-gray-200' },
};

export default function EventsCalendar() {
  const { data: events, isLoading } = useEvents();
  const stats = useEventsStats();
  const [activeTab, setActiveTab] = useState('upcoming');

  const upcomingEvents = events?.filter(e => isFuture(new Date(e.date_start)) && e.status !== 'cancelled') ?? [];
  const pastEvents = events?.filter(e => isPast(new Date(e.date_start)) || e.status === 'attended') ?? [];

  const displayedEvents = activeTab === 'upcoming' ? upcomingEvents : pastEvents;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            CRM Événements
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gérez vos salons, conférences et événements professionnels
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/events/scanner">
            <Button variant="outline" size="sm">
              Scanner événements
            </Button>
          </Link>
          <Link to="/events/new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter événement
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="À venir"
          value={stats.upcoming}
          icon={Calendar}
          iconColor="text-primary"
        />
        <StatCard
          label="Ce mois"
          value={stats.thisMonth}
          icon={Clock}
          iconColor="text-amber-500"
        />
        <StatCard
          label="Contacts collectés"
          value={stats.totalContacts}
          icon={Users}
          iconColor="text-emerald-500"
        />
        <StatCard
          label="Participés"
          value={stats.attended}
          icon={CheckCircle2}
          iconColor="text-blue-500"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upcoming">À venir ({upcomingEvents.length})</TabsTrigger>
          <TabsTrigger value="past">Passés ({pastEvents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {displayedEvents.length > 0 ? (
            <div className="space-y-3">
              {displayedEvents.map((event) => {
                const config = EVENT_TYPE_CONFIG[event.type] || EVENT_TYPE_CONFIG.other;
                const eventDate = new Date(event.date_start);
                
                return (
                  <Link key={event.id} to={`/events/${event.id}`}>
                    <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          {/* Date block */}
                          <div className="flex-shrink-0 w-16 text-center">
                            <div className="bg-primary/10 rounded-lg p-2">
                              <div className="text-xs text-primary uppercase font-medium">
                                {format(eventDate, 'MMM', { locale: fr })}
                              </div>
                              <div className="text-2xl font-bold text-foreground">
                                {format(eventDate, 'd')}
                              </div>
                            </div>
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className={config.color}>
                                {config.label}
                              </Badge>
                              {event.status === 'attended' && (
                                <Badge variant="secondary" className="text-xs">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Participé
                                </Badge>
                              )}
                            </div>
                            <h3 className="font-semibold text-foreground">{event.name}</h3>
                            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5" />
                                {event.location}
                              </span>
                              {(event.contacts_count || 0) > 0 && (
                                <span className="flex items-center gap-1">
                                  <Users className="h-3.5 w-3.5" />
                                  {event.contacts_count} contacts
                                </span>
                              )}
                            </div>
                            {event.description && (
                              <p className="text-sm text-muted-foreground mt-2 line-clamp-1">
                                {event.description}
                              </p>
                            )}
                          </div>

                          <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={activeTab === 'upcoming' ? "Aucun événement à venir" : "Aucun événement passé"}
              description="Ajoutez des événements pour suivre vos participations."
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Quick info */}
      <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
        <CardHeader>
          <CardTitle className="text-base">Événements recommandés</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Basé sur votre activité, les salons <strong>OMYAGUE</strong> et <strong>Affaire de Cadeaux</strong> sont 
            particulièrement pertinents pour le secteur cadeaux d'affaires.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
