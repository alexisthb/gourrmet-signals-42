import { useState, useEffect } from 'react';
import { Lightbulb, Search, Sparkles, Users, Mail, TrendingUp, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Step {
  icon: React.ReactNode;
  title: string;
  description: string;
  prompt: string;
}

const STEPS: Step[] = [
  {
    icon: <Search className="h-8 w-8" />,
    title: "Veille Automatique",
    description: "Notre système scanne en continu l'actualité économique française pour détecter des signaux d'affaires : levées de fonds, nominations, expansions, distinctions...",
    prompt: "A radar scanning newspapers and digital screens, detecting golden signals and business opportunities. Corporate elegant style with gold accents."
  },
  {
    icon: <Sparkles className="h-8 w-8" />,
    title: "Analyse IA",
    description: "L'intelligence artificielle analyse chaque signal pour évaluer sa pertinence, scorer l'opportunité et identifier les décideurs clés à contacter.",
    prompt: "An AI brain made of golden neural networks analyzing data points and transforming them into golden stars. Elegant futuristic corporate style."
  },
  {
    icon: <Users className="h-8 w-8" />,
    title: "Enrichissement Contacts",
    description: "Pour chaque signal pertinent, nous enrichissons automatiquement les données avec les contacts décisionnaires : emails, LinkedIn, téléphones.",
    prompt: "A network of professional business people connected by golden lines, with contact cards floating around them. Clean corporate infographic style."
  },
  {
    icon: <Mail className="h-8 w-8" />,
    title: "Outreach Personnalisé",
    description: "Générez des messages personnalisés basés sur le contexte du signal pour maximiser vos taux de réponse et créer des connexions authentiques.",
    prompt: "Elegant golden envelopes flying towards business targets, with personalized message icons. Premium corporate mail concept."
  },
  {
    icon: <TrendingUp className="h-8 w-8" />,
    title: "Suivi & Conversion",
    description: "Suivez l'avancement de vos contacts, mesurez vos performances et convertissez plus d'opportunités en clients.",
    prompt: "A golden ascending graph with business milestones and conversion funnel. Elegant corporate dashboard visualization."
  }
];

export default function HowItWorks() {
  const [images, setImages] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});
  const [generatedAll, setGeneratedAll] = useState(false);

  const generateImage = async (stepIndex: number, prompt: string) => {
    setLoading(prev => ({ ...prev, [stepIndex]: true }));
    
    try {
      const { data, error } = await supabase.functions.invoke('generate-infographic', {
        body: { prompt, style: 'elegant corporate' }
      });

      if (error) throw error;
      
      if (data?.imageUrl) {
        setImages(prev => ({ ...prev, [stepIndex]: data.imageUrl }));
      }
    } catch (error: any) {
      console.error('Error generating image:', error);
      if (error.message?.includes('429')) {
        toast.error('Limite de requêtes atteinte. Réessayez dans quelques instants.');
      } else if (error.message?.includes('402')) {
        toast.error('Crédits insuffisants. Rechargez votre compte.');
      } else {
        toast.error('Erreur lors de la génération de l\'image');
      }
    } finally {
      setLoading(prev => ({ ...prev, [stepIndex]: false }));
    }
  };

  const generateAllImages = async () => {
    setGeneratedAll(true);
    for (let i = 0; i < STEPS.length; i++) {
      if (!images[i]) {
        await generateImage(i, STEPS[i].prompt);
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  };

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
          
          <p className="text-lg md:text-xl text-sidebar-foreground/80 max-w-3xl mx-auto mb-10">
            Découvrez comment notre plateforme transforme l'actualité économique en opportunités commerciales qualifiées pour votre entreprise.
          </p>

          <Button 
            onClick={generateAllImages}
            disabled={generatedAll && Object.keys(images).length === STEPS.length}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {generatedAll ? (
              Object.keys(images).length === STEPS.length ? (
                'Infographies générées ✓'
              ) : (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Génération en cours...
                </>
              )
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Générer les infographies IA
              </>
            )}
          </Button>
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

                {!images[index] && !loading[index] && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generateImage(index, step.prompt)}
                    className="border-primary/30 text-primary hover:bg-primary/10"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Générer l'infographie
                  </Button>
                )}
              </div>

              {/* Image/Placeholder */}
              <div className="flex-1 w-full">
                <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-gradient-to-br from-muted to-muted/50 border border-border shadow-lg">
                  {loading[index] ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                      <Loader2 className="h-10 w-10 text-primary animate-spin" />
                      <p className="text-sm text-muted-foreground">Génération en cours...</p>
                    </div>
                  ) : images[index] ? (
                    <img 
                      src={images[index]} 
                      alt={step.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8">
                      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                        {step.icon}
                      </div>
                      <p className="text-sm text-muted-foreground text-center">
                        Cliquez sur "Générer l'infographie" pour créer une illustration IA
                      </p>
                    </div>
                  )}
                  
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
