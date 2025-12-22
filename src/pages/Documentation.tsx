import { Book, Layers, Puzzle, Workflow, Palette, Code, Database, ArrowLeft, Radar, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const Documentation = () => {
  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link to="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/20">
            <Radar className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="font-serif font-bold text-2xl tracking-wide">
              GOUR<span className="text-primary">Я</span>MET
            </h1>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Documentation Complète
            </p>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <Card className="mb-8 bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
        <CardContent className="pt-6">
          <h2 className="text-xl font-semibold mb-2">Plateforme de Veille Commerciale B2B</h2>
          <p className="text-muted-foreground mb-4">
            GOURЯMET détecte automatiquement des opportunités business via 3 sources principales :
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 p-3 bg-background/50 rounded-lg">
              <Badge className="bg-source-presse/20 text-source-presse border-0">Presse</Badge>
              <span className="text-sm">Analyse d'articles pour identifier des événements commerciaux</span>
            </div>
            <div className="flex items-center gap-3 p-3 bg-background/50 rounded-lg">
              <Badge className="bg-source-pappers/20 text-source-pappers border-0">Pappers</Badge>
              <span className="text-sm">Données légales (anniversaires, nominations, levées)</span>
            </div>
            <div className="flex items-center gap-3 p-3 bg-background/50 rounded-lg">
              <Badge className="bg-source-linkedin/20 text-source-linkedin border-0">LinkedIn</Badge>
              <span className="text-sm">Engagement sur posts pour identifier des prospects</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="flex flex-wrap h-auto gap-2">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <Book className="h-4 w-4" />
            Vue d'ensemble
          </TabsTrigger>
          <TabsTrigger value="architecture" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Architecture
          </TabsTrigger>
          <TabsTrigger value="modules" className="flex items-center gap-2">
            <Puzzle className="h-4 w-4" />
            Modules
          </TabsTrigger>
          <TabsTrigger value="workflows" className="flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            Workflows
          </TabsTrigger>
          <TabsTrigger value="design" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Design System
          </TabsTrigger>
          <TabsTrigger value="apis" className="flex items-center gap-2">
            <Code className="h-4 w-4" />
            APIs
          </TabsTrigger>
          <TabsTrigger value="database" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Base de données
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Mission</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p>
                GOURЯMET est une plateforme de veille commerciale B2B qui détecte automatiquement des opportunités business.
              </p>
              <div className="space-y-2">
                <h4 className="font-medium">Proposition de valeur :</h4>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Détection automatique de signaux d'achat</li>
                  <li>Enrichissement de contacts (emails, téléphones, profils LinkedIn)</li>
                  <li>Pipeline unifié de prospection</li>
                  <li>Suivi du CRM événementiel</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>KPIs Dashboard</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>KPI</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Signaux totaux</TableCell>
                    <TableCell>Somme des signaux Presse + Pappers + LinkedIn</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Contacts enrichis</TableCell>
                    <TableCell>Total des contacts avec données complètes</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Taux conversion</TableCell>
                    <TableCell>% de contacts convertis / total</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Actions aujourd'hui</TableCell>
                    <TableCell>Enrichissements + nouveaux contacts du jour</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Architecture Tab */}
        <TabsContent value="architecture" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Stack Technologique</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Composant</TableHead>
                    <TableHead>Technologie</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Frontend</TableCell>
                    <TableCell>React 18 + TypeScript + Vite</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Styling</TableCell>
                    <TableCell>Tailwind CSS + shadcn/ui</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">State Management</TableCell>
                    <TableCell>TanStack React Query</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Routing</TableCell>
                    <TableCell>React Router DOM v6</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Backend</TableCell>
                    <TableCell>Supabase (Lovable Cloud)</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Edge Functions</TableCell>
                    <TableCell>Deno (Supabase Functions)</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">IA</TableCell>
                    <TableCell>Manus AI Agent</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Scraping</TableCell>
                    <TableCell>Apify Actors</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Données légales</TableCell>
                    <TableCell>API Pappers</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Structure des Fichiers</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
{`src/
├── pages/              # Pages principales
│   ├── Dashboard.tsx
│   ├── SignalsPresseDashboard.tsx
│   ├── SignalsPresseList.tsx
│   ├── SignalDetail.tsx
│   ├── PappersDashboard.tsx
│   ├── PappersQueries.tsx
│   ├── LinkedInDashboard.tsx
│   ├── LinkedInEngagers.tsx
│   ├── ContactsList.tsx
│   ├── EventsCalendar.tsx
│   └── Settings.tsx
├── components/         # Composants réutilisables
├── hooks/              # Hooks React Query
├── types/              # Types TypeScript
└── integrations/       # Client Supabase

supabase/
└── functions/          # Edge Functions
    ├── scan-linkedin-manus/
    ├── check-linkedin-scan-status/
    ├── fetch-news/
    ├── analyze-articles/
    ├── run-pappers-scan/
    ├── trigger-manus-enrichment/
    └── generate-message/`}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Modules Tab */}
        <TabsContent value="modules" className="space-y-6">
          <div className="grid gap-6">
            {/* Signaux Presse */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge className="bg-source-presse/20 text-source-presse border-0">Presse</Badge>
                  Signaux Presse
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  Détection d'opportunités via l'analyse automatique d'articles de presse.
                </p>
                <div>
                  <h4 className="font-medium mb-2">Types de signaux détectés :</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <Badge variant="outline">🎂 Anniversaire</Badge>
                    <Badge variant="outline">💰 Levée de fonds</Badge>
                    <Badge variant="outline">🤝 Fusion/Acquisition</Badge>
                    <Badge variant="outline">🏆 Distinction</Badge>
                    <Badge variant="outline">🏢 Expansion</Badge>
                    <Badge variant="outline">👔 Nomination</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Signaux Pappers */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge className="bg-source-pappers/20 text-source-pappers border-0">Pappers</Badge>
                  Signaux Pappers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  Détection de leads via l'API Pappers (données légales françaises).
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Anniversaire</TableCell>
                      <TableCell>Entreprise qui fête X années (5, 10, 15...)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Nomination</TableCell>
                      <TableCell>Nouveau dirigeant enregistré</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Levée de fonds</TableCell>
                      <TableCell>Augmentation de capital</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Déménagement</TableCell>
                      <TableCell>Changement de siège social</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Création</TableCell>
                      <TableCell>Nouvelle entreprise créée</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Signaux LinkedIn */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge className="bg-source-linkedin/20 text-source-linkedin border-0">LinkedIn</Badge>
                  Signaux LinkedIn
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  Identification de prospects via les engagements sur posts LinkedIn.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Commentaire</TableCell>
                      <TableCell>80</TableCell>
                      <TableCell>Engagement fort, intention claire</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Partage</TableCell>
                      <TableCell>75</TableCell>
                      <TableCell>Engagement moyen</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Like</TableCell>
                      <TableCell>70</TableCell>
                      <TableCell>Engagement faible</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Contacts */}
            <Card>
              <CardHeader>
                <CardTitle>Tous les Contacts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">
                  Liste unifiée de tous les contacts enrichis, toutes sources confondues.
                </p>
                <div>
                  <h4 className="font-medium mb-2">Statuts de prospection :</h4>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">Nouveau</Badge>
                    <Badge variant="secondary">LinkedIn envoyé</Badge>
                    <Badge variant="secondary">Email envoyé</Badge>
                    <Badge variant="secondary">A répondu</Badge>
                    <Badge variant="secondary">RDV planifié</Badge>
                    <Badge variant="secondary">Converti</Badge>
                    <Badge variant="secondary">Pas intéressé</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Workflows Tab */}
        <TabsContent value="workflows" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Workflow Presse</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge>Requêtes de recherche</Badge>
                  <span>→</span>
                  <Badge variant="outline">fetch-news (NewsAPI)</Badge>
                  <span>→</span>
                  <Badge variant="outline">raw_articles</Badge>
                  <span>→</span>
                  <Badge variant="outline">analyze-articles (IA)</Badge>
                  <span>→</span>
                  <Badge variant="outline">signals</Badge>
                  <span>→</span>
                  <Badge variant="outline">trigger-manus-enrichment</Badge>
                  <span>→</span>
                  <Badge>contacts</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workflow LinkedIn</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge>Sources LinkedIn</Badge>
                  <span>→</span>
                  <Badge variant="outline">scan-linkedin-manus</Badge>
                  <span>→</span>
                  <Badge variant="outline">Manus Task</Badge>
                  <span>→</span>
                  <Badge variant="outline">Apify scrapers</Badge>
                  <span>→</span>
                  <Badge variant="outline">linkedin_posts</Badge>
                  <span>→</span>
                  <Badge variant="outline">linkedin_engagers</Badge>
                  <span>→</span>
                  <Badge>contacts</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Workflow Pappers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge>Requêtes Pappers</Badge>
                  <span>→</span>
                  <Badge variant="outline">run-pappers-scan</Badge>
                  <span>→</span>
                  <Badge variant="outline">API Pappers</Badge>
                  <span>→</span>
                  <Badge variant="outline">pappers_signals</Badge>
                  <span>→</span>
                  <Badge variant="outline">Transfert manuel</Badge>
                  <span>→</span>
                  <Badge variant="outline">signals</Badge>
                  <span>→</span>
                  <Badge>contacts</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Design System Tab */}
        <TabsContent value="design" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Palette de Couleurs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <div className="h-12 rounded-lg bg-primary"></div>
                  <p className="text-sm font-medium">Primary (Or)</p>
                </div>
                <div className="space-y-2">
                  <div className="h-12 rounded-lg bg-source-presse"></div>
                  <p className="text-sm font-medium">Source Presse</p>
                </div>
                <div className="space-y-2">
                  <div className="h-12 rounded-lg bg-source-pappers"></div>
                  <p className="text-sm font-medium">Source Pappers</p>
                </div>
                <div className="space-y-2">
                  <div className="h-12 rounded-lg bg-source-linkedin"></div>
                  <p className="text-sm font-medium">Source LinkedIn</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Typographie</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usage</TableHead>
                    <TableHead>Police</TableHead>
                    <TableHead>Exemple</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Titres</TableCell>
                    <TableCell>Cormorant Garamond</TableCell>
                    <TableCell className="font-serif text-lg">GOURЯMET</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Corps</TableCell>
                    <TableCell>Inter</TableCell>
                    <TableCell className="font-sans">Texte standard</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Code</TableCell>
                    <TableCell>JetBrains Mono</TableCell>
                    <TableCell className="font-mono text-sm">const data = {}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* APIs Tab */}
        <TabsContent value="apis" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>APIs Externes</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Clé requise</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Manus AI</TableCell>
                    <TableCell>Orchestration de scraping + enrichissement</TableCell>
                    <TableCell><code className="text-xs bg-muted px-1 rounded">MANUS_API_KEY</code></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Apify</TableCell>
                    <TableCell>Scrapers LinkedIn, profils, emails</TableCell>
                    <TableCell><code className="text-xs bg-muted px-1 rounded">APIFY_API_KEY</code></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Pappers</TableCell>
                    <TableCell>Données légales entreprises FR</TableCell>
                    <TableCell><code className="text-xs bg-muted px-1 rounded">PAPPERS_API_KEY</code></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">NewsAPI</TableCell>
                    <TableCell>Récupération d'articles de presse</TableCell>
                    <TableCell><code className="text-xs bg-muted px-1 rounded">NEWSAPI_KEY</code></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Anthropic</TableCell>
                    <TableCell>Analyse d'articles (fallback)</TableCell>
                    <TableCell><code className="text-xs bg-muted px-1 rounded">ANTHROPIC_API_KEY</code></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Edge Functions</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fonction</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-mono text-sm">scan-linkedin-manus</TableCell>
                    <TableCell>Lance un scan LinkedIn via Manus</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">check-linkedin-scan-status</TableCell>
                    <TableCell>Polling du statut Manus + traitement résultats</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">fetch-news</TableCell>
                    <TableCell>Récupère les articles via NewsAPI</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">analyze-articles</TableCell>
                    <TableCell>Analyse IA des articles pour extraire signaux</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">run-pappers-scan</TableCell>
                    <TableCell>Scan des données Pappers</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">trigger-manus-enrichment</TableCell>
                    <TableCell>Enrichissement d'un signal via Manus</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">generate-message</TableCell>
                    <TableCell>Génère des messages de prospection personnalisés</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Database Tab */}
        <TabsContent value="database" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Table: signals</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Colonne</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-mono text-sm">id</TableCell>
                    <TableCell>UUID</TableCell>
                    <TableCell>Identifiant unique</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">company_name</TableCell>
                    <TableCell>TEXT</TableCell>
                    <TableCell>Nom de l'entreprise</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">signal_type</TableCell>
                    <TableCell>TEXT</TableCell>
                    <TableCell>Type (anniversaire, levee, etc.)</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">score</TableCell>
                    <TableCell>INT</TableCell>
                    <TableCell>Score de pertinence (1-5)</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">status</TableCell>
                    <TableCell>TEXT</TableCell>
                    <TableCell>Statut pipeline</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">source_name</TableCell>
                    <TableCell>TEXT</TableCell>
                    <TableCell>Origine (LinkedIn, Presse...)</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Table: contacts</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Colonne</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-mono text-sm">id</TableCell>
                    <TableCell>UUID</TableCell>
                    <TableCell>Identifiant unique</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">signal_id</TableCell>
                    <TableCell>UUID</TableCell>
                    <TableCell>FK vers signals</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">full_name</TableCell>
                    <TableCell>TEXT</TableCell>
                    <TableCell>Nom complet</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">email_principal</TableCell>
                    <TableCell>TEXT</TableCell>
                    <TableCell>Email professionnel</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">linkedin_url</TableCell>
                    <TableCell>TEXT</TableCell>
                    <TableCell>Profil LinkedIn</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono text-sm">outreach_status</TableCell>
                    <TableCell>TEXT</TableCell>
                    <TableCell>Statut prospection</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tables de suivi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p><code className="bg-muted px-2 py-1 rounded text-sm">linkedin_scan_progress</code> - Suivi des scans LinkedIn Manus en cours</p>
              <p><code className="bg-muted px-2 py-1 rounded text-sm">pappers_scan_progress</code> - Suivi des scans Pappers</p>
              <p><code className="bg-muted px-2 py-1 rounded text-sm">company_enrichment</code> - Suivi des enrichissements Manus par signal</p>
              <p><code className="bg-muted px-2 py-1 rounded text-sm">apify_credit_usage / manus_credit_usage / pappers_credit_usage</code> - Suivi de la consommation des crédits API</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="mt-12 pt-6 border-t text-center text-sm text-muted-foreground">
        <p>Document généré le 21 décembre 2025 — Version 2.0.0</p>
      </div>
    </div>
  );
};

export default Documentation;
