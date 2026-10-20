import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { AppSidebar } from './AppSidebar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';

/**
 * AppLayout - design Gourrmet : sidebar fixe + colonne principale sur fond sable.
 *
 * NB : Topbar (breadcrumb + search + avatar) decrit dans handoff/skin.css n'est
 * pas encore branche en composant separe -- chaque page conserve son propre
 * header pour eviter de toucher a la logique de routing. La SyncStatusBar des
 * Dashboards Presse/Pappers joue le role de bandeau sticky pour ces pages.
 */
export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  return (
    <div className="flex min-h-screen w-full bg-background">
      <div className="hidden md:block shrink-0"><AppSidebar /></div>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-64 p-0 overflow-y-auto">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Rubriques de GOURЯMET</SheetDescription>
          <AppSidebar />
        </SheetContent>
      </Sheet>
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="md:hidden border-b border-border px-4 py-2">
          <Button variant="ghost" size="icon" onClick={() => setMenuOpen(true)} aria-label="Ouvrir le menu"><Menu className="h-5 w-5" /></Button>
        </div>
        <div className="container py-6 md:py-10 px-4 md:px-8 max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
