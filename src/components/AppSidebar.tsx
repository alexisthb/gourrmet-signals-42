import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Radio, 
  Settings, 
  Radar, 
  Sparkles, 
  Users, 
  HelpCircle,
  Newspaper,
  Building2,
  Calendar,
  Search,
  ShoppingCart,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileText,
  Wine,
  Presentation
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// Navigation structure with groups
const navGroups = [
  {
    id: 'main',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    ]
  },
  {
    id: 'veille',
    label: 'Veille',
    items: [
      { to: '/signals', icon: Radio, label: 'Signaux Presse' },
      { to: '/pappers', icon: Building2, label: 'Signaux Pappers' },
      { to: '/engagers', icon: Newspaper, label: 'Signaux LinkedIn' },
      { to: '/contacts', icon: Users, label: 'Tous les contacts' },
    ]
  },
  {
    id: 'events',
    label: 'Événements',
    items: [
      { to: '/events', icon: Calendar, label: 'CRM Événements' },
      { to: '/events/scanner', icon: Search, label: 'Scanner' },
    ]
  },
  {
    id: 'orders',
    label: 'Commandes',
    items: [
      { to: '/admin/orders', icon: ShoppingCart, label: 'Gestion' },
      { to: '/admin/products', icon: FileText, label: 'Catalogue' },
      { to: '/admin/clients', icon: Users, label: 'Clients' },
    ]
  },
  {
    id: 'partners',
    label: 'Partenaires',
    items: [
      { to: '/partners', icon: Wine, label: 'Maisons Partenaires' },
    ]
  },
  {
    id: 'presentations',
    label: 'Présentations',
    items: [
      { to: '/presentations', icon: Presentation, label: 'Présentations' },
    ]
  },
  {
    id: 'settings',
    label: 'Configuration',
    items: [
      { to: '/settings/api', icon: Cpu, label: 'Forfaits API' },
      { to: '/settings', icon: Settings, label: 'Paramètres' },
      { to: '/how-it-works', icon: HelpCircle, label: 'Aide' },
    ]
  },
];

export function AppSidebar() {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    veille: true,
    events: true,
    orders: true,
    partners: true,
    presentations: true,
  });

  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const isItemActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const isGroupActive = (items: typeof navGroups[0]['items']) => {
    return items.some(item => isItemActive(item.to));
  };

  return (
    <aside className="w-72 bg-sidebar min-h-screen flex flex-col border-r border-sidebar-border/50 relative overflow-hidden">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-sidebar-primary/5 via-transparent to-transparent pointer-events-none" />
      
      {/* Logo Section */}
      <div className="relative p-6 border-b border-sidebar-border/30">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-sidebar-primary/30 rounded-2xl blur-xl" />
            <div className="relative p-3 rounded-2xl bg-gradient-to-br from-sidebar-primary/30 to-sidebar-primary/10 border border-sidebar-primary/20">
              <Radar className="h-6 w-6 text-sidebar-primary" />
            </div>
          </div>
          <div>
            <h1 className="font-serif font-bold text-sidebar-foreground text-xl tracking-wide">
              GOUR<span className="text-sidebar-primary">Я</span>MET
            </h1>
            <p className="text-xs text-sidebar-muted flex items-center gap-1.5 mt-0.5">
              <Sparkles className="h-3 w-3 text-sidebar-primary/70" />
              Business Intelligence
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto scrollbar-thin">
        <div className="space-y-2">
          {navGroups.map((group) => {
            // Groups without labels are rendered directly
            if (!group.label) {
              return (
                <ul key={group.id} className="space-y-1">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        className={cn(
                          'sidebar-nav-item group',
                          isItemActive(item.to) && 'active'
                        )}
                      >
                        <div className={cn(
                          "p-2 rounded-lg transition-colors",
                          isItemActive(item.to) 
                            ? "bg-sidebar-primary/20 text-sidebar-primary" 
                            : "bg-sidebar-accent/50 text-sidebar-muted group-hover:text-sidebar-foreground"
                        )}>
                          <item.icon className="h-4 w-4" />
                        </div>
                        <span>{item.label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              );
            }

            // Groups with labels are collapsible
            const isOpen = openGroups[group.id] ?? false;
            const groupActive = isGroupActive(group.items);

            return (
              <Collapsible
                key={group.id}
                open={isOpen || groupActive}
                onOpenChange={() => toggleGroup(group.id)}
                className="space-y-1"
              >
                <CollapsibleTrigger className="w-full group">
                  <div className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors",
                    groupActive 
                      ? "text-sidebar-primary" 
                      : "text-sidebar-muted hover:text-sidebar-foreground/80"
                  )}>
                    <span>{group.label}</span>
                    <div className={cn(
                      "p-1 rounded-md transition-all",
                      isOpen || groupActive ? "bg-sidebar-accent/50" : ""
                    )}>
                      {isOpen || groupActive ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-1">
                  <ul className="space-y-1 ml-1">
                    {group.items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          className={cn(
                            'sidebar-nav-item group',
                            isItemActive(item.to) && 'active'
                          )}
                        >
                          <div className={cn(
                            "p-2 rounded-lg transition-colors",
                            isItemActive(item.to) 
                              ? "bg-sidebar-primary/20 text-sidebar-primary" 
                              : "bg-sidebar-accent/50 text-sidebar-muted group-hover:text-sidebar-foreground"
                          )}>
                            <item.icon className="h-4 w-4" />
                          </div>
                          <span>{item.label}</span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="relative p-4 border-t border-sidebar-border/30">
        <div className="p-4 rounded-xl bg-sidebar-accent/30 border border-sidebar-border/30">
          <div className="flex items-center gap-2 text-xs text-sidebar-muted">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span>Système actif</span>
          </div>
          <p className="text-2xs text-sidebar-muted/60 mt-2">
            Veille commerciale B2B • v2.0
          </p>
        </div>
      </div>
    </aside>
  );
}
