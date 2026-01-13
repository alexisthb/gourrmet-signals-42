import { useState, useEffect } from 'react';
import { 
  Search, 
  Download, 
  ExternalLink, 
  Star, 
  Building2, 
  MapPin,
  Phone,
  Mail,
  Loader2,
  RefreshCw,
  Filter,
  ChevronDown,
  Sparkles,
  Users,
  Globe,
  TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  useEventExhibitors, 
  useScrapSessions,
  useScrapSession,
  useStartScraping,
  useCheckScrapingStatus,
  useEnrichExhibitor,
  useExportExhibitors,
  type EventExhibitor,
} from '@/hooks/useEventExhibitors';

export default function EventScrapList() {
  const [sourceUrl, setSourceUrl] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: exhibitors = [], isLoading: loadingExhibitors } = useEventExhibitors(activeSessionId || undefined);
  const { data: sessions = [], isLoading: loadingSessions } = useScrapSessions();
  const { data: activeSession } = useScrapSession(activeSessionId);
  
  const startScraping = useStartScraping();
  const checkStatus = useCheckScrapingStatus();
  const enrichExhibitor = useEnrichExhibitor();
  const exportExhibitors = useExportExhibitors();

  // Polling du statut si session en cours
  useEffect(() => {
    if (activeSession?.status === 'running') {
      const interval = setInterval(() => {
        checkStatus.mutate(activeSession.id);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [activeSession?.status, activeSession?.id]);

  // Filtrer les exposants
  const filteredExhibitors = exhibitors.filter(e => {
    if (filterCategory !== 'all' && e.category !== filterCategory) return false;
    if (filterPriority === 'priority' && !e.is_priority) return false;
    if (searchQuery && !e.company_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  // Stats
  const stats = {
    total: exhibitors.length,
    priority: exhibitors.filter(e => e.is_priority).length,
    contacted: exhibitors.filter(e => e.outreach_status === 'contacted').length,
    withEmail: exhibitors.filter(e => e.contact_email).length,
  };

  const handleStartScraping = () => {
    if (!sourceUrl) return;
    startScraping.mutate({ sourceUrl }, {
      onSuccess: (data: { sessionId?: string } | undefined) => {
        setActiveSessionId(data?.sessionId || null);
        setSourceUrl('');
      }
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
        return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">En cours</Badge>;
      case 'completed':
        return <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200">Terminé</Badge>;
      case 'failed':
        return <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200">Échec</Badge>;
      default:
        return <Badge variant="outline">En attente</Badge>;
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl text-foreground">Event Scrap List</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Scrapez les exposants de salons professionnels et identifiez vos meilleurs prospects
        </p>
      </div>

      {/* Input URL */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="URL de la page exposants (ex: https://www.lesalondumariage.com/exposants/paris)"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button 
              onClick={handleStartScraping}
              disabled={!sourceUrl || startScraping.isPending}
            >
              {startScraping.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Lancer le scraping
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Session active en cours */}
      {activeSession?.status === 'running' && (
        <Card className="mb-6 border-blue-200 bg-blue-50/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              <div className="flex-1">
                <p className="font-medium text-blue-900">Scraping en cours...</p>
                <p className="text-sm text-blue-700">{activeSession.source_url}</p>
              </div>
              <Progress value={33} className="w-32" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      {exhibitors.length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gray-100">
                  <Users className="h-5 w-5 text-gray-600" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Exposants</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100">
                  <Star className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{stats.priority}</p>
                  <p className="text-xs text-muted-foreground">Prioritaires</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100">
                  <Mail className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{stats.withEmail}</p>
                  <p className="text-xs text-muted-foreground">Avec email</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{stats.contacted}</p>
                  <p className="text-xs text-muted-foreground">Contactés</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filtres et Actions */}
      {exhibitors.length > 0 && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Filtres</span>
              </div>
              
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Catégorie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes catégories</SelectItem>
                  <SelectItem value="Wedding Planner">Wedding Planner</SelectItem>
                  <SelectItem value="Marketplace Cadeaux">Marketplace Cadeaux</SelectItem>
                  <SelectItem value="Agence">Agence</SelectItem>
                  <SelectItem value="Traiteur">Traiteur</SelectItem>
                  <SelectItem value="Photo/Vidéo">Photo/Vidéo</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Priorité" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  <SelectItem value="priority">Prioritaires</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="ml-auto flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => exportExhibitors.mutate(filteredExhibitors)}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Exporter CSV
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sessions passées */}
      {sessions.length > 0 && !activeSessionId && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base font-medium">Sessions précédentes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sessions.slice(0, 5).map(session => (
                <div 
                  key={session.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => setActiveSessionId(session.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{session.source_url}</p>
                    <p className="text-xs text-muted-foreground">
                      {session.created_at && new Date(session.created_at).toLocaleDateString('fr-FR')} • {session.exhibitors_found || 0} exposants
                    </p>
                  </div>
                  {getStatusBadge(session.status)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Liste des exposants */}
      {loadingExhibitors ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredExhibitors.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Priorité</TableHead>
                  <TableHead>Exposant</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Stand</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExhibitors.map((exhibitor) => (
                  <TableRow key={exhibitor.id} className="group">
                    <TableCell>
                      {exhibitor.is_priority ? (
                        <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
                      ) : (
                        <Star className="h-5 w-5 text-gray-300" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{exhibitor.company_name}</p>
                        {exhibitor.website_url && (
                          <a 
                            href={exhibitor.website_url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            {(() => {
                              try {
                                return new URL(exhibitor.website_url).hostname;
                              } catch {
                                return exhibitor.website_url;
                              }
                            })()}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {exhibitor.category ? (
                        <Badge variant="secondary">{exhibitor.category}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {exhibitor.contact_name && (
                          <p className="text-sm font-medium">{exhibitor.contact_name}</p>
                        )}
                        {exhibitor.contact_email && (
                          <div className="flex items-center gap-1 text-sm">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            <span>{exhibitor.contact_email}</span>
                          </div>
                        )}
                        {exhibitor.contact_phone && (
                          <div className="flex items-center gap-1 text-sm">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            <span>{exhibitor.contact_phone}</span>
                          </div>
                        )}
                        {!exhibitor.contact_email && !exhibitor.contact_phone && (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {exhibitor.booth_number ? (
                        <Badge variant="outline">{exhibitor.booth_number}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {exhibitor.outreach_status === 'contacted' ? (
                        <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200">
                          Contacté
                        </Badge>
                      ) : exhibitor.outreach_status === 'responded' ? (
                        <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">
                          Répondu
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
                          Nouveau
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Voir le site
                          </DropdownMenuItem>
                          {exhibitor.linkedin_url && (
                            <DropdownMenuItem>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Voir LinkedIn
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : exhibitors.length === 0 && !loadingSessions ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">Aucun exposant</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Lancez un scraping ou sélectionnez une session précédente
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
