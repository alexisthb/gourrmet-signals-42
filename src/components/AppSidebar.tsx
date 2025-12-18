import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Radio, Settings, Radar, Sparkles, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/signals', icon: Radio, label: 'Signaux' },
  { to: '/contacts', icon: Users, label: 'Contacts' },
  { to: '/settings', icon: Settings, label: 'Configuration' },
];

export function AppSidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 bg-sidebar min-h-screen flex flex-col border-r border-sidebar-border">
      {/* Logo */}
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-sidebar-primary/20">
            <Radar className="h-6 w-6 text-sidebar-primary" />
          </div>
          <div>
            <h1 className="font-bold text-sidebar-foreground text-lg">Signal Scanner</h1>
            <p className="text-xs text-sidebar-foreground/60 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              Gourmet Edition
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.to || 
              (item.to === '/signals' && location.pathname.startsWith('/signals/'));
            
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={cn(
                    'sidebar-nav-item',
                    isActive && 'active'
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border">
        <div className="text-xs text-sidebar-foreground/50">
          <p>Veille commerciale B2B</p>
          <p className="mt-1">v1.0.0</p>
        </div>
      </div>
    </aside>
  );
}
