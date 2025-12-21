import { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Newspaper, 
  TrendingUp, 
  ThumbsUp, 
  MessageCircle, 
  Share2, 
  Star, 
  RefreshCw, 
  ArrowRight,
  Plus,
  Users,
  Loader2,
  BarChart3,
  Calendar,
  Target
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { StatCard } from '@/components/StatCard';
import { LoadingPage } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CreditAlert } from '@/components/CreditAlert';
import { useEngagers, useEngagersStats, useScrapeEngagers, useAddLinkedInPost, useLinkedInPosts } from '@/hooks/useEngagers';
import { useApifyCreditsSummary, useApifyPlanSettings, useApifyCreditsBySource } from '@/hooks/useApifyCredits';
import { GenericScanProgressCard } from '@/components/GenericScanProgressCard';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function LinkedInDashboard() {
  const [newPostUrl, setNewPostUrl] = useState('');
  const [isAddPostOpen, setIsAddPostOpen] = useState(false);

  const { data: engagers, isLoading } = useEngagers();
  const { data: posts } = useLinkedInPosts();
  const stats = useEngagersStats();
  const scrapeEngagers = useScrapeEngagers();
  const addPost = useAddLinkedInPost();
  
  // Credits hooks
  const apifyCredits = useApifyCreditsSummary();
  const { data: apifyPlan } = useApifyPlanSettings();
  const apifyBySource = useApifyCreditsBySource();

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

  if (isLoading) {
    return <LoadingPage />;
  }

  // Stats par type d'engagement
  const engagementBreakdown = {
    like: stats.likes,
    comment: stats.comments,
    share: stats.shares,
  };

  // Engagers récents (5 derniers)
  const recentEngagers = engagers?.slice(0, 5) || [];

  // Posts avec le plus d'engagements
  const postsWithEngagers = posts?.map(post => ({
    ...post,
    engagersCount: engagers?.filter(e => e.post_id === post.id).length || 0,
  })).sort((a, b) => b.engagersCount - a.engagersCount).slice(0, 3) || [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-source-linkedin" />
            Signaux LinkedIn
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Détection de prospects via les interactions LinkedIn
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Dialog open={isAddPostOpen} onOpenChange={setIsAddPostOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-2" />
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
                  <Input
                    id="postUrl"
                    placeholder="https://www.linkedin.com/posts/..."
                    value={newPostUrl}
                    onChange={(e) => setNewPostUrl(e.target.value)}
                  />
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
          <Link to="/engagers">
            <Button variant="outline" size="sm">
              Sources
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
          <Button
            onClick={handleScan}
            disabled={scrapeEngagers.isPending}
            size="sm"
          >
            {scrapeEngagers.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Lancer scan
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Alerte crédits Apify */}
      <Card className="border-l-4 border-l-source-linkedin bg-source-linkedin/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-foreground flex items-center gap-2">
                Crédits Apify (LinkedIn)
                <Badge variant="outline">{apifyPlan?.plan_name || 'Starter'}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {apifyBySource.linkedin.scrapes} scrapes • {apifyBySource.linkedin.credits.toLocaleString()} crédits utilisés ce mois
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-source-linkedin">{apifyCredits.percent}%</div>
              <div className="text-xs text-muted-foreground">{apifyCredits.remaining.toLocaleString()} restants (total)</div>
            </div>
          </div>
          <Progress value={apifyCredits.percent} className="h-2 mt-3" />
        </CardContent>
      </Card>

      {/* Scan en cours */}
      <GenericScanProgressCard
        source="linkedin"
        isActive={scrapeEngagers.isPending}
        currentStep={1}
        totalSteps={posts?.length || 1}
        processedCount={0}
        stepLabel="Post actuel"
        processedLabel="Engagers trouvés"
        remainingLabel="posts à analyser"
        resultsLabel="Engagers détectés"
      />

      {/* KPIs principaux */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          label="Total engagers"
          value={stats.total}
          icon={Users}
          iconColor="text-source-linkedin"
        />
        <StatCard
          label="Likes"
          value={stats.likes}
          icon={ThumbsUp}
          iconColor="text-blue-500"
        />
        <StatCard
          label="Commentaires"
          value={stats.comments}
          icon={MessageCircle}
          iconColor="text-emerald-500"
        />
        <StatCard
          label="Partages"
          value={stats.shares}
          icon={Share2}
          iconColor="text-violet-500"
        />
        <StatCard
          label="Prospects"
          value={stats.prospects}
          icon={Star}
          iconColor="text-amber-500"
        />
      </div>

      {/* Layout principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Colonne gauche : Engagers récents */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground">Engagers récents</h2>
            <Link to="/engagers/list">
              <Button variant="ghost" size="sm" className="text-source-linkedin">
                Tous <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>

          {recentEngagers.length > 0 ? (
            <div className="space-y-3">
              {recentEngagers.map((engager) => (
                <Card key={engager.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                          <Users className="h-5 w-5 text-blue-500" />
                        </div>
                        <div>
                          <div className="font-medium text-foreground flex items-center gap-2">
                            {engager.name}
                            {engager.is_prospect && (
                              <Badge className="bg-amber-500 text-xs">Prospect</Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {engager.headline || engager.company || 'LinkedIn'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {engager.engagement_type === 'like' && <ThumbsUp className="h-3 w-3 mr-1 text-blue-500" />}
                          {engager.engagement_type === 'comment' && <MessageCircle className="h-3 w-3 mr-1 text-emerald-500" />}
                          {engager.engagement_type === 'share' && <Share2 className="h-3 w-3 mr-1 text-violet-500" />}
                          {engager.engagement_type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(engager.scraped_at || engager.created_at), { addSuffix: true, locale: fr })}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Aucun engager"
              description="Ajoutez des posts LinkedIn et lancez un scan."
            />
          )}
        </div>

        {/* Colonne droite : Stats */}
        <div className="space-y-4">
          
          {/* Posts surveillés */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-muted-foreground" />
                Posts surveillés
              </CardTitle>
            </CardHeader>
            <CardContent>
              {posts && posts.length > 0 ? (
                <div className="space-y-3">
                  {postsWithEngagers.map(post => (
                    <div key={post.id} className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {post.title || 'Post LinkedIn'}
                        </div>
                        {post.last_scraped_at && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Scanné {formatDistanceToNow(new Date(post.last_scraped_at), { addSuffix: true, locale: fr })}
                          </div>
                        )}
                      </div>
                      <Badge variant="secondary">{post.engagersCount}</Badge>
                    </div>
                  ))}
                  <div className="text-center pt-2">
                    <span className="text-xs text-muted-foreground">
                      {posts.length} post{posts.length > 1 ? 's' : ''} au total
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  Aucun post surveillé
                </div>
              )}
            </CardContent>
          </Card>

          {/* Répartition des engagements */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                Types d'engagement
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { type: 'like', label: 'Likes', color: 'bg-blue-500', icon: ThumbsUp, count: stats.likes },
                { type: 'comment', label: 'Commentaires', color: 'bg-emerald-500', icon: MessageCircle, count: stats.comments },
                { type: 'share', label: 'Partages', color: 'bg-violet-500', icon: Share2, count: stats.shares },
              ].map(({ type, label, color, icon: Icon, count }) => {
                const percent = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                return (
                  <div key={type} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Icon className={`h-4 w-4 ${color.replace('bg-', 'text-')}`} />
                        {label}
                      </span>
                      <span className="font-medium">{count}</span>
                    </div>
                    <Progress value={percent} className="h-1.5" />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Taux de conversion */}
          <Card className="bg-gradient-to-br from-amber-500/5 to-amber-500/10 border-amber-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Target className="h-4 w-4 text-amber-500" />
                Conversion
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <div className="text-3xl font-bold text-amber-600">
                  {stats.total > 0 ? Math.round((stats.prospects / stats.total) * 100) : 0}%
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {stats.prospects} prospects sur {stats.total} engagers
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}
