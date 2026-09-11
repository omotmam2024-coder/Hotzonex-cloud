import { getRouterSummary } from '@/lib/services/router.service';

export default async function DashboardPage() {
  const summary = await getRouterSummary();

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-blue-300">Dashboard</p>
          <h1 className="mt-2 text-3xl font-bold">Hotzonex Cloud</h1>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="card p-5">
            <div className="text-sm text-slate-400">Total Routers</div>
            <div className="mt-4 text-3xl font-bold">{summary.totalRouters}</div>
          </div>
          <div className="card p-5">
            <div className="text-sm text-slate-400">Online Routers</div>
            <div className="mt-4 text-3xl font-bold text-emerald-400">{summary.onlineRouters}</div>
          </div>
          <div className="card p-5">
            <div className="text-sm text-slate-400">Offline Routers</div>
            <div className="mt-4 text-3xl font-bold text-amber-400">{summary.offlineRouters}</div>
          </div>
          <div className="card p-5">
            <div className="text-sm text-slate-400">Active Users</div>
            <div className="mt-4 text-3xl font-bold text-violet-400">{summary.activeUsers}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
