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
  Building2
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Types pour les engagers
interface Engager {
  id: string;
  name: string;
  headline: string;
  company?: string;
  linkedinUrl?: string;
  engagementType: 'like' | 'comment' | 'share';
  postTitle: string;
  postDate: string;
  scrapedAt: string;
  isProspect: boolean;
}

// Données de démonstration
const mockEngagers: Engager[] = [
  {
    id: '1',
    name: 'Marie Dupont',
    headline: 'Directrice Marketing chez TechCorp',
    company: 'TechCorp',
    linkedinUrl: 'https://linkedin.com/in/marie-dupont',
    engagementType: 'like',
    postTitle: 'Les tendances du gifting B2B en 2025',
    postDate: '2024-12-20',
    scrapedAt: '2024-12-21T10:30:00',
    isProspect: true,
  },
  {
    id: '2',
    name: 'Jean Martin',
    headline: 'CEO @ StartupXYZ | Speaker | Entrepreneur',
    company: 'StartupXYZ',
    linkedinUrl: 'https://linkedin.com/in/jean-martin',
    engagementType: 'comment',
    postTitle: 'Les tendances du gifting B2B en 2025',
    postDate: '2024-12-20',
    scrapedAt: '2024-12-21T10:30:00',
    isProspect: false,
  },
  {
    id: '3',
    name: 'Sophie Bernard',
    headline: 'Responsable RH | People & Culture',
    company: 'GrandGroupe SA',
    linkedinUrl: 'https://linkedin.com/in/sophie-bernard',
    engagementType: 'share',
    postTitle: 'Comment fidéliser vos équipes avec le gifting',
    postDate: '2024-12-18',
    scrapedAt: '2024-12-21T09:15:00',
    isProspect: true,
  },
  {
    id: '4',
    name: 'Pierre Leroy',
    headline: 'Directeur Commercial | B2B Sales',
    company: 'IndustrieMax',
    linkedinUrl: 'https://linkedin.com/in/pierre-leroy',
    engagementType: 'like',
    postTitle: 'Comment fidéliser vos équipes avec le gifting',
    postDate: '2024-12-18',
    scrapedAt: '2024-12-21T09:15:00',
    isProspect: true,
  },
];

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

export default function EngagersScraps() {
  const [searchTerm, setSearchTerm] = useState('');
  const [engagers] = useState<Engager[]>(mockEngagers);
  const [isScanning, setIsScanning] = useState(false);

  const filteredEngagers = engagers.filter(e => 
    e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.headline.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleScan = async () => {
    setIsScanning(true);
    // Simulation d'un scan
    await new Promise(resolve => setTimeout(resolve, 2000));
    setIsScanning(false);
  };

  const stats = {
    total: engagers.length,
    likes: engagers.filter(e => e.engagementType === 'like').length,
    comments: engagers.filter(e => e.engagementType === 'comment').length,
    shares: engagers.filter(e => e.engagementType === 'share').length,
    prospects: engagers.filter(e => e.isProspect).length,
  };

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
        <Button 
          onClick={handleScan}
          disabled={isScanning}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
          {isScanning ? 'Scan en cours...' : 'Lancer le scan'}
        </Button>
      </div>

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
            <User className="h-5 w-5 text-primary" />
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
                const EngagementIcon = engagementIcons[engager.engagementType];
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
                            {engager.isProspect && (
                              <Badge variant="default" className="text-xs">Prospect</Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                            {engager.headline}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {engager.company && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Building2 className="h-4 w-4" />
                          {engager.company}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        <EngagementIcon className="h-3 w-3" />
                        {engagementLabels[engager.engagementType]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                        {engager.postTitle}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {new Date(engager.postDate).toLocaleDateString('fr-FR')}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {engager.linkedinUrl && (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={engager.linkedinUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
