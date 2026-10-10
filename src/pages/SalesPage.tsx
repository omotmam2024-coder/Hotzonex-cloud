import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { must, useApp, useLoad } from '../lib/app';
import { supabase, type Agent, type Plan } from '../lib/supabase';
import { downloadCsv, formatDateTime, formatMoney, todayJuba } from '../lib/format';
import { Badge, Button, ErrorBox, Field, Input, PageHeader, Select, SitePicker, Stat, Table, Td } from '../components/ui';

type SaleRow = {
  id: string; site_id: string; amount: number; currency: string; method: 'cash' | 'agent_code'; sold_at: string; note: string | null;
  plan: { name: string } | null; agent: { name: string; code: string } | null; voucher: { code: string } | null;
};

/** Juba is UTC+2 all year: convert a local date to the UTC instant at local midnight. */
const jubaStart = (d: string) => new Date(`${d}T00:00:00+02:00`).toISOString();
const jubaEnd = (d: string) => new Date(new Date(`${d}T00:00:00+02:00`).getTime() + 86400000).toISOString();

export default function SalesPage() {
  const { siteId, sites, tenant } = useApp();
  const [from, setFrom] = useState(todayJuba());
  const [to, setTo] = useState(todayJuba());
  const [planId, setPlanId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [method, setMethod] = useState('');

  const lookups = useLoad(async () => {
    let qp = supabase.from('plans').select('id, name, site_id').order('name');
    if (siteId) qp = qp.eq('site_id', siteId);
    const [p, a] = await Promise.all([qp, supabase.from('agents').select('id, name, code').order('name')]);
    return { plans: must(p) as Pick<Plan, 'id' | 'name' | 'site_id'>[], agents: must(a) as Pick<Agent, 'id' | 'name' | 'code'>[] };
  }, [siteId, tenant?.id], { plans: [], agents: [] });

  const { data: rows, loading, error } = useLoad(async () => {
    let q = supabase.from('sales')
      .select('id, site_id, amount, currency, method, sold_at, note, plan:plans(name), agent:agents(name, code), voucher:vouchers(code)')
      .gte('sold_at', jubaStart(from)).lt('sold_at', jubaEnd(to))
      .order('sold_at', { ascending: false }).limit(5000);
    if (siteId) q = q.eq('site_id', siteId);
    if (planId) q = q.eq('plan_id', planId);
    if (agentId) q = q.eq('agent_id', agentId);
    if (method) q = q.eq('method', method);
    return must(await q) as unknown as SaleRow[];
  }, [from, to, siteId, planId, agentId, method, tenant?.id], []);

  const currency = tenant?.currency ?? 'SSP';
  const totals = useMemo(() => {
    const t = { revenue: 0, count: rows.length, cash: 0, agent: 0, auto: 0 };
    for (const r of rows) {
      t.revenue += Number(r.amount);
      if (r.method === 'cash') t.cash += Number(r.amount); else t.agent += Number(r.amount);
      if (r.note?.startsWith('auto:')) t.auto += 1;
    }
    return t;
  }, [rows]);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? '';

  function exportCsv() {
    downloadCsv(`hotzonex-sales-${from}_to_${to}.csv`, [
      ['Sold at (Juba)', 'Site', 'Voucher', 'Plan', 'Method', 'Agent', 'Amount', 'Currency', 'Note'],
      ...rows.map((r) => [
        new Date(r.sold_at).toLocaleString('en-GB', { timeZone: 'Africa/Juba' }), siteName(r.site_id), r.voucher?.code,
        r.plan?.name, r.method === 'cash' ? 'Cash' : 'Agent code', r.agent ? `${r.agent.name} (${r.agent.code})` : '',
        r.amount, r.currency, r.note ?? '',
      ]),
    ]);
  }

  return (
    <div>
      <PageHeader title="Sales" actions={<><SitePicker /><Button variant="secondary" onClick={exportCsv} disabled={!rows.length}><Download className="size-4" />CSV</Button></>} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Plan">
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">All plans</option>
            {lookups.data.plans.map((p) => <option key={p.id} value={p.id}>{p.name}{!siteId ? ` · ${siteName(p.site_id)}` : ''}</option>)}
          </Select>
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">Cash + agent</option><option value="cash">Cash</option><option value="agent_code">Agent code</option>
          </Select>
        </Field>
        <Field label="Agent">
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">All agents</option>
            {lookups.data.agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
          </Select>
        </Field>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={formatMoney(totals.revenue, currency)} tone="text-emerald-700" />
        <Stat label="Vouchers sold" value={totals.count} sub={totals.auto ? `${totals.auto} recorded on first login` : undefined} />
        <Stat label="Cash" value={formatMoney(totals.cash, currency)} />
        <Stat label="Agent codes" value={formatMoney(totals.agent, currency)} />
      </div>

      <ErrorBox>{error}</ErrorBox>
      <Table empty={!loading && rows.length === 0} head={['Time', ...(siteId ? [] : ['Site']), 'Voucher', 'Plan', 'Method', 'Amount']}>
        {rows.slice(0, 500).map((r) => (
          <tr key={r.id}>
            <Td>{formatDateTime(r.sold_at)}</Td>
            {!siteId && <Td>{siteName(r.site_id)}</Td>}
            <Td className="font-mono font-semibold">{r.voucher?.code}</Td>
            <Td>{r.plan?.name}</Td>
            <Td>
              {r.method === 'cash' ? <Badge>Cash</Badge> : <Badge tone="violet">{r.agent?.code ?? 'Agent'}</Badge>}
              {r.note?.startsWith('auto:') && <span className="ml-1"><Badge tone="amber">on login</Badge></span>}
            </Td>
            <Td className="text-right font-semibold tabular-nums">{formatMoney(r.amount, r.currency)}</Td>
          </tr>
        ))}
      </Table>
      {rows.length > 500 && <p className="mt-2 text-sm text-slate-500">Showing 500 of {rows.length}. Totals and CSV include all of them.</p>}
    </div>
  );
}
