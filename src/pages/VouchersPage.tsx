import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Plus, Printer, Search } from 'lucide-react';
import { must, useApp, useLoad } from '../lib/app';
import { supabase, errText, type Plan, type Voucher, type VoucherStatus } from '../lib/supabase';
import { formatDateTime, formatDuration, formatMoney } from '../lib/format';
import {
  Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, SitePicker, Table, Td, voucherTone,
} from '../components/ui';

type Batch = { id: string; site_id: string; plan_id: string; quantity: number; prefix: string; charset: string; created_at: string; plan: { name: string; color: string } | null };
const STATUSES: (VoucherStatus | '')[] = ['', 'unused', 'sold', 'active', 'expired', 'disabled'];
const PAGE = 100;

export default function VouchersPage() {
  const { siteId, sites, tenant } = useApp();
  const [status, setStatus] = useState<VoucherStatus | ''>('');
  const [q, setQ] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showGen, setShowGen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  const plans = useLoad(async () => {
    let qp = supabase.from('plans').select('*').order('price');
    if (siteId) qp = qp.eq('site_id', siteId);
    return must(await qp) as Plan[];
  }, [siteId, tenant?.id], []);

  const batches = useLoad(async () => {
    let qb = supabase.from('voucher_batches').select('id, site_id, plan_id, quantity, prefix, charset, created_at, plan:plans(name, color)')
      .order('created_at', { ascending: false }).limit(12);
    if (siteId) qb = qb.eq('site_id', siteId);
    return must(await qb) as unknown as Batch[];
  }, [siteId, tenant?.id], []);

  const list = useLoad(async () => {
    let qv = supabase.from('vouchers').select('*', { count: 'exact' })
      .order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (siteId) qv = qv.eq('site_id', siteId);
    if (status) qv = qv.eq('status', status);
    if (batchFilter) qv = qv.eq('batch_id', batchFilter);
    if (q.trim()) qv = qv.ilike('code', `%${q.trim().toUpperCase()}%`);
    const r = await qv;
    if (r.error) throw new Error(r.error.message);
    return { rows: (r.data ?? []) as Voucher[], count: r.count ?? 0 };
  }, [siteId, status, batchFilter, q, page, tenant?.id], { rows: [], count: 0 });

  // Pushed/active state changes arrive from the router API sync.
  useEffect(() => {
    const ch = supabase.channel('vouchers-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vouchers' }, () => list.reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.reload]);

  useEffect(() => { setPage(0); setSelected(new Set()); }, [siteId, status, batchFilter, q]);

  const planById = useMemo(() => Object.fromEntries(plans.data.map((p) => [p.id, p])), [plans.data]);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? '';
  const disableable = list.data.rows.filter((v) => selected.has(v.id) && ['unused', 'sold', 'active'].includes(v.status));

  async function disableSelected() {
    if (!disableable.length) return;
    if (!confirm(`Disable ${disableable.length} voucher(s)? Anyone using them is disconnected on the next sync.`)) return;
    setDisabling(true); setActionError(null);
    const { error } = await supabase.rpc('disable_vouchers', { p_ids: disableable.map((v) => v.id) });
    setDisabling(false);
    if (error) { setActionError(errText(error)); return; }
    setSelected(new Set()); list.reload();
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pages = Math.max(1, Math.ceil(list.data.count / PAGE));

  return (
    <div>
      <PageHeader title="Vouchers" subtitle={`${list.data.count.toLocaleString()} vouchers`}
        actions={<><SitePicker /><Button onClick={() => setShowGen(true)}><Plus className="size-4" />Generate</Button></>} />

      {batches.data.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Recent batches</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {batches.data.map((b) => (
              <Card key={b.id} className="min-w-56 shrink-0 p-3">
                <div className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: b.plan?.color }} />
                  <span className="font-semibold">{b.plan?.name}</span>
                  <span className="ml-auto text-sm tabular-nums text-slate-500">×{b.quantity}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{siteName(b.site_id)} · {formatDateTime(b.created_at)}</div>
                <div className="mt-2 flex gap-2">
                  <Link to={`/print/${b.id}`} target="_blank" className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
                    <Printer className="size-3.5" />Print
                  </Link>
                  <button onClick={() => setBatchFilter(batchFilter === b.id ? '' : b.id)}
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-slate-200">{batchFilter === b.id ? 'Show all' : 'Show'}</button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code" className="w-48 py-2 pl-9" />
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((s) => (
            <button key={s || 'all'} onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold capitalize ${status === s ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-200'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>
        {disableable.length > 0 && (
          <Button variant="danger" size="sm" busy={disabling} onClick={disableSelected} className="ml-auto">
            <Ban className="size-4" />Disable {disableable.length}
          </Button>
        )}
      </div>
      <ErrorBox>{list.error ?? actionError}</ErrorBox>

      <Table empty={!list.loading && list.data.rows.length === 0}
        head={['', 'Code', 'Plan', ...(siteId ? [] : ['Site']), 'Status', 'On router', 'Used', 'Sold', 'Created']}>
        {list.data.rows.map((v) => {
          const p = planById[v.plan_id];
          return (
            <tr key={v.id} className="hover:bg-slate-50">
              <Td><input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} className="size-4" /></Td>
              <Td className="font-mono font-bold tracking-wider">{v.code}</Td>
              <Td><span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: p?.color }} />{p?.name}</span></Td>
              {!siteId && <Td>{siteName(v.site_id)}</Td>}
              <Td><Badge tone={voucherTone[v.status]}>{v.status}</Badge></Td>
              <Td>
                {v.removed_at ? <span className="text-slate-400">removed</span>
                  : v.pushed_at ? <span className="text-emerald-700">yes</span>
                  : v.push_error ? <span className="text-red-600" title={v.push_error}>error</span>
                  : <span className="text-amber-600">pending</span>}
              </Td>
              <Td className="tabular-nums">{v.uptime_used_seconds ? formatDuration(v.uptime_used_seconds) : '—'}</Td>
              <Td>{formatDateTime(v.sold_at)}</Td>
              <Td>{formatDateTime(v.created_at)}</Td>
            </tr>
          );
        })}
      </Table>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page + 1} of {pages}</span>
          <Button variant="secondary" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      <GenerateModal open={showGen} onClose={() => setShowGen(false)} plans={plans.data}
        onDone={() => { setShowGen(false); batches.reload(); list.reload(); }} />
    </div>
  );
}

function GenerateModal({ open, onClose, plans, onDone }: { open: boolean; onClose: () => void; plans: Plan[]; onDone: () => void }) {
  const { sites } = useApp();
  const active = plans.filter((p) => p.active);
  const [planId, setPlanId] = useState('');
  const [qty, setQty] = useState('40');
  const [len, setLen] = useState('8');
  const [charset, setCharset] = useState<'numeric' | 'alnum'>('numeric');
  const [prefix, setPrefix] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);

  useEffect(() => { if (open) { setBatchId(null); setError(null); if (!active.some((p) => p.id === planId)) setPlanId(active[0]?.id ?? ''); } }, [open]); // eslint-disable-line

  const plan = active.find((p) => p.id === planId);

  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const { data, error } = await supabase.rpc('generate_vouchers_checked', {
      p_plan_id: planId, p_quantity: Number(qty), p_prefix: prefix, p_length: Number(len), p_charset: charset,
    });
    setBusy(false);
    if (error) { setError(errText(error)); return; }
    setBatchId(data as string);
  }

  return (
    <Modal open={open} onClose={batchId ? onDone : onClose} title="Generate vouchers">
      {batchId ? (
        <div className="grid gap-4 text-center">
          <p className="text-lg"><b>{qty}</b> vouchers created for <b>{plan?.name}</b>.</p>
          <p className="text-sm text-slate-500">They are pushed to the router on the next sync (about a minute). Sell or print them once they show "On router: yes".</p>
          <div className="flex justify-center gap-2">
            <Link to={`/print/${batchId}`} target="_blank" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white"><Printer className="size-4" />Print cards</Link>
            <Button variant="secondary" onClick={onDone}>Done</Button>
          </div>
        </div>
      ) : active.length === 0 ? (
        <p className="text-slate-600">Add a plan first under <Link to="/settings" className="text-sky-700">Settings → Plans</Link>.</p>
      ) : (
        <form onSubmit={go} className="grid gap-4">
          <Field label="Plan">
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)} required>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatMoney(p.price, p.currency)} · {formatDuration(p.uptime_seconds)} · {sites.find((s) => s.id === p.site_id)?.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="How many"><Input type="number" min={1} max={2000} value={qty} onChange={(e) => setQty(e.target.value)} required /></Field>
            <Field label="Code length"><Input type="number" min={6} max={16} value={len} onChange={(e) => setLen(e.target.value)} required /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Characters" hint="Numbers are easiest on phones">
              <Select value={charset} onChange={(e) => setCharset(e.target.value as 'numeric' | 'alnum')}>
                <option value="numeric">Numbers only</option>
                <option value="alnum">Letters + numbers</option>
              </Select>
            </Field>
            <Field label="Prefix (optional)" hint="Up to 6 letters/digits">
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} maxLength={6} pattern="[A-Za-z0-9]{0,6}" />
            </Field>
          </div>
          {Number(len) < 8 && charset === 'numeric' && (
            <p className="text-xs text-amber-700">Short numeric codes are easy to guess once many are live. 8 digits is safer.</p>
          )}
          <ErrorBox>{error}</ErrorBox>
          <Button busy={busy} size="lg">Generate {qty} vouchers</Button>
        </form>
      )}
    </Modal>
  );
}
