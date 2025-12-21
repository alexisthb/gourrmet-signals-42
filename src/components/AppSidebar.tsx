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
  FileText
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
    label: 'VEILLE',
    items: [
      { to: '/signals', icon: Radio, label: 'Scanner Actu' },
      { to: '/pappers', icon: Building2, label: 'Scanner Pappers' },
      { to: '/contacts', icon: Users, label: 'Contacts' },
    ]
  },
  {
    id: 'events',
    label: 'ÉVÉNEMENTS',
    items: [
      { to: '/events', icon: Calendar, label: 'CRM Événements' },
      { to: '/events/scanner', icon: Search, label: 'Scanner Événements' },
    ]
  },
  {
    id: 'orders',
    label: 'COMMANDES',
    items: [
      { to: '/admin/orders', icon: ShoppingCart, label: 'Gestion Commandes' },
      { to: '/admin/products', icon: FileText, label: 'Catalogue' },
      { to: '/admin/clients', icon: Users, label: 'Clients' },
    ]
  },
  {
    id: 'settings',
    items: [
      { to: '/how-it-works', icon: HelpCircle, label: 'Comment ça marche' },
      { to: '/settings', icon: Settings, label: 'Configuration' },
    ]
  },
];

export function AppSidebar() {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    veille: true,
    events: true,
    orders: true,
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
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-sidebar-primary/20">
            <Radar className="h-6 w-6 text-sidebar-primary" />
          </div>
          <div>
            <h1 className="font-serif font-bold text-sidebar-foreground text-lg tracking-wide">
              GOUR<span className="text-sidebar-primary">Я</span>MET
            </h1>
            <p className="text-xs text-sidebar-foreground/60 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Business Intelligence
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <div className="space-y-4">
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
                          'sidebar-nav-item',
                          isItemActive(item.to) && 'active'
                        )}
                      >
                        <item.icon className="h-5 w-5" />
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
              >
                <CollapsibleTrigger className="w-full">
                  <div className={cn(
                    "flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground/70 transition-colors",
                    groupActive && "text-sidebar-primary/70"
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
                    {group.items.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          className={cn(
                            'sidebar-nav-item',
                            isItemActive(item.to) && 'active'
                          )}
                        >
                          <item.icon className="h-5 w-5" />
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
      <div className="p-4 border-t border-sidebar-border">
        <div className="text-xs text-sidebar-foreground/50">
          <p>Veille commerciale B2B</p>
          <p className="mt-1">v2.0.0</p>
        </div>
      </div>
    </aside>
  );
}
