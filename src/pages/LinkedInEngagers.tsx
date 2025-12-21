import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Linkedin, 
  Search, 
  RefreshCw, 
  ExternalLink, 
  ThumbsUp, 
  MessageCircle,
  Share2,
  User,
  Calendar,
  Building2,
  Star,
  StarOff,
  Plus,
  Settings,
  UserCheck,
  FileText,
  Trash2,
  Power,
  PowerOff
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEngagers, useEngagersStats, useToggleProspect, useLinkedInPosts } from '@/hooks/useEngagers';
import { useLinkedInSources, useAddLinkedInSource, useToggleLinkedInSource, useDeleteLinkedInSource, useScrapeLinkedIn } from '@/hooks/useLinkedInSources';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const engagementIcons = {
  like: ThumbsUp,
  comment: MessageCircle,
  share: Share2,
};

const engagementLabels = {
  like: 'Like',
  comment: 'Commentaire',
  share: 'Partage',
};

const engagementColors = {
  like: 'text-blue-500',
  comment: 'text-green-500',
  share: 'text-purple-500',
};

export default function LinkedInEngagers() {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('engagers');
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
  const [newSource, setNewSource] = useState({ name: '', source_type: 'profile' as 'profile' | 'company', linkedin_url: '' });
  
  const { data: engagers, isLoading: loadingEngagers } = useEngagers();
  const { data: posts, isLoading: loadingPosts } = useLinkedInPosts();
  const { data: sources, isLoading: loadingSources } = useLinkedInSources();
  const stats = useEngagersStats();
  
  const toggleProspect = useToggleProspect();
  const scrapeLinkedIn = useScrapeLinkedIn();
  const addSource = useAddLinkedInSource();
  const toggleSource = useToggleLinkedInSource();
  const deleteSource = useDeleteLinkedInSource();

  const filteredEngagers = engagers?.filter(e => 
    e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.headline?.toLowerCase().includes(searchTerm.toLowerCase())
  ) ?? [];

  const filteredPosts = posts?.filter(p =>
    p.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.content?.toLowerCase().includes(searchTerm.toLowerCase())
  ) ?? [];

  const handleScan = () => {
    scrapeLinkedIn.mutate();
  };

  const handleAddSource = () => {
    if (newSource.name.trim() && newSource.linkedin_url.trim()) {
      addSource.mutate(newSource, {
        onSuccess: () => {
          setNewSource({ name: '', source_type: 'profile', linkedin_url: '' });
          setIsAddSourceOpen(false);
        },
      });
    }
  };

  const handleToggleProspect = (id: string, currentStatus: boolean) => {
    toggleProspect.mutate({ id, is_prospect: !currentStatus });
  };

  const isLoading = loadingEngagers || loadingPosts || loadingSources;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
            <Linkedin className="h-8 w-8 text-[#0A66C2]" />
            Signaux LinkedIn
          </h1>
          <p className="text-muted-foreground mt-1">
            Engagers sur les posts LinkedIn surveillés
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isAddSourceOpen} onOpenChange={setIsAddSourceOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                Ajouter une source
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ajouter une source LinkedIn</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="sourceName">Nom</Label>
                  <Input
                    id="sourceName"
                    placeholder="Ex: Patrick Oualid"
                    value={newSource.name}
                    onChange={(e) => setNewSource(s => ({ ...s, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sourceType">Type de source</Label>
                  <Select 
                    value={newSource.source_type} 
                    onValueChange={(v: 'profile' | 'company') => setNewSource(s => ({ ...s, source_type: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="profile">Profil personnel</SelectItem>
                      <SelectItem value="company">Page entreprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sourceUrl">URL LinkedIn</Label>
                  <Input
                    id="sourceUrl"
                    placeholder="https://www.linkedin.com/in/... ou /company/..."
                    value={newSource.linkedin_url}
                    onChange={(e) => setNewSource(s => ({ ...s, linkedin_url: e.target.value }))}
                  />
                </div>
                <Button 
                  onClick={handleAddSource} 
                  disabled={!newSource.name.trim() || !newSource.linkedin_url.trim() || addSource.isPending}
                  className="w-full"
                >
                  {addSource.isPending ? 'Ajout...' : 'Ajouter la source'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button 
            onClick={handleScan}
            disabled={scrapeLinkedIn.isPending}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${scrapeLinkedIn.isPending ? 'animate-spin' : ''}`} />
            {scrapeLinkedIn.isPending ? 'Scan en cours...' : 'Lancer le scan'}
          </Button>
        </div>
      </div>

      {/* Sources */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Sources surveillées ({sources?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sources && sources.length > 0 ? (
            <div className="space-y-2">
              {sources.map(source => (
                <div key={source.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${source.source_type === 'profile' ? 'bg-blue-500/10' : 'bg-purple-500/10'}`}>
                      {source.source_type === 'profile' ? (
                        <User className="h-5 w-5 text-blue-500" />
                      ) : (
                        <Building2 className="h-5 w-5 text-purple-500" />
                      )}
                    </div>
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {source.name}
                        <Badge variant={source.is_active ? 'default' : 'secondary'} className="text-xs">
                          {source.source_type === 'profile' ? 'Profil' : 'Entreprise'}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {source.posts_count} posts · {source.engagers_count} engagers
                        {source.last_scraped_at && (
                          <span className="ml-2">
                            · Dernier scan: {new Date(source.last_scraped_at).toLocaleDateString('fr-FR')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={source.is_active}
                      onCheckedChange={(checked) => toggleSource.mutate({ id: source.id, is_active: checked })}
                    />
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => window.open(source.linkedin_url, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => deleteSource.mutate(source.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune source configurée. Ajoutez un profil ou une page entreprise.</p>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-foreground">{stats.total}</div>
            <p className="text-sm text-muted-foreground">Total engagers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <ThumbsUp className="h-5 w-5 text-blue-500" />
            <div>
              <div className="text-2xl font-bold text-foreground">{stats.likes}</div>
              <p className="text-sm text-muted-foreground">Likes</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <MessageCircle className="h-5 w-5 text-green-500" />
            <div>
              <div className="text-2xl font-bold text-foreground">{stats.comments}</div>
              <p className="text-sm text-muted-foreground">Commentaires</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <UserCheck className="h-5 w-5 text-primary" />
            <div>
              <div className="text-2xl font-bold text-foreground">{stats.prospects}</div>
              <p className="text-sm text-muted-foreground">Prospects</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-2xl font-bold text-foreground">{posts?.length || 0}</div>
              <p className="text-sm text-muted-foreground">Posts</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="engagers" className="gap-2">
              <User className="h-4 w-4" />
              Engagers
            </TabsTrigger>
            <TabsTrigger value="posts" className="gap-2">
              <FileText className="h-4 w-4" />
              Posts
            </TabsTrigger>
          </TabsList>
          
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Engagers Tab */}
        <TabsContent value="engagers" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Engagers récents</CardTitle>
            </CardHeader>
            <CardContent>
              {filteredEngagers.length === 0 ? (
                <EmptyState
                  icon={User}
                  title="Aucun engager"
                  description="Configurez des sources puis lancez un scan pour récupérer les personnes ayant interagi."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Personne</TableHead>
                      <TableHead>Entreprise</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Post</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEngagers.map((engager) => {
                      const EngagementIcon = engagementIcons[engager.engagement_type];
                      return (
                        <TableRow key={engager.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <User className="h-5 w-5 text-primary" />
                              </div>
                              <div>
                                <div className="font-medium text-foreground flex items-center gap-2">
                                  {engager.name}
                                  {engager.is_prospect && (
                                    <Badge variant="default" className="text-xs">Prospect</Badge>
                                  )}
                                  {engager.transferred_to_contacts && (
                                    <Badge variant="secondary" className="text-xs">Contact</Badge>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                                  {engager.headline || '-'}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {engager.company ? (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Building2 className="h-4 w-4" />
                                {engager.company}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="gap-1">
                              <EngagementIcon className={`h-3 w-3 ${engagementColors[engager.engagement_type]}`} />
                              {engagementLabels[engager.engagement_type]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                              {engager.linkedin_posts?.title || 'Post LinkedIn'}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {new Date(engager.scraped_at).toLocaleDateString('fr-FR')}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => handleToggleProspect(engager.id, engager.is_prospect)}
                                title={engager.is_prospect ? 'Retirer des prospects' : 'Marquer comme prospect'}
                              >
                                {engager.is_prospect ? (
                                  <StarOff className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <Star className="h-4 w-4 text-primary" />
                                )}
                              </Button>
                              {engager.linkedin_url && (
                                <Button variant="ghost" size="sm" asChild>
                                  <a href={engager.linkedin_url} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Posts Tab */}
        <TabsContent value="posts" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Posts surveillés</CardTitle>
            </CardHeader>
            <CardContent>
              {filteredPosts.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="Aucun post"
                  description="Lancez un scan pour récupérer les posts des sources configurées."
                />
              ) : (
                <div className="space-y-4">
                  {filteredPosts.map((post) => {
                    const engagersCount = engagers?.filter(e => e.post_id === post.id).length || 0;
                    return (
                      <div key={post.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <h3 className="font-medium text-foreground line-clamp-2">
                              {post.title || post.content?.substring(0, 100) || 'Post LinkedIn'}
                            </h3>
                            {post.content && (
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                {post.content}
                              </p>
                            )}
                            <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <ThumbsUp className="h-4 w-4 text-blue-500" />
                                {post.likes_count || 0}
                              </div>
                              <div className="flex items-center gap-1">
                                <MessageCircle className="h-4 w-4 text-green-500" />
                                {post.comments_count || 0}
                              </div>
                              <div className="flex items-center gap-1">
                                <User className="h-4 w-4" />
                                {engagersCount} engagers
                              </div>
                              {post.published_at && (
                                <div className="flex items-center gap-1">
                                  <Calendar className="h-4 w-4" />
                                  {new Date(post.published_at).toLocaleDateString('fr-FR')}
                                </div>
                              )}
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" asChild>
                            <a href={post.post_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
