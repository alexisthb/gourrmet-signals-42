import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Newspaper, 
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
  Target,
  UserPlus,
  Clock,
  ExternalLink
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
import { useEngagers, useEngagersStats, useAddLinkedInPost, useLinkedInPosts } from '@/hooks/useEngagers';
import { useLinkedInSources, useScrapeLinkedIn, useCheckLinkedInScanStatus, useTransferEngagersToContacts } from '@/hooks/useLinkedInSources';
import { useApifyCreditsSummary, useApifyPlanSettings, useApifyCreditsBySource } from '@/hooks/useApifyCredits';
import { LinkedInScanProgressModal } from '@/components/LinkedInScanProgressModal';
import { GeoFilter, GeoZoneBadge } from '@/components/GeoFilter';
import { formatDistanceToNow, isAfter, subDays } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function LinkedInDashboard() {
  const [newPostUrl, setNewPostUrl] = useState('');
  const [isAddPostOpen, setIsAddPostOpen] = useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [scanResult, setScanResult] = useState<{ success: boolean; newPosts?: number; engagersFound?: number; error?: string } | null>(null);
  const [activeScan, setActiveScan] = useState<{ scan_id?: string; manus_task_id?: string } | null>(null);
  
  // Filtres géographiques
  const [selectedGeoZones, setSelectedGeoZones] = useState<string[]>([]);
  const [priorityOnly, setPriorityOnly] = useState(false);

  const { data: engagers, isLoading } = useEngagers({
    geoZoneIds: selectedGeoZones.length > 0 ? selectedGeoZones : undefined,
    priorityOnly,
  });
  const { data: posts } = useLinkedInPosts();
  const { data: sources } = useLinkedInSources();
  const stats = useEngagersStats();
  const scrapeLinkedIn = useScrapeLinkedIn();
  const checkScanStatus = useCheckLinkedInScanStatus();
  const transferEngagers = useTransferEngagersToContacts();
  const addPost = useAddLinkedInPost();
  
  // Credits hooks
  const apifyCredits = useApifyCreditsSummary();
  const { data: apifyPlan } = useApifyPlanSettings();
  const apifyBySource = useApifyCreditsBySource();

  // Poll scan status while Manus is running
  useEffect(() => {
    if (!isScanModalOpen || !activeScan?.scan_id) return;

    const tick = () => {
      if (checkScanStatus.isPending) return;

      checkScanStatus.mutate(activeScan, {
        onSuccess: (data) => {
          if (data?.is_complete && data?.scan?.status === 'completed') {
            setScanResult({
              success: true,
              newPosts: data.scan.posts_found || 0,
              engagersFound: data.scan.engagers_found || 0,
            });
            setActiveScan(null);
          }

          if (data?.is_complete && data?.scan?.status === 'error') {
            setScanResult({
              success: false,
              error: data.scan?.error_message || 'Erreur lors du traitement du scan',
            });
            setActiveScan(null);
          }
        },
      });
    };

    tick();
    const interval = setInterval(tick, 5000);
    return () => clearInterval(interval);
  }, [activeScan?.scan_id, activeScan?.manus_task_id, isScanModalOpen, checkScanStatus]);

  const handleScan = () => {
    setScanResult(null);
    setActiveScan(null);
    setIsScanModalOpen(true);

    scrapeLinkedIn.mutate(undefined, {
      onSuccess: (data) => {
        setScanResult(null);
        setActiveScan({ scan_id: data?.scan_id, manus_task_id: data?.manus_task_id });
      },
      onError: (error) => {
        setScanResult({
          success: false,
          error: error instanceof Error ? error.message : 'Erreur inconnue',
        });
      },
    });
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

  // Nouveaux engagers (créés dans les 7 derniers jours)
  const sevenDaysAgo = subDays(new Date(), 7);
  const newEngagers = engagers?.filter(e => 
    isAfter(new Date(e.created_at), sevenDaysAgo)
  ).slice(0, 8) || [];

  // Posts avec leurs engagers pour la vue par post
  const postsWithEngagers = posts?.map(post => {
    const postEngagers = engagers?.filter(e => e.post_id === post.id) || [];
    return {
      ...post,
      engagers: postEngagers,
      engagersCount: postEngagers.length,
      newEngagersCount: postEngagers.filter(e => isAfter(new Date(e.created_at), sevenDaysAgo)).length,
    };
  }).filter(p => p.engagersCount > 0).sort((a, b) => b.engagersCount - a.engagersCount) || [];

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
        <div className="flex items-center gap-2">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => transferEngagers.mutate()}
            disabled={transferEngagers.isPending}
          >
            {transferEngagers.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <UserPlus className="h-4 w-4 mr-2" />
                Transférer
              </>
            )}
          </Button>
          <Link to="/engagers/signals">
            <Button variant="outline" size="sm">
              Signaux
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
          <Link to="/engagers/list">
            <Button variant="outline" size="sm">
              Sources
            </Button>
          </Link>
          <Button
            onClick={handleScan}
            disabled={scrapeLinkedIn.isPending}
            size="sm"
          >
            {scrapeLinkedIn.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Scanner
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Scan Progress Modal */}
      <LinkedInScanProgressModal
        open={isScanModalOpen}
        onOpenChange={setIsScanModalOpen}
        isScanning={scrapeLinkedIn.isPending || !!activeScan}
        result={scanResult}
        sources={sources?.filter(s => s.is_active).map(s => ({
          id: s.id,
          name: s.name,
          source_type: s.source_type
        }))}
      />

      {/* Filtre géographique */}
      <div className="flex items-center gap-4">
        <GeoFilter
          selectedZones={selectedGeoZones}
          onZonesChange={setSelectedGeoZones}
          priorityOnly={priorityOnly}
          onPriorityOnlyChange={setPriorityOnly}
        />
      </div>

      {/* Crédits Apify */}
      <Card className="border-l-4 border-l-source-linkedin bg-source-linkedin/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-foreground flex items-center gap-2">
                Crédits Apify
                <Badge variant="outline" className="text-xs">{apifyPlan?.plan_name || 'Starter'}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {apifyBySource.linkedin.scrapes} scrapes • {apifyBySource.linkedin.credits.toLocaleString()} crédits ce mois
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-source-linkedin">{apifyCredits.percent}%</div>
              <div className="text-xs text-muted-foreground">{apifyCredits.remaining.toLocaleString()} restants</div>
            </div>
          </div>
          <Progress value={apifyCredits.percent} className="h-2 mt-3" />
        </CardContent>
      </Card>

      {/* KPIs */}
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

      {/* Section: Nouveaux engagers récents */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-source-linkedin" />
              Nouveaux engagers récents
              <Badge variant="secondary" className="ml-2">{newEngagers.length}</Badge>
            </CardTitle>
            <Link to="/engagers/list">
              <Button variant="ghost" size="sm" className="text-source-linkedin">
                Voir tout <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            Personnes ayant interagi ces 7 derniers jours
          </p>
        </CardHeader>
        <CardContent>
          {newEngagers.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {newEngagers.map((engager) => (
                <div key={engager.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-full bg-source-linkedin/10 flex items-center justify-center flex-shrink-0">
                      <Users className="h-5 w-5 text-source-linkedin" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate flex items-center gap-2">
                        {engager.name}
                        {engager.is_prospect && (
                          <Badge className="bg-amber-500 text-xs flex-shrink-0">Prospect</Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {engager.headline || engager.company || 'LinkedIn'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <Badge variant="outline" className="text-xs">
                      {engager.engagement_type === 'like' && <ThumbsUp className="h-3 w-3 mr-1 text-blue-500" />}
                      {engager.engagement_type === 'comment' && <MessageCircle className="h-3 w-3 mr-1 text-emerald-500" />}
                      {engager.engagement_type === 'share' && <Share2 className="h-3 w-3 mr-1 text-violet-500" />}
                      {engager.engagement_type}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Aucun nouvel engager"
              description="Lancez un scan pour détecter les nouvelles interactions."
            />
          )}
        </CardContent>
      </Card>

      {/* Section: Vue par post */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Newspaper className="h-5 w-5 text-muted-foreground" />
              Engagements par post
              <Badge variant="secondary" className="ml-2">{postsWithEngagers.length} posts</Badge>
            </CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Répartition des engagers par publication LinkedIn
          </p>
        </CardHeader>
        <CardContent>
          {postsWithEngagers.length > 0 ? (
            <div className="space-y-4">
              {postsWithEngagers.slice(0, 5).map(post => (
                <div key={post.id} className="border rounded-lg overflow-hidden">
                  {/* En-tête du post */}
                  <div className="p-4 bg-muted/20 border-b">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-medium text-foreground truncate">
                          {post.title || 'Post LinkedIn'}
                        </h4>
                        {post.content && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {post.content}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge className="bg-source-linkedin">
                          {post.engagersCount} engager{post.engagersCount > 1 ? 's' : ''}
                        </Badge>
                        {post.newEngagersCount > 0 && (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-600">
                            +{post.newEngagersCount} nouveau{post.newEngagersCount > 1 ? 'x' : ''}
                          </Badge>
                        )}
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => window.open(post.post_url, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {/* Stats du post */}
                    <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <ThumbsUp className="h-3.5 w-3.5" />
                        {post.likes_count || 0}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" />
                        {post.comments_count || 0}
                      </span>
                      <span className="flex items-center gap-1">
                        <Share2 className="h-3.5 w-3.5" />
                        {post.shares_count || 0}
                      </span>
                      {post.last_scraped_at && (
                        <span className="text-xs ml-auto">
                          Scanné {formatDistanceToNow(new Date(post.last_scraped_at), { addSuffix: true, locale: fr })}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Liste des engagers du post (max 4) */}
                  <div className="p-3 space-y-2">
                    {post.engagers.slice(0, 4).map(engager => (
                      <div key={engager.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <span className="text-sm font-medium truncate block">
                              {engager.name}
                            </span>
                            {(engager.company || engager.headline) && (
                              <span className="text-xs text-muted-foreground truncate block">
                                {engager.company || engager.headline}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {engager.is_prospect && (
                            <Star className="h-3.5 w-3.5 text-amber-500" />
                          )}
                          <Badge variant="outline" className="text-xs py-0 px-1.5">
                            {engager.engagement_type === 'like' && <ThumbsUp className="h-3 w-3 text-blue-500" />}
                            {engager.engagement_type === 'comment' && <MessageCircle className="h-3 w-3 text-emerald-500" />}
                            {engager.engagement_type === 'share' && <Share2 className="h-3 w-3 text-violet-500" />}
                          </Badge>
                        </div>
                      </div>
                    ))}
                    {post.engagers.length > 4 && (
                      <div className="text-center pt-1">
                        <span className="text-xs text-muted-foreground">
                          +{post.engagers.length - 4} autres engagers
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {postsWithEngagers.length > 5 && (
                <div className="text-center pt-2">
                  <Link to="/engagers/list">
                    <Button variant="outline" size="sm">
                      Voir les {postsWithEngagers.length - 5} autres posts
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              title="Aucun post avec engagers"
              description="Ajoutez des posts LinkedIn et lancez un scan pour voir les engagements."
            />
          )}
        </CardContent>
      </Card>

      {/* Stats rapides en bas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Types d'engagement */}
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
                    <span className="font-medium">{count} ({percent}%)</span>
                  </div>
                  <Progress value={percent} className="h-1.5" />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Conversion */}
        <Card className="bg-gradient-to-br from-amber-500/5 to-amber-500/10 border-amber-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-amber-500" />
              Conversion en prospects
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-3xl font-bold text-amber-600">
                  {stats.total > 0 ? Math.round((stats.prospects / stats.total) * 100) : 0}%
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {stats.prospects} prospects sur {stats.total} engagers
                </div>
              </div>
              <div className="h-16 w-16 rounded-full bg-amber-500/20 flex items-center justify-center">
                <Star className="h-8 w-8 text-amber-500" />
              </div>
            </div>
            <Progress 
              value={stats.total > 0 ? (stats.prospects / stats.total) * 100 : 0} 
              className="h-2 mt-4" 
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
