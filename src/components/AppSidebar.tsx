import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Radio, 
  Settings, 
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
  Presentation,
  ListChecks
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

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
      { to: '/contacts', icon: Users, label: 'Contacts' },
    ]
  },
  {
    id: 'events',
    label: 'Événements',
    items: [
      { to: '/events', icon: Calendar, label: 'CRM Événements' },
      { to: '/events/scanner', icon: Search, label: 'Scanner' },
      { to: '/events/scrap-list', icon: ListChecks, label: 'Scrap Exposants' },
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
      { to: '/partners', icon: Wine, label: 'Maisons' },
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
    orders: false,
    partners: false,
    presentations: false,
    settings: false,
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
    <aside className="w-64 bg-sidebar min-h-screen flex flex-col border-r border-sidebar-border">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-sidebar-border">
        <h1 className="text-xl text-sidebar-foreground tracking-tight">
          Gour<span className="text-primary">я</span>met
        </h1>
        <p className="text-[11px] text-sidebar-muted mt-0.5 tracking-wide uppercase">
          Business Intelligence
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-1">
          {navGroups.map((group) => {
            if (!group.label) {
              return (
                <ul key={group.id} className="space-y-0.5 mb-4">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        className={cn(
                          'sidebar-nav-item',
                          isItemActive(item.to) && 'active'
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </NavLink>
                    </li>
                  ))}
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
                className="mb-1"
              >
                <CollapsibleTrigger className="w-full">
                  <div className={cn(
                    "flex items-center justify-between px-3 py-2 text-[11px] font-medium uppercase tracking-wider transition-colors",
                    groupActive 
                      ? "text-primary" 
                      : "text-sidebar-muted hover:text-sidebar-foreground"
                  )}>
                    <span>{group.label}</span>
                    {isOpen || groupActive ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="space-y-0.5 mt-1">
                    {group.items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          className={cn(
                            'sidebar-nav-item',
                            isItemActive(item.to) && 'active'
                          )}
                        >
                          <item.icon className="h-4 w-4" />
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
      <div className="px-6 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-2 text-[11px] text-sidebar-muted">
          <div className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span>Connecté</span>
        </div>
      </div>
    </aside>
  );
}
