import { Outlet } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';

/**
 * AppLayout - design Gourrmet : sidebar fixe + colonne principale sur fond sable.
 *
 * NB : Topbar (breadcrumb + search + avatar) decrit dans handoff/skin.css n'est
 * pas encore branche en composant separe -- chaque page conserve son propre
 * header pour eviter de toucher a la logique de routing. La SyncStatusBar des
 * Dashboards Presse/Pappers joue le role de bandeau sticky pour ces pages.
 */
export function AppLayout() {
  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-auto">
        <div className="container py-10 px-8 max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
