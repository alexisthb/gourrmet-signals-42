import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Radio,
  Settings,
  Users,
  HelpCircle,
  Newspaper,
  Building2,
  Calendar,
  Heart,
  ShoppingCart,
  ChevronDown,
  ChevronRight,
  FileText,
  Wine,
  Presentation,
  LogOut,
  GitBranch,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/**
 * AppSidebar - design Gourrmet (cf. handoff/CHECKLIST.md sec. 3).
 *
 * Fond blanc (surface), bordure indigo discrete, wordmark `GOURЯMET.`
 * en Plus Jakarta 800 avec Я renverse et point final en indigo.
 * Groupes nav en mono caps eyebrow. Item actif: bg indigo-50 + texte indigo-700.
 */

const navGroups = [
  {
    id: 'main',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Vue d\'ensemble' },
      { to: '/pipeline', icon: GitBranch, label: 'Pipeline' },
    ],
  },
  {
    id: 'veille',
    label: 'Signaux',
    items: [
      { to: '/signals', icon: Radio, label: 'Presse' },
      { to: '/pappers', icon: Building2, label: 'Pappers' },
      { to: '/engagers', icon: Newspaper, label: 'LinkedIn' },
      { to: '/contacts', icon: Users, label: 'Contacts' },
    ],
  },
  {
    id: 'events',
    label: 'Événements',
    items: [
      { to: '/events', icon: Calendar, label: 'CRM Événements' },
      { to: '/events/contacts', icon: Users, label: 'Contacts Events' },
      { to: '/salon-mariage', icon: Heart, label: 'Salon du Mariage' },
    ],
  },
  {
    id: 'orders',
    label: 'Commandes',
    items: [
      { to: '/admin/orders', icon: ShoppingCart, label: 'Gestion' },
      { to: '/admin/products', icon: FileText, label: 'Catalogue' },
      { to: '/admin/clients', icon: Users, label: 'Clients' },
    ],
  },
  {
    id: 'partners',
    label: 'Partenaires',
    items: [{ to: '/partners', icon: Wine, label: 'Maisons' }],
  },
  {
    id: 'presentations',
    label: 'Présentations',
    items: [{ to: '/presentations', icon: Presentation, label: 'Présentations' }],
  },
  {
    id: 'settings',
    label: 'Système',
    items: [
      { to: '/settings', icon: Settings, label: 'Paramètres' },
      { to: '/how-it-works', icon: HelpCircle, label: 'Aide' },
    ],
  },
];

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    veille: true,
    events: true,
    orders: false,
    partners: false,
    presentations: false,
    settings: false,
  });

  const handleSignOut = async () => {
    await signOut();
    toast.success('Déconnexion réussie');
    navigate('/auth');
  };

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const isItemActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const isGroupActive = (items: typeof navGroups[0]['items']) =>
    items.some((item) => isItemActive(item.to));

  return (
    <aside className="w-64 bg-surface min-h-screen flex flex-col border-r border-border">
      {/* Wordmark GOURЯMET. — Plus Jakarta 800, Я indigo renverse, point indigo */}
      <div className="px-6 pt-7 pb-5">
        <div className="flex items-baseline gap-[1px] font-extrabold text-[22px] tracking-[-0.02em] text-navy-800 leading-none">
          <span>GOU</span>
          <span className="inline-block -scale-x-100 text-indigo-600 font-extrabold">R</span>
          <span>R</span>
          <span>M</span>
          <span>E</span>
          <span>T</span>
          <span className="text-indigo-600">.</span>
        </div>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-fg-3 font-semibold mt-2">
          Business Intelligence
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 pb-4 overflow-y-auto">
        <div className="space-y-1">
          {navGroups.map((group) => {
            if (!group.label) {
              return (
                <ul key={group.id} className="space-y-1 mb-3">
                  {group.items.map((item) => {
                    const isActive = isItemActive(item.to);
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors duration-150',
                            isActive
                              ? 'bg-indigo-50 text-indigo-700 font-semibold'
                              : 'text-fg-2 hover:bg-sable-100 hover:text-navy-800'
                          )}
                        >
                          <item.icon
                            className={cn(
                              'h-[18px] w-[18px] flex-shrink-0',
                              isActive ? 'text-indigo-600' : 'text-fg-3'
                            )}
                            strokeWidth={1.6}
                          />
                          <span>{item.label}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              );
            }

            const isOpen = openGroups[group.id] ?? false;
            const groupActive = isGroupActive(group.items);

            return (
              <Collapsible
                key={group.id}
                open={isOpen || groupActive}
                onOpenChange={() => toggleGroup(group.id)}
                className="mb-2"
              >
                <CollapsibleTrigger className="w-full">
                  <div
                    className={cn(
                      'flex items-center justify-between px-3 py-2 mt-3 text-[9.5px] font-semibold uppercase tracking-[0.2em] transition-colors rounded-md font-mono',
                      groupActive
                        ? 'text-indigo-600'
                        : 'text-fg-muted hover:text-navy-800'
                    )}
                  >
                    <span>{group.label}</span>
                    {isOpen || groupActive ? (
                      <ChevronDown className="h-3 w-3" strokeWidth={2} />
                    ) : (
                      <ChevronRight className="h-3 w-3" strokeWidth={2} />
                    )}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="space-y-0.5 mt-1">
                    {group.items.map((item) => {
                      const isActive = isItemActive(item.to);
                      return (
                        <li key={item.to}>
                          <NavLink
                            to={item.to}
                            className={cn(
                              'flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors duration-150',
                              isActive
                                ? 'bg-indigo-50 text-indigo-700 font-semibold'
                                : 'text-fg-2 hover:bg-sable-100 hover:text-navy-800'
                            )}
                          >
                            <item.icon
                              className={cn(
                                'h-[18px] w-[18px] flex-shrink-0',
                                isActive ? 'text-indigo-600' : 'text-fg-3'
                              )}
                              strokeWidth={1.6}
                            />
                            <span>{item.label}</span>
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </nav>

      {/* Footer : compte + déconnexion */}
      <div className="px-3 py-3 border-t border-border space-y-2">
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-sable-100">
          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[11px] font-bold flex-shrink-0">
            {(user?.email || '?').slice(0, 2).toUpperCase()}
          </div>
          <span className="text-xs font-medium text-fg-2 truncate min-w-0">
            {user?.email || 'Connecté'}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-fg-3 hover:text-destructive hover:bg-sable-100"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Déconnexion
        </Button>
      </div>
    </aside>
  );
}
