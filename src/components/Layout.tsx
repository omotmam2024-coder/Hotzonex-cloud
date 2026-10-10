import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3, Boxes, CircleDollarSign, Clock4, Gauge, HardDrive, LogOut, Receipt, Router as RouterIcon,
  Settings, Ticket, Wifi,
} from 'lucide-react';
import { useApp } from '../lib/app';
import { cx, Select } from './ui';

type Item = { to: string; label: string; icon: typeof Gauge; admin?: boolean; mobile?: boolean };
const NAV: Item[] = [
  { to: '/', label: 'Dashboard', icon: Gauge, mobile: true },
  { to: '/sell', label: 'Sell', icon: CircleDollarSign, mobile: true },
  { to: '/vouchers', label: 'Vouchers', icon: Ticket, admin: true, mobile: true },
  { to: '/active', label: 'Active users', icon: Wifi, mobile: true },
  { to: '/expired', label: 'Expired', icon: Clock4 },
  { to: '/sales', label: 'Sales', icon: Receipt, mobile: true },
  { to: '/reports', label: 'Reports', icon: BarChart3, admin: true },
  { to: '/routers', label: 'Routers', icon: RouterIcon, admin: true },
  { to: '/devices', label: 'Devices', icon: HardDrive },
  { to: '/settings', label: 'Settings', icon: Settings, admin: true },
];

export default function Layout() {
  const { tenant, role, isAdmin, memberships, setTenantId, signOut, session } = useApp();
  const items = NAV.filter((n) => !n.admin || isAdmin);
  const mobileItems = items.filter((n) => n.mobile).slice(0, 5);

  return (
    <div className="min-h-dvh bg-slate-50 lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-slate-900 p-4 text-slate-300 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/icon.svg" alt="" className="size-9" />
          <div>
            <div className="font-bold text-white">Hotzonex Cloud</div>
            <div className="text-xs text-slate-400 capitalize">{role}</div>
          </div>
        </div>
        {memberships.length > 1 ? (
          <Select value={tenant?.id} onChange={(e) => setTenantId(e.target.value)} className="mb-4 border-slate-700 bg-slate-800 py-2 text-white">
            {memberships.map((m) => <option key={m.tenant_id} value={m.tenant_id}>{m.tenant.name}</option>)}
          </Select>
        ) : (
          <div className="mb-4 rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-white">{tenant?.name}</div>
        )}
        <nav className="grid gap-1">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
                isActive ? 'bg-sky-500/15 text-sky-300' : 'hover:bg-slate-800 hover:text-white')}>
              <n.icon className="size-4" />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-slate-800 pt-3">
          <div className="truncate px-2 text-xs text-slate-500">{session?.user.email}</div>
          <button onClick={signOut} className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-slate-800 hover:text-white">
            <LogOut className="size-4" />Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-slate-900 px-4 py-3 text-white lg:hidden" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="size-7" />
          <span className="font-bold">{tenant?.name ?? 'Hotzonex Cloud'}</span>
        </div>
        <MoreMenu items={items.filter((n) => !mobileItems.includes(n))} onSignOut={signOut} />
      </header>

      <main className="min-w-0 flex-1 p-4 pb-28 lg:p-8 lg:pb-8">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200 bg-white lg:hidden"
        style={{ gridTemplateColumns: `repeat(${mobileItems.length}, 1fr)`, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {mobileItems.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', isActive ? 'text-sky-600' : 'text-slate-500')}>
            <n.icon className="size-5" />{n.label.split(' ')[0]}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function MoreMenu({ items, onSignOut }: { items: Item[]; onSignOut: () => void }) {
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-sm">
        <Boxes className="size-4" />More
      </summary>
      <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-2xl bg-white py-1 text-slate-800 shadow-xl ring-1 ring-slate-200">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} onClick={(e) => (e.currentTarget.closest('details') as HTMLDetailsElement)?.removeAttribute('open')}
            className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
            <n.icon className="size-4 text-slate-500" />{n.label}
          </NavLink>
        ))}
        <button onClick={onSignOut} className="flex w-full items-center gap-2 border-t px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
          <LogOut className="size-4" />Sign out
        </button>
      </div>
    </details>
  );
}
