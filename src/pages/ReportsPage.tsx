import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { must, useApp, useLoad } from '../lib/app';
import { supabase } from '../lib/supabase';
import { downloadCsv, formatMoney, todayJuba } from '../lib/format';
import { Button, Card, ErrorBox, Field, Input, PageHeader, SitePicker, Table, Td } from '../components/ui';

type Daily = { day: string; site_id: string; site_name: string; plan_id: string; plan_name: string; method: string; vouchers_sold: number; revenue: number; currency: string };
type Commission = { agent_id: string; agent_name: string; code: string; day: string; vouchers_sold: number; revenue: number; commission: number; currency: string };
type Stock = { site_id: string; plan_id: string; plan_name: string; ready: number; pending_push: number; sold_not_used: number; active: number; expired: number; disabled: number };

export default function ReportsPage() {
  const { siteId, sites, tenant } = useApp();
  const [from, setFrom] = useState(todayJuba(-29));
  const [to, setTo] = useState(todayJuba());
  const currency = tenant?.currency ?? 'SSP';

  const { data, error } = useLoad(async () => {
    let qd = supabase.from('v_sales_daily').select('*').gte('day', from).lte('day', to);
    let qc = supabase.from('v_agent_commission').select('*').gte('day', from).lte('day', to);
    let qs = supabase.from('v_voucher_stock').select('*');
    if (siteId) { qd = qd.eq('site_id', siteId); qc = qc.eq('site_id', siteId); qs = qs.eq('site_id', siteId); }
    const [d, c, s] = await Promise.all([qd, qc, qs]);
    return { daily: must(d) as Daily[], commission: must(c) as Commission[], stock: must(s) as Stock[] };
  }, [from, to, siteId, tenant?.id], { daily: [], commission: [], stock: [] });

  const byDay = useMemo(() => {
    const m = new Map<string, { day: string; perSite: Record<string, number>; total: number; count: number }>();
    for (const r of data.daily) {
      const e = m.get(r.day) ?? { day: r.day, perSite: {}, total: 0, count: 0 };
      e.perSite[r.site_id] = (e.perSite[r.site_id] ?? 0) + Number(r.revenue);
      e.total += Number(r.revenue); e.count += Number(r.vouchers_sold);
      m.set(r.day, e);
    }
    return [...m.values()].sort((a, b) => b.day.localeCompare(a.day));
  }, [data.daily]);

  const planMix = useMemo(() => {
    const m = new Map<string, { name: string; site: string; count: number; revenue: number }>();
    for (const r of data.daily) {
      const e = m.get(r.plan_id) ?? { name: r.plan_name, site: r.site_name, count: 0, revenue: 0 };
      e.count += Number(r.vouchers_sold); e.revenue += Number(r.revenue);
      m.set(r.plan_id, e);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [data.daily]);

  const agents = useMemo(() => {
    const m = new Map<string, { name: string; code: string; count: number; revenue: number; commission: number }>();
    for (const r of data.commission) {
      const e = m.get(r.agent_id) ?? { name: r.agent_name, code: r.code, count: 0, revenue: 0, commission: 0 };
      e.count += Number(r.vouchers_sold); e.revenue += Number(r.revenue); e.commission += Number(r.commission);
      m.set(r.agent_id, e);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [data.commission]);

  const shownSites = siteId ? sites.filter((s) => s.id === siteId) : sites;
  const total = byDay.reduce((a, d) => a + d.total, 0);
  const totalMix = Math.max(1, planMix.reduce((a, p) => a + p.revenue, 0));
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? '';

  return (
    <div>
      <PageHeader title="Reports" subtitle={`${formatMoney(total, currency)} from ${from} to ${to}`} actions={<SitePicker />} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="flex gap-1">
          {[['Today', 0], ['7 days', -6], ['30 days', -29]].map(([l, n]) => (
            <Button key={l} variant="secondary" size="sm" onClick={() => { setFrom(todayJuba(n as number)); setTo(todayJuba()); }}>{l}</Button>
          ))}
        </div>
      </div>
      <ErrorBox>{error}</ErrorBox>

      <div className="grid gap-6">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Daily revenue by site</h2>
            <Button variant="ghost" size="sm" onClick={() => downloadCsv(`daily-${from}_${to}.csv`, [
              ['Day', ...shownSites.map((s) => s.name), 'Total', 'Vouchers'],
              ...byDay.map((d) => [d.day, ...shownSites.map((s) => d.perSite[s.id] ?? 0), d.total, d.count]),
            ])}><Download className="size-4" />CSV</Button>
          </div>
          <Table empty={byDay.length === 0} head={['Day', ...shownSites.map((s) => s.name), 'Total', 'Vouchers']}>
            {byDay.map((d) => (
              <tr key={d.day}>
                <Td>{d.day}</Td>
                {shownSites.map((s) => <Td key={s.id} className="tabular-nums">{d.perSite[s.id] ? formatMoney(d.perSite[s.id], currency) : '—'}</Td>)}
                <Td className="font-bold tabular-nums">{formatMoney(d.total, currency)}</Td>
                <Td className="tabular-nums">{d.count}</Td>
              </tr>
            ))}
          </Table>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 font-semibold">Plan mix</h2>
            {planMix.length === 0 ? <p className="text-sm text-slate-500">No sales in this period.</p> : (
              <ul className="grid gap-3">
                {planMix.map((p) => (
                  <li key={p.name + p.site}>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{p.name}{!siteId && <span className="text-slate-500"> · {p.site}</span>}</span>
                      <span className="tabular-nums">{p.count} · {formatMoney(p.revenue, currency)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-sky-500" style={{ width: `${(p.revenue / totalMix) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Agent commission</h2>
            {agents.length === 0 ? <p className="text-sm text-slate-500">No agent-code sales in this period.</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Agent</th><th>Sold</th><th>Revenue</th><th>Commission</th></tr></thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.code} className="border-t border-slate-100">
                      <td className="py-2">{a.name} <span className="font-mono text-xs text-slate-500">{a.code}</span></td>
                      <td className="tabular-nums">{a.count}</td>
                      <td className="tabular-nums">{formatMoney(a.revenue, currency)}</td>
                      <td className="font-bold tabular-nums text-violet-700">{formatMoney(a.commission, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <section>
          <h2 className="mb-2 font-semibold">Voucher stock (all time)</h2>
          <Table empty={data.stock.length === 0} head={['Plan', ...(siteId ? [] : ['Site']), 'Ready', 'Pending push', 'Sold, not used', 'Active', 'Expired', 'Disabled']}>
            {data.stock.map((s) => (
              <tr key={s.plan_id}>
                <Td className="font-medium">{s.plan_name}</Td>
                {!siteId && <Td>{siteName(s.site_id)}</Td>}
                <Td className={`font-bold tabular-nums ${s.ready < 20 ? 'text-amber-600' : ''}`}>{s.ready}</Td>
                <Td className="tabular-nums">{s.pending_push}</Td>
                <Td className="tabular-nums">{s.sold_not_used}</Td>
                <Td className="tabular-nums">{s.active}</Td>
                <Td className="tabular-nums">{s.expired}</Td>
                <Td className="tabular-nums">{s.disabled}</Td>
              </tr>
            ))}
          </Table>
        </section>
      </div>
    </div>
  );
}
