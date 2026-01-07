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
  EventExhibitor,
} from '@/hooks/useEventExhibitors';

export default function EventScrapList() {
  const [sourceUrl, setSourceUrl] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterScore, setFilterScore] = useState<string>('all');
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
    if (filterCategory !== 'all' && e.target_category !== filterCategory) return false;
    if (filterScore !== 'all' && e.qualification_score < parseInt(filterScore)) return false;
    if (searchQuery && !e.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  // Stats
  const stats = {
    total: exhibitors.length,
    qualified: exhibitors.filter(e => e.qualification_score >= 4).length,
    enriched: exhibitors.filter(e => e.enrichment_status === 'enriched').length,
    weddingPlanners: exhibitors.filter(e => e.target_category === 'Wedding Planner').length,
  };

  const handleStartScraping = () => {
    if (!sourceUrl) return;
    startScraping.mutate({ sourceUrl }, {
      onSuccess: (data) => {
        setActiveSessionId(data.sessionId);
        setSourceUrl('');
      }
    });
  };

  const getScoreColor = (score: number) => {
    if (score >= 5) return 'bg-green-100 text-green-700 border-green-200';
    if (score >= 4) return 'bg-blue-100 text-blue-700 border-blue-200';
    if (score >= 3) return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-gray-100 text-gray-600 border-gray-200';
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
                <div className="p-2 rounded-lg bg-green-100">
                  <Star className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{stats.qualified}</p>
                  <p className="text-xs text-muted-foreground">Qualifiés (4+)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100">
                  <Sparkles className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{stats.weddingPlanners}</p>
                  <p className="text-xs text-muted-foreground">Wedding Planners</p>
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
                  <p className="text-2xl font-semibold">{stats.enriched}</p>
                  <p className="text-xs text-muted-foreground">Enrichis</p>
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

              <Select value={filterScore} onValueChange={setFilterScore}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Score min" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous scores</SelectItem>
                  <SelectItem value="5">5 étoiles</SelectItem>
                  <SelectItem value="4">4+ étoiles</SelectItem>
                  <SelectItem value="3">3+ étoiles</SelectItem>
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
                      {new Date(session.created_at).toLocaleDateString('fr-FR')} • {session.exhibitors_found} exposants
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
                  <TableHead className="w-12">Score</TableHead>
                  <TableHead>Exposant</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Localisation</TableHead>
                  <TableHead>Enrichissement</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExhibitors.map((exhibitor) => (
                  <TableRow key={exhibitor.id} className="group">
                    <TableCell>
                      <Badge variant="outline" className={getScoreColor(exhibitor.qualification_score)}>
                        {exhibitor.qualification_score}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{exhibitor.name}</p>
                        {exhibitor.website && (
                          <a 
                            href={exhibitor.website} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            {new URL(exhibitor.website).hostname}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {exhibitor.target_category ? (
                        <Badge variant="secondary">{exhibitor.target_category}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">{exhibitor.category || '-'}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {exhibitor.email && (
                          <div className="flex items-center gap-1 text-sm">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            <span>{exhibitor.email}</span>
                          </div>
                        )}
                        {exhibitor.phone && (
                          <div className="flex items-center gap-1 text-sm">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            <span>{exhibitor.phone}</span>
                          </div>
                        )}
                        {!exhibitor.email && !exhibitor.phone && (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {exhibitor.city || exhibitor.region ? (
                        <div className="flex items-center gap-1 text-sm">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          <span>{[exhibitor.city, exhibitor.region].filter(Boolean).join(', ')}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {exhibitor.enrichment_status === 'enriched' ? (
                        <Badge variant="outline" className="bg-green-50 text-green-600 border-green-200">
                          Enrichi
                        </Badge>
                      ) : exhibitor.enrichment_status === 'enriching' ? (
                        <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-200">
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          En cours
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => enrichExhibitor.mutate(exhibitor.id)}
                          disabled={enrichExhibitor.isPending}
                          className="h-7 text-xs"
                        >
                          <Sparkles className="h-3 w-3 mr-1" />
                          Enrichir
                        </Button>
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
                          <DropdownMenuItem>
                            <Users className="h-4 w-4 mr-2" />
                            Ajouter aux contacts
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : activeSessionId ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">Aucun exposant trouvé pour cette session</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Search className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              Entrez l'URL d'une page d'exposants pour commencer le scraping
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Ex: https://www.lesalondumariage.com/exposants/paris
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

