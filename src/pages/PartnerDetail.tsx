import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  Building2, 
  Globe, 
  Linkedin, 
  Instagram, 
  Plus,
  Package,
  Calendar,
  Newspaper,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
  Star
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePartnerHouse, usePartnerNews, useDeletePartnerNews, PartnerNews } from '@/hooks/usePartnerHouses';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { PartnerNewsDialog } from '@/components/PartnerNewsDialog';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const NEWS_TYPE_CONFIG = {
  product: { label: 'Produit', icon: Package, color: 'bg-blue-500/10 text-blue-500' },
  event: { label: 'Événement', icon: Calendar, color: 'bg-purple-500/10 text-purple-500' },
  press: { label: 'Presse', icon: Newspaper, color: 'bg-green-500/10 text-green-500' },
  social: { label: 'Social', icon: MessageSquare, color: 'bg-orange-500/10 text-orange-500' },
};

function NewsCard({ news, onEdit, onDelete }: { news: PartnerNews; onEdit: () => void; onDelete: () => void }) {
  const config = NEWS_TYPE_CONFIG[news.news_type];
  const Icon = config.icon;

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={config.color}>
              <Icon className="h-3 w-3 mr-1" />
              {config.label}
            </Badge>
            {news.is_featured && (
              <Badge variant="outline" className="border-yellow-500 text-yellow-500">
                <Star className="h-3 w-3 mr-1" />
                À la une
              </Badge>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4 mr-2" />
                Modifier
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CardTitle className="text-lg mt-2">{news.title}</CardTitle>
        {news.published_at && (
          <p className="text-xs text-muted-foreground">
            {format(new Date(news.published_at), 'dd MMMM yyyy', { locale: fr })}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {news.image_url && (
          <img
            src={news.image_url}
            alt={news.title}
            className="w-full h-40 object-cover rounded-lg"
          />
        )}
        {news.content && (
          <p className="text-sm text-muted-foreground line-clamp-3">{news.content}</p>
        )}
        {news.news_type === 'product' && news.product_name && (
          <div className="flex items-center gap-2 text-sm">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span>{news.product_name}</span>
            {news.product_category && (
              <Badge variant="outline" className="text-xs">{news.product_category}</Badge>
            )}
          </div>
        )}
        {news.news_type === 'event' && news.event_date && (
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>{format(new Date(news.event_date), 'dd MMMM yyyy', { locale: fr })}</span>
            {news.event_location && <span className="text-muted-foreground">• {news.event_location}</span>}
          </div>
        )}
        {news.source_url && (
          <a
            href={news.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline"
          >
            Voir la source →
          </a>
        )}
      </CardContent>
    </Card>
  );
}

export default function PartnerDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: house, isLoading: houseLoading } = usePartnerHouse(id);
  const { data: news, isLoading: newsLoading } = usePartnerNews(id);
  const deleteNews = useDeletePartnerNews();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNews, setEditingNews] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('all');

  const handleEdit = (newsId: string) => {
    setEditingNews(newsId);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (deleteId) {
      await deleteNews.mutateAsync(deleteId);
      setDeleteId(null);
    }
  };

  const filteredNews = news?.filter(n => activeTab === 'all' || n.news_type === activeTab) || [];

  if (houseLoading || newsLoading) return <LoadingSpinner />;
  if (!house) return <div>Maison non trouvée</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/partners">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            {house.logo_url ? (
              <img
                src={house.logo_url}
                alt={house.name}
                className="h-14 w-14 rounded-lg object-cover"
              />
            ) : (
              <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center">
                <Building2 className="h-7 w-7 text-primary" />
              </div>
            )}
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{house.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                {house.category && (
                  <Badge variant="secondary">{house.category}</Badge>
                )}
                {house.website_url && (
                  <a
                    href={house.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Globe className="h-4 w-4" />
                  </a>
                )}
                {house.linkedin_url && (
                  <a
                    href={house.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Linkedin className="h-4 w-4" />
                  </a>
                )}
                {house.instagram_url && (
                  <a
                    href={house.instagram_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Instagram className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
        <Button onClick={() => { setEditingNews(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Nouvelle Actualité
        </Button>
      </div>

      {house.description && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{house.description}</p>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">Tout</TabsTrigger>
          <TabsTrigger value="product">
            <Package className="h-4 w-4 mr-1" />
            Produits
          </TabsTrigger>
          <TabsTrigger value="event">
            <Calendar className="h-4 w-4 mr-1" />
            Événements
          </TabsTrigger>
          <TabsTrigger value="press">
            <Newspaper className="h-4 w-4 mr-1" />
            Presse
          </TabsTrigger>
          <TabsTrigger value="social">
            <MessageSquare className="h-4 w-4 mr-1" />
            Social
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          {filteredNews.length === 0 ? (
            <EmptyState
              icon={Newspaper}
              title="Aucune actualité"
              description="Ajoutez la première actualité pour cette maison."
              action={
                <Button onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter une actualité
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredNews.map((item) => (
                <NewsCard
                  key={item.id}
                  news={item}
                  onEdit={() => handleEdit(item.id)}
                  onDelete={() => setDeleteId(item.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <PartnerNewsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        houseId={id!}
        newsId={editingNews}
      />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette actualité ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
