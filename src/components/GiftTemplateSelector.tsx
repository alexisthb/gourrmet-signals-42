import { useState } from 'react';
import { Gift, Loader2, Download, RefreshCw, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGiftTemplates } from '@/hooks/useGiftTemplates';
import { useGenerateGiftImage, useGeneratedGifts } from '@/hooks/useGeneratedGifts';

interface GiftTemplateSelectorProps {
  signalId: string;
  companyName: string;
  hasLogo: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImageGenerated?: (url: string) => void;
}

export function GiftTemplateSelector({ signalId, companyName, hasLogo, open, onOpenChange, onImageGenerated }: GiftTemplateSelectorProps) {
  const { data: templates = [], isLoading } = useGiftTemplates(true);
  const generateGift = useGenerateGiftImage();
  const { data: generatedGifts = [], refetch: refetchGifts } = useGeneratedGifts(signalId);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [resultImage, setResultImage] = useState<string | null>(null);

  const handleSelect = async (templateId: string) => {
    if (!hasLogo || generatingIds.has(templateId)) return;
    setGeneratingIds(prev => new Set(prev).add(templateId));

    try {
      const result = await generateGift.mutateAsync({ signalId, templateId });
      refetchGifts();
      if (onImageGenerated) {
        onImageGenerated(result.generatedImageUrl);
      }
    } finally {
      setGeneratingIds(prev => {
        const next = new Set(prev);
        next.delete(templateId);
        return next;
      });
    }
  };

  const handleDownload = async (url: string) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cadeau_${companyName.replace(/\s+/g, '_')}.png`;
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            Cadeau personnalisé — {companyName}
          </DialogTitle>
        </DialogHeader>

        {!hasLogo && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-700">
            ⚠️ Veuillez d'abord récupérer le logo de l'entreprise avant de générer un cadeau personnalisé.
          </div>
        )}

        {/* Result viewer */}
        {resultImage && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Résultat :</p>
            <div className="relative rounded-lg overflow-hidden border">
              <img src={resultImage} alt="Generated gift" className="w-full" />
            </div>
            <div className="flex gap-2 flex-wrap">
              {onImageGenerated && (
                <Button onClick={() => onImageGenerated(resultImage)} size="sm">
                  <Check className="h-4 w-4 mr-2" />
                  Utiliser comme PJ
                </Button>
              )}
              <Button onClick={() => handleDownload(resultImage)} variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Télécharger
              </Button>
              <Button onClick={() => setResultImage(null)} variant="ghost" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Choisir un autre template
              </Button>
            </div>
          </div>
        )}

        {/* Template grid */}
        {!resultImage && (
          <>
            <p className="text-sm text-muted-foreground">
              Choisissez une photo de mise en scène. Le logo de {companyName} sera intégré automatiquement.
            </p>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>Aucun template configuré.</p>
                <p className="text-sm mt-1">Ajoutez des photos dans Settings → Cadeaux.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleSelect(t.id)}
                    disabled={!hasLogo || generatingIds.has(t.id)}
                    className="relative group rounded-lg overflow-hidden border border-border hover:border-primary/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t.image_url && (
                      <img
                        src={t.image_url}
                        alt={t.name}
                        className="w-full aspect-square object-cover"
                      />
                    )}
                    {generatingIds.has(t.id) && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <div className="text-center text-white">
                          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                          <p className="text-xs">Génération...</p>
                        </div>
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
                      <p className="text-white text-xs font-medium truncate">{t.name}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* History */}
        {generatedGifts.length > 0 && !resultImage && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm font-medium text-foreground mb-3">Cadeaux déjà générés :</p>
            <div className="grid grid-cols-4 gap-2">
              {generatedGifts
                .filter(g => g.status === 'completed' && g.generated_image_url)
                .slice(0, 8)
                .map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setResultImage(g.generated_image_url!)}
                    className="rounded-lg overflow-hidden border hover:border-primary/50 transition-all"
                  >
                    <img
                      src={g.generated_image_url!}
                      alt={g.company_name}
                      className="w-full aspect-square object-cover"
                    />
                  </button>
                ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
