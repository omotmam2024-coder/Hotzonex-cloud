import { Dialog as D } from 'radix-ui';
import {
  CloudOff,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Monitor,
  Moon,
  Router as RouterIcon,
  ScrollText,
  Settings,
  Sun,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { ROLE_LABELS } from '@hotzonex/shared/roles';
import { useAuth } from '@/lib/auth';
import { useConnector } from '@/lib/queries/misc';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { RelativeTime } from './time';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/overlays';

/** Phase 1 navigation — these five and nothing else. */
const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/routers', label: 'Routers', icon: RouterIcon, end: false },
  { to: '/locations', label: 'Locations', icon: MapPin, end: false },
  { to: '/audit', label: 'Audit Logs', icon: ScrollText, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
] as const;

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <img src="/favicon.svg" alt="" className="size-8 rounded-md" />
      <div className="min-w-0 leading-tight">
        <p className="text-sm font-semibold text-white">Hotzonex Cloud</p>
        <p className="truncate text-[11px] text-sidebar-muted">MikroTik Hotspot Management &amp; WiFi Platform</p>
      </div>
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="grid gap-0.5 px-2">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-active',
              isActive && 'bg-sidebar-active font-medium text-white',
            )
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function ConnectorIndicator() {
  const c = useConnector();
  if (c.isPending) return null;
  const v = c.data;
  const online = v?.online ?? false;
  return (
    <div className="mx-3 mb-3 rounded-md bg-sidebar-active/60 px-3 py-2 text-[11px] text-sidebar-foreground">
      <div className="flex items-center gap-1.5 font-medium">
        <span className={cn('size-2 rounded-full', online ? 'bg-status-good' : 'bg-status-critical')} aria-hidden />
        Connector {online ? 'online' : 'offline'}
        {v?.mock ? <span className="ml-auto rounded bg-status-warning px-1 text-[10px] font-bold text-black">MOCK</span> : null}
      </div>
      <div className="mt-0.5 text-sidebar-muted">
        {v?.row ? (
          <>
            last heartbeat <RelativeTime value={v.row.last_heartbeat_at} />
          </>
        ) : (
          'has never reported in'
        )}
      </div>
    </div>
  );
}

const THEMES: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function UserMenu() {
  const { profile, role, tenant, signOut } = useAuth();
  const { preference, setPreference, resolved } = useTheme();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" aria-label="Account menu">
          {resolved === 'dark' ? <Moon aria-hidden /> : <Sun aria-hidden />}
          <UserRound aria-hidden />
          <span className="hidden max-w-40 truncate sm:inline">{profile?.full_name || profile?.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block truncate font-medium text-foreground">{profile?.email}</span>
          {role ? ROLE_LABELS[role] : ''} · {tenant?.name}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setPreference(value)}>
            <Icon aria-hidden /> {label}
            {preference === value ? <span className="ml-auto text-xs text-muted-foreground">✓</span> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings?tab=profile')}>
          <UserRound aria-hidden /> Your profile
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            await signOut();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function Banners() {
  const online = useOnline();
  const c = useConnector();
  const banners: ReactNode[] = [];
  if (!online) {
    banners.push(
      <div key="offline" role="status" className="flex items-center gap-2 bg-status-warning-bg px-4 py-2 text-sm">
        <CloudOff className="size-4 text-status-warning" aria-hidden />
        You are offline. Showing the last data this device saw; actions are disabled until the connection returns.
      </div>,
    );
  }
  if (c.data?.mock) {
    banners.push(
      <div key="mock" className="bg-accent px-4 py-2 text-xs text-accent-foreground">
        <strong>Mock mode:</strong> the connector is simulating routers and WireGuard (MIKROTIK_PROVIDER=mock). Nothing here is talking to real hardware.
      </div>,
    );
  }
  return <>{banners}</>;
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { tenant } = useAuth();
  const location = useLocation();
  // Close the mobile menu whenever the route changes (including back/forward), adjusting state during render.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setMobileOpen(false);
  }

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-sidebar lg:flex">
        <Brand />
        <NavItems />
        <div className="mt-auto">
          <ConnectorIndicator />
        </div>
      </aside>

      <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-black/50 lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar lg:hidden">
            <D.Title className="sr-only">Navigation</D.Title>
            <D.Description className="sr-only">Main navigation</D.Description>
            <div className="flex items-start justify-between">
              <Brand />
              <D.Close asChild>
                <Button variant="ghost" size="icon" className="mr-2 mt-3 text-sidebar-foreground hover:bg-sidebar-active" aria-label="Close menu">
                  <X />
                </Button>
              </D.Close>
            </div>
            <NavItems onNavigate={() => setMobileOpen(false)} />
            <div className="mt-auto">
              <ConnectorIndicator />
            </div>
          </D.Content>
        </D.Portal>
      </D.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-card/95 px-3 backdrop-blur sm:px-4">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          <span className="truncate text-sm font-medium lg:hidden">Hotzonex Cloud</span>
          <span className="hidden truncate text-sm text-muted-foreground lg:inline">{tenant?.name}</span>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
        <Banners />
        <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
