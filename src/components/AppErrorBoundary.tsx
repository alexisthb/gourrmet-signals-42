import { Component, type ErrorInfo, type ReactNode } from "react";

// Le filet sous le funambule. Sans Error Boundary, toute exception de rendu —
// y compris un chunk périmé dont le rechargement automatique a déjà servi —
// laissait une page BLANCHE, sans un mot (audit 2026-08-22). Une opératrice
// devant une page blanche ne sait ni ce qui s'est passé, ni si ses données
// sont perdues, ni quoi faire. Ce composant remplace ce silence par un
// message et un geste : recharger.
//
// Il n'essaie PAS d'être intelligent : pas de retry automatique (le retry de
// chunk a son propre mécanisme, borné), pas d'envoi de télémétrie. Il dit ce
// qui est vrai et rend la main.

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-semibold text-foreground">
            Une erreur a interrompu l'affichage
          </h1>
          <p className="text-sm text-muted-foreground">
            Vos données sont intactes — c'est l'affichage qui s'est arrêté,
            souvent après une mise à jour de l'application. Recharger la page
            suffit dans la plupart des cas.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Recharger la page
          </button>
          <p className="text-xs text-muted-foreground/70 break-all">
            {this.state.error.message}
          </p>
        </div>
      </div>
    );
  }
}
