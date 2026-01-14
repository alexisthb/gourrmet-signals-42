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
  FileText,
  Wine,
  Presentation,
  ListChecks,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const navGroups = [
  {
    id: 'main',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', color: 'coral' },
    ]
  },
  {
    id: 'veille',
    label: 'Veille',
    items: [
      { to: '/signals', icon: Radio, label: 'Signaux Presse', color: 'coral' },
      { to: '/pappers', icon: Building2, label: 'Signaux Pappers', color: 'turquoise' },
      { to: '/engagers', icon: Newspaper, label: 'Signaux LinkedIn', color: 'yellow' },
      { to: '/contacts', icon: Users, label: 'Contacts', color: 'coral' },
    ]
  },
  {
    id: 'events',
    label: 'Événements',
    items: [
      { to: '/events', icon: Calendar, label: 'CRM Événements', color: 'turquoise' },
      { to: '/events/scanner', icon: Search, label: 'Scanner', color: 'turquoise' },
      { to: '/events/scrap-list', icon: ListChecks, label: 'Scrap Exposants', color: 'turquoise' },
    ]
  },
  {
    id: 'orders',
    label: 'Commandes',
    items: [
      { to: '/admin/orders', icon: ShoppingCart, label: 'Gestion', color: 'yellow' },
      { to: '/admin/products', icon: FileText, label: 'Catalogue', color: 'yellow' },
      { to: '/admin/clients', icon: Users, label: 'Clients', color: 'yellow' },
    ]
  },
  {
    id: 'partners',
    label: 'Partenaires',
    items: [
      { to: '/partners', icon: Wine, label: 'Maisons', color: 'coral' },
    ]
  },
  {
    id: 'presentations',
    label: 'Présentations',
    items: [
      { to: '/presentations', icon: Presentation, label: 'Présentations', color: 'turquoise' },
    ]
  },
  {
    id: 'settings',
    label: 'Configuration',
    items: [
      { to: '/settings', icon: Settings, label: 'Paramètres', color: 'coral' },
      { to: '/how-it-works', icon: HelpCircle, label: 'Aide', color: 'coral' },
    ]
  },
];

const colorClasses = {
  coral: {
    active: 'bg-primary text-primary-foreground',
    icon: 'text-primary',
  },
  turquoise: {
    active: 'bg-secondary text-secondary-foreground',
    icon: 'text-secondary',
  },
  yellow: {
    active: 'bg-accent text-accent-foreground',
    icon: 'text-accent-foreground',
  },
};

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
    <aside className="w-64 bg-white min-h-screen flex flex-col border-r border-border/50 shadow-xl shadow-black/[0.03]">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary via-secondary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold text-foreground tracking-tight">
              Gouramet
            </h1>
            <p className="text-[10px] text-muted-foreground tracking-wide uppercase font-medium">
              Business Intelligence
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-1">
          {navGroups.map((group) => {
            if (!group.label) {
              return (
                <ul key={group.id} className="space-y-1 mb-4">
                  {group.items.map((item) => {
                    const isActive = isItemActive(item.to);
                    const colors = colorClasses[item.color as keyof typeof colorClasses];
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          className={cn(
                            'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                            isActive 
                              ? cn(colors.active, 'shadow-lg shadow-primary/20')
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          )}
                        >
                          <item.icon className={cn('h-5 w-5', !isActive && colors.icon)} />
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
                  <div className={cn(
                    "flex items-center justify-between px-4 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors rounded-lg",
                    groupActive 
                      ? "text-primary bg-primary/5" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}>
                    <span>{group.label}</span>
                    {isOpen || groupActive ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="space-y-1 mt-1">
                    {group.items.map((item) => {
                      const isActive = isItemActive(item.to);
                      const colors = colorClasses[item.color as keyof typeof colorClasses];
                      return (
                        <li key={item.to}>
                          <NavLink
                            to={item.to}
                            className={cn(
                              'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                              isActive 
                                ? cn(colors.active, 'shadow-md')
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                          >
                            <item.icon className={cn('h-4 w-4', !isActive && colors.icon)} />
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

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border/50 bg-gradient-to-r from-primary/5 via-secondary/5 to-accent/5">
        <div className="flex items-center gap-3">
          <div className="h-2.5 w-2.5 rounded-full bg-secondary animate-pulse shadow-lg shadow-secondary/50" />
          <span className="text-xs font-medium text-muted-foreground">Système connecté</span>
        </div>
      </div>
    </aside>
  );
}
