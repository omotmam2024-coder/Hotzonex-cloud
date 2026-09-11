import Link from 'next/link';

const stats = [
  { label: 'Total Routers', value: '12', tone: 'bg-blue-500/10 text-blue-300' },
  { label: 'Online Routers', value: '9', tone: 'bg-emerald-500/10 text-emerald-300' },
  { label: 'Offline Routers', value: '3', tone: 'bg-amber-500/10 text-amber-300' },
  { label: 'Active Users', value: '1,248', tone: 'bg-violet-500/10 text-violet-300' }
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Hotzonex Cloud</p>
            <h1 className="mt-2 text-3xl font-bold">MikroTik Hotspot Management & WiFi Platform</h1>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link href="/login" className="rounded-md bg-blue-600 px-4 py-2 font-medium">Login</Link>
            <Link href="/dashboard" className="rounded-md border border-slate-700 px-4 py-2 font-medium">Dashboard</Link>
          </nav>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="card p-5">
              <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${stat.tone}`}>
                {stat.label}
              </div>
              <div className="mt-4 text-3xl font-bold">{stat.value}</div>
            </div>
          ))}
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="card p-6">
            <h2 className="text-xl font-semibold">Phase 1 MVP</h2>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li>✓ Authentication and RBAC</li>
              <li>✓ Prisma database schema</li>
              <li>✓ Router management API</li>
              <li>✓ Mock MikroTik provider</li>
              <li>✓ Location management UI</li>
            </ul>
          </div>

          <div className="card p-6">
            <h2 className="text-xl font-semibold">Router operations</h2>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li>✓ Test router connectivity</li>
              <li>✓ Recover RouterOS metadata</li>
              <li>✓ Discover hotspot configuration</li>
              <li>✓ View active sessions</li>
            </ul>
          </div>

          <div className="card p-6">
            <h2 className="text-xl font-semibold">Next steps</h2>
            <ul className="mt-4 space-y-2 text-sm text-slate-300">
              <li>🔜 Create real package and voucher flows</li>
              <li>🔜 Add customers and payment abstraction</li>
              <li>🔜 Implement customer portal and reports</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
