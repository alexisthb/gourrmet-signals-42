import { Link } from "react-router-dom";
import { 
  BarChart3, 
  Newspaper, 
  Building2, 
  Linkedin, 
  Users, 
  CalendarDays,
  ArrowRight,
  Sparkles,
  TrendingUp,
  Target
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const Index = () => {
  const features = [
    {
      icon: Newspaper,
      title: "Signaux Presse",
      description: "Détectez les opportunités business dans l'actualité française",
      color: "bg-primary",
      link: "/signals/presse"
    },
    {
      icon: Building2,
      title: "Signaux Pappers",
      description: "Anniversaires, nominations et levées de fonds des entreprises",
      color: "bg-secondary",
      link: "/pappers"
    },
    {
      icon: Linkedin,
      title: "Signaux LinkedIn",
      description: "Engagers qualifiés sur vos posts LinkedIn",
      color: "bg-accent",
      link: "/linkedin"
    },
    {
      icon: Users,
      title: "Contacts",
      description: "Pipeline unifié de tous vos prospects",
      color: "bg-primary",
      link: "/contacts"
    },
    {
      icon: CalendarDays,
      title: "Événements",
      description: "Salons et conférences B2B à ne pas manquer",
      color: "bg-secondary",
      link: "/events"
    },
    {
      icon: BarChart3,
      title: "Dashboard",
      description: "Vue globale sur votre activité de prospection",
      color: "bg-accent",
      link: "/dashboard"
    }
  ];

  const stats = [
    { value: "3", label: "Sources de signaux", icon: Target },
    { value: "100%", label: "Automatisé", icon: Sparkles },
    { value: "5x", label: "Plus de leads", icon: TrendingUp }
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden px-6 py-20 lg:py-32">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-secondary/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
        <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-accent/30 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        
        <div className="relative max-w-6xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary mb-8">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">Plateforme de prospection B2B</span>
          </div>
          
          <h1 className="font-display text-5xl md:text-7xl font-bold text-foreground mb-6 leading-tight">
            Gouramet
          </h1>
          
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-10 leading-relaxed">
            L'énergie de l'innovation au service de votre prospection.
            <br />
            <span className="text-foreground font-medium">Détectez, qualifiez, convertissez.</span>
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" className="text-lg px-8 py-6 rounded-2xl shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all">
              <Link to="/dashboard">
                Accéder au Dashboard
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="text-lg px-8 py-6 rounded-2xl border-2">
              <Link to="/how-it-works">
                Comment ça marche
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="px-6 py-16 bg-gradient-to-r from-primary via-secondary to-accent">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {stats.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-white/20 rounded-2xl mb-4">
                  <stat.icon className="h-6 w-6 text-white" />
                </div>
                <div className="text-4xl md:text-5xl font-display font-bold text-white mb-2">
                  {stat.value}
                </div>
                <div className="text-white/80 font-medium">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-6 py-20 lg:py-32">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-4">
              Tout ce dont vous avez besoin
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Une plateforme unifiée pour détecter et qualifier vos prospects B2B
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Link key={index} to={feature.link}>
                <Card className="group h-full border-2 border-transparent hover:border-primary/20 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 rounded-3xl overflow-hidden">
                  <CardContent className="p-8">
                    <div className={`inline-flex items-center justify-center w-14 h-14 ${feature.color} rounded-2xl mb-6 group-hover:scale-110 transition-transform`}>
                      <feature.icon className="h-7 w-7 text-white" />
                    </div>
                    <h3 className="font-display text-xl font-bold text-foreground mb-3 group-hover:text-primary transition-colors">
                      {feature.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                    <div className="mt-6 flex items-center text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                      Découvrir
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-6 py-20 bg-foreground">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white mb-6">
            Prêt à booster votre prospection ?
          </h2>
          <p className="text-lg text-white/70 mb-10 max-w-2xl mx-auto">
            Commencez dès maintenant à détecter les opportunités business et à qualifier vos prospects.
          </p>
          <Button asChild size="lg" className="text-lg px-10 py-6 rounded-2xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25">
            <Link to="/dashboard">
              Commencer maintenant
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-8 border-t border-border">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="font-display font-bold text-xl text-foreground">
            Gouramet
          </div>
          <div className="text-sm text-muted-foreground">
            © 2024 Gouramet. Plateforme de prospection B2B intelligente.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
