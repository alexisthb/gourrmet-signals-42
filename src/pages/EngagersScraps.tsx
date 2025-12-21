import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Newspaper, 
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
  Link
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEngagers, useEngagersStats, useToggleProspect, useScrapeEngagers, useAddLinkedInPost, useLinkedInPosts } from '@/hooks/useEngagers';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

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

export default function EngagersScraps() {
  const [searchTerm, setSearchTerm] = useState('');
  const [newPostUrl, setNewPostUrl] = useState('');
  const [isAddPostOpen, setIsAddPostOpen] = useState(false);
  
  const { data: engagers, isLoading } = useEngagers();
  const { data: posts } = useLinkedInPosts();
  const stats = useEngagersStats();
  const toggleProspect = useToggleProspect();
  const scrapeEngagers = useScrapeEngagers();
  const addPost = useAddLinkedInPost();

  const filteredEngagers = engagers?.filter(e => 
    e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.headline?.toLowerCase().includes(searchTerm.toLowerCase())
  ) ?? [];

  const handleScan = () => {
    scrapeEngagers.mutate();
  };

  const handleAddPost = () => {
    if (newPostUrl.trim()) {
      addPost.mutate(newPostUrl.trim(), {
        onSuccess: () => {
          setNewPostUrl('');
          setIsAddPostOpen(false);
        },
      });
    }
  };

  const handleToggleProspect = (id: string, currentStatus: boolean) => {
    toggleProspect.mutate({ id, is_prospect: !currentStatus });
  };

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
            <Newspaper className="h-8 w-8 text-primary" />
            Scraps Engagers LinkedIn
          </h1>
          <p className="text-muted-foreground mt-1">
            Personnes ayant interagi avec les posts LinkedIn de Patrick
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isAddPostOpen} onOpenChange={setIsAddPostOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Plus className="h-4 w-4" />
                Ajouter un post
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ajouter un post LinkedIn</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="postUrl">URL du post LinkedIn</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="postUrl"
                        placeholder="https://www.linkedin.com/posts/..."
                        value={newPostUrl}
                        onChange={(e) => setNewPostUrl(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                </div>
                <Button 
                  onClick={handleAddPost} 
                  disabled={!newPostUrl.trim() || addPost.isPending}
                  className="w-full"
                >
                  {addPost.isPending ? 'Ajout...' : 'Ajouter le post'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button 
            onClick={handleScan}
            disabled={scrapeEngagers.isPending}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${scrapeEngagers.isPending ? 'animate-spin' : ''}`} />
            {scrapeEngagers.isPending ? 'Scan en cours...' : 'Lancer le scan'}
          </Button>
        </div>
      </div>

      {/* Posts tracked */}
      {posts && posts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Posts surveillés ({posts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {posts.map(post => (
                <Badge key={post.id} variant="secondary" className="gap-2">
                  <Link className="h-3 w-3" />
                  {post.title || 'Post LinkedIn'}
                  {post.last_scraped_at && (
                    <span className="text-xs opacity-60">
                      (scanné {new Date(post.last_scraped_at).toLocaleDateString('fr-FR')})
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
            <Share2 className="h-5 w-5 text-purple-500" />
            <div>
              <div className="text-2xl font-bold text-foreground">{stats.shares}</div>
              <p className="text-sm text-muted-foreground">Partages</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <Star className="h-5 w-5 text-primary" />
            <div>
              <div className="text-2xl font-bold text-foreground">{stats.prospects}</div>
              <p className="text-sm text-muted-foreground">Prospects</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Rechercher par nom, entreprise..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Engagers récents</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredEngagers.length === 0 ? (
            <EmptyState
              icon={Newspaper}
              title="Aucun engager"
              description="Ajoutez des posts LinkedIn puis lancez un scan pour récupérer les personnes ayant interagi."
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
    </div>
  );
}
