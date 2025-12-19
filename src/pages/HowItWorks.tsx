import { Lightbulb, Search, Sparkles, Users, Mail, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

import infographicVeille from '@/assets/infographic-veille.png';
import infographicAnalyse from '@/assets/infographic-analyse.png';
import infographicContacts from '@/assets/infographic-contacts.png';
import infographicOutreach from '@/assets/infographic-outreach.png';
import infographicConversion from '@/assets/infographic-conversion.png';

interface Step {
  icon: React.ReactNode;
  title: string;
  description: string;
  image: string;
}

const STEPS: Step[] = [
  {
    icon: <Search className="h-8 w-8" />,
    title: "Veille Automatique",
    description: "Notre système scanne en continu l'actualité économique française pour détecter des signaux d'affaires : levées de fonds, nominations, expansions, distinctions...",
    image: infographicVeille
  },
  {
    icon: <Sparkles className="h-8 w-8" />,
    title: "Analyse IA",
    description: "L'intelligence artificielle analyse chaque signal pour évaluer sa pertinence, scorer l'opportunité et identifier les décideurs clés à contacter.",
    image: infographicAnalyse
  },
  {
    icon: <Users className="h-8 w-8" />,
    title: "Enrichissement Contacts",
    description: "Pour chaque signal pertinent, nous enrichissons automatiquement les données avec les contacts décisionnaires : emails, LinkedIn, téléphones.",
    image: infographicContacts
  },
  {
    icon: <Mail className="h-8 w-8" />,
    title: "Outreach Personnalisé",
    description: "Générez des messages personnalisés basés sur le contexte du signal pour maximiser vos taux de réponse et créer des connexions authentiques.",
    image: infographicOutreach
  },
  {
    icon: <TrendingUp className="h-8 w-8" />,
    title: "Suivi & Conversion",
    description: "Suivez l'avancement de vos contacts, mesurez vos performances et convertissez plus d'opportunités en clients.",
    image: infographicConversion
  }
];

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-sidebar to-sidebar/90 text-sidebar-foreground">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%23C4A35A%22%20fill-opacity%3D%220.05%22%3E%3Cpath%20d%3D%22M36%2034v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6%2034v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6%204V0H4v4H0v2h4v4h2V6h4V4H6z%22%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E')] opacity-50" />
        
        <div className="relative max-w-6xl mx-auto px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 bg-primary/20 text-primary px-4 py-2 rounded-full mb-6">
            <Lightbulb className="h-4 w-4" />
            <span className="text-sm font-medium">Guide d'utilisation</span>
          </div>
          
          <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            Comment ça <span className="text-primary">marche</span> ?
          </h1>
          
          <p className="text-lg md:text-xl text-sidebar-foreground/80 max-w-3xl mx-auto">
            Découvrez comment notre plateforme transforme l'actualité économique en opportunités commerciales qualifiées pour votre entreprise.
          </p>
        </div>
      </div>

      {/* Steps Section */}
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="space-y-24">
          {STEPS.map((step, index) => (
            <div 
              key={index}
              className={`flex flex-col ${index % 2 === 0 ? 'lg:flex-row' : 'lg:flex-row-reverse'} items-center gap-12`}
            >
              {/* Content */}
              <div className="flex-1 space-y-6">
                <div className="inline-flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    {step.icon}
                  </div>
                  <span className="text-sm font-medium text-primary">Étape {index + 1}</span>
                </div>
                
                <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground">
                  {step.title}
                </h2>
                
                <p className="text-lg text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>

              {/* Image */}
              <div className="flex-1 w-full">
                <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-gradient-to-br from-muted to-muted/50 border border-border shadow-lg">
                  <img 
                    src={step.image} 
                    alt={step.title}
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Decorative elements */}
                  <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-primary/30 rounded-tr-lg" />
                  <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-primary/30 rounded-bl-lg" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Section */}
      <div className="bg-muted/50 border-t border-border">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-6">
            Prêt à détecter vos prochaines opportunités ?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Commencez dès maintenant à transformer l'actualité économique en croissance pour votre entreprise.
          </p>
          <Button 
            size="lg" 
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={() => window.location.href = '/'}
          >
            Accéder au Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
