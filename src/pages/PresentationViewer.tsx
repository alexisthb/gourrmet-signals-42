import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  ChevronLeft, 
  ChevronRight, 
  Maximize, 
  Minimize,
  Home,
  FileText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePresentation } from '@/hooks/usePresentations';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { cn } from '@/lib/utils';

export default function PresentationViewer() {
  const { id } = useParams<{ id: string }>();
  const { data: presentation, isLoading } = usePresentation(id);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(1);

  const totalSlides = presentation?.slides_count || 1;

  const goToSlide = useCallback((slide: number) => {
    if (slide >= 1 && slide <= totalSlides) {
      setCurrentSlide(slide);
    }
  }, [totalSlides]);

  const nextSlide = useCallback(() => {
    goToSlide(currentSlide + 1);
  }, [currentSlide, goToSlide]);

  const prevSlide = useCallback(() => {
    goToSlide(currentSlide - 1);
  }, [currentSlide, goToSlide]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'Space':
        case 'Enter':
          e.preventDefault();
          nextSlide();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          prevSlide();
          break;
        case 'Home':
          e.preventDefault();
          goToSlide(1);
          break;
        case 'End':
          e.preventDefault();
          goToSlide(totalSlides);
          break;
        case 'Escape':
          if (isFullscreen) {
            setIsFullscreen(false);
          }
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextSlide, prevSlide, goToSlide, totalSlides, isFullscreen, toggleFullscreen]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (isLoading) return <LoadingSpinner />;

  if (!presentation) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <FileText className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Présentation non trouvée</h2>
        <Button asChild>
          <Link to="/presentations">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour aux présentations
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex flex-col",
      isFullscreen ? "fixed inset-0 z-50 bg-black" : "space-y-4"
    )}>
      {/* Header */}
      {!isFullscreen && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/presentations">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{presentation.title}</h1>
              {presentation.description && (
                <p className="text-muted-foreground text-sm">{presentation.description}</p>
              )}
            </div>
          </div>
          <Button variant="outline" onClick={toggleFullscreen}>
            <Maximize className="h-4 w-4 mr-2" />
            Plein écran
          </Button>
        </div>
      )}

      {/* Viewer */}
      <div className={cn(
        "relative bg-black rounded-lg overflow-hidden",
        isFullscreen ? "flex-1" : "aspect-video"
      )}>
        {presentation.file_url ? (
          presentation.file_type === 'pdf' ? (
            <iframe
              src={`${presentation.file_url}#page=${currentSlide}&toolbar=0&navpanes=0`}
              className="w-full h-full"
              title={presentation.title}
            />
          ) : (
            <img
              src={presentation.file_url}
              alt={presentation.title}
              className="w-full h-full object-contain"
            />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/50">
            <div className="text-center">
              <FileText className="h-20 w-20 mx-auto mb-4" />
              <p>Aucun fichier uploadé</p>
            </div>
          </div>
        )}

        {/* Navigation overlay */}
        <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              {isFullscreen && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-white hover:bg-white/20"
                  asChild
                >
                  <Link to="/presentations">
                    <Home className="h-5 w-5" />
                  </Link>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20"
                onClick={prevSlide}
                disabled={currentSlide <= 1}
              >
                <ChevronLeft className="h-6 w-6" />
              </Button>
              <span className="text-sm font-medium px-3">
                {currentSlide} / {totalSlides}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20"
                onClick={nextSlide}
                disabled={currentSlide >= totalSlides}
              >
                <ChevronRight className="h-6 w-6" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-white/70 mr-4">
                ← → pour naviguer • F pour plein écran
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20"
                onClick={toggleFullscreen}
              >
                {isFullscreen ? (
                  <Minimize className="h-5 w-5" />
                ) : (
                  <Maximize className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Click zones for navigation */}
        <div 
          className="absolute left-0 top-0 bottom-20 w-1/3 cursor-pointer"
          onClick={prevSlide}
        />
        <div 
          className="absolute right-0 top-0 bottom-20 w-1/3 cursor-pointer"
          onClick={nextSlide}
        />
      </div>

      {/* Slide thumbnails (when not fullscreen) */}
      {!isFullscreen && totalSlides > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {Array.from({ length: totalSlides }).map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index + 1)}
              className={cn(
                "flex-shrink-0 w-24 h-16 rounded-lg border-2 overflow-hidden transition-all",
                currentSlide === index + 1 
                  ? "border-primary ring-2 ring-primary/20" 
                  : "border-border hover:border-primary/50"
              )}
            >
              <div className="w-full h-full bg-muted flex items-center justify-center text-xs font-medium">
                {index + 1}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
