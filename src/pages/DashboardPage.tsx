import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { must, useApp, useLoad } from '../lib/app';
import { supabase, ROUTER_COLS, type Router } from '../lib/supabase';
import { formatMoney, timeAgo, todayJuba } from '../lib/format';
import { Badge, Card, ErrorBox, PageHeader, SitePicker, Stat, routerTone } from '../components/ui';

type DayRow = { day: string; site_id: string; revenue: number; vouchers_sold: number; currency: string };
type StockRow = { site_id: string; plan_id: string; plan_name: string; ready: number; pending_push: number };

export default function DashboardPage() {
  const { tenant, siteId, sites, isAdmin } = useApp();
  const today = todayJuba();
  const weekAgo = todayJuba(-6);

  const { data, error } = useLoad(async () => {
    let qd = supabase.from('v_sales_daily').select('day, site_id, revenue, vouchers_sold, currency').gte('day', weekAgo);
    let qa = supabase.from('active_sessions').select('router_id', { count: 'exact', head: true });
    let qr = supabase.from('routers').select(ROUTER_COLS);
    let qs = supabase.from('v_voucher_stock').select('site_id, plan_id, plan_name, ready, pending_push');
    if (siteId) { qd = qd.eq('site_id', siteId); qa = qa.eq('site_id', siteId); qr = qr.eq('site_id', siteId); qs = qs.eq('site_id', siteId); }
    const [days, active, routers, stock] = await Promise.all([qd, qa, qr, qs]);
    if (active.error) throw new Error(active.error.message);
    return {
      days: must(days) as DayRow[],
      active: active.count ?? 0,
      routers: must(routers) as unknown as Router[],
      stock: must(stock) as StockRow[],
    };
  }, [siteId, tenant?.id], { days: [], active: 0, routers: [], stock: [] });

  const currency = tenant?.currency ?? 'SSP';
  const todayRows = data.days.filter((d) => d.day === today);
  const todayRevenue = todayRows.reduce((a, r) => a + Number(r.revenue), 0);
  const todaySold = todayRows.reduce((a, r) => a + Number(r.vouchers_sold), 0);
  const series = Array.from({ length: 7 }, (_, i) => {
    const day = todayJuba(i - 6);
    return { day, revenue: data.days.filter((d) => d.day === day).reduce((a, r) => a + Number(r.revenue), 0) };
  });
  const max = Math.max(1, ...series.map((s) => s.revenue));
  const weekRevenue = series.reduce((a, s) => a + s.revenue, 0);
  const lowStock = data.stock.filter((s) => s.ready < 20);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? '';
  const online = data.routers.filter((r) => r.status === 'online').length;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Today · ${today}`} actions={<SitePicker />} />
      <ErrorBox>{error}</ErrorBox>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue today" value={formatMoney(todayRevenue, currency)} tone="text-emerald-700" />
        <Stat label="Vouchers sold today" value={todaySold} />
        <Stat label="Online now" value={data.active} sub={<Link to="/active" className="text-sky-700">See who →</Link>} />
        <Stat label="Routers online" value={`${online}/${data.routers.length}`}
          tone={online < data.routers.length ? 'text-amber-600' : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Last 7 days</h2>
            <span className="text-sm text-slate-500">{formatMoney(weekRevenue, currency)}</span>
          </div>
          <div className="mt-4 flex h-44 items-end gap-2">
            {series.map((s) => (
              <div key={s.day} className="flex flex-1 flex-col items-center gap-1">
                <div className="text-[10px] font-semibold tabular-nums text-slate-500">{s.revenue ? Math.round(s.revenue).toLocaleString() : ''}</div>
                <div className={`w-full rounded-t-lg ${s.day === today ? 'bg-sky-500' : 'bg-slate-300'}`}
                  style={{ height: `${Math.max(2, (s.revenue / max) * 130)}px` }} />
                <div className="text-xs text-slate-500">{new Date(s.day + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold">Voucher stock</h2>
          {lowStock.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">All plans have 20 or more ready vouchers.</p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {lowStock.map((s) => (
                <li key={s.plan_id} className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-600" />
                    {s.plan_name}{!siteId && <span className="text-slate-500"> · {siteName(s.site_id)}</span>}</span>
                  <b className="tabular-nums">{s.ready}</b>
                </li>
              ))}
            </ul>
          )}
          {isAdmin && <Link to="/vouchers" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-700">Generate vouchers <ArrowRight className="size-4" /></Link>}
        </Card>
      </div>

      <h2 className="mb-2 mt-6 font-semibold">Routers</h2>
      {data.routers.length === 0 ? (
        <Card><p className="text-sm text-slate-500">No routers connected yet.{isAdmin && <> <Link className="text-sky-700" to="/routers">Add one →</Link></>}</p></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.routers.map((r) => (
            <Card key={r.id}>
              <div className="flex items-center justify-between">
                <div className="font-semibold">{r.name}</div>
                <Badge tone={routerTone[r.status]}>{r.status.replace('_', ' ')}</Badge>
              </div>
              <div className="mt-1 text-sm text-slate-500">{siteName(r.site_id)} · {r.host}</div>
              <div className="mt-1 text-xs text-slate-500">Last seen {timeAgo(r.last_seen_at)}</div>
              {r.last_error && r.status !== 'online' && <div className="mt-2 truncate text-xs text-red-600">{r.last_error}</div>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
