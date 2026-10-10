import { useState } from 'react';
import { Banknote, Copy, Printer, UserRound } from 'lucide-react';
import { must, useApp, useLoad } from '../lib/app';
import { supabase, errText, type Plan } from '../lib/supabase';
import { formatDuration, formatMoney } from '../lib/format';
import { Button, Card, Empty, ErrorBox, Input, PageHeader, SitePicker, Spinner, cx } from '../components/ui';

type Sold = { voucher_id: string; code: string; plan: string; amount: number; currency: string; uptime_seconds: number; color?: string };

export default function SellPage() {
  const { siteId, site, tenant } = useApp();
  const [method, setMethod] = useState<'cash' | 'agent_code'>('cash');
  const [agentCode, setAgentCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sold, setSold] = useState<Sold | null>(null);
  const [recent, setRecent] = useState<Sold[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data, loading, reload } = useLoad(async () => {
    if (!siteId) return { plans: [] as Plan[], stock: {} as Record<string, number> };
    const [p, s] = await Promise.all([
      supabase.from('plans').select('*').eq('site_id', siteId).eq('active', true).order('price'),
      supabase.from('v_voucher_stock').select('plan_id, ready').eq('site_id', siteId),
    ]);
    return {
      plans: must(p) as Plan[],
      stock: Object.fromEntries((must(s) as { plan_id: string; ready: number }[]).map((r) => [r.plan_id, Number(r.ready)])),
    };
  }, [siteId, tenant?.id], { plans: [], stock: {} });

  async function sell(plan: Plan) {
    if (method === 'agent_code' && !agentCode.trim()) { setError('Enter the agent code first'); return; }
    setBusy(plan.id); setError(null); setSold(null);
    const { data: res, error } = await supabase.rpc('sell_voucher', {
      p_plan_id: plan.id, p_method: method, p_agent_code: method === 'agent_code' ? agentCode : null,
    });
    setBusy(null);
    if (error) { setError(errText(error)); return; }
    const s = { ...(res as Sold), color: plan.color };
    setSold(s);
    setRecent((r) => [s, ...r].slice(0, 8));
    reload();
  }

  function printTicket(s: Sold) {
    const w = window.open('', '_blank', 'width=380,height=520');
    if (!w) return;
    w.document.write(`<!doctype html><title>Voucher</title><style>
      body{font-family:system-ui;margin:0;padding:12px;text-align:center}
      .band{height:10px;background:${s.color ?? '#0ea5e9'};border-radius:4px}
      .code{font:900 34px ui-monospace,monospace;letter-spacing:.15em;margin:14px 0}
      .row{display:flex;justify-content:space-between;font-weight:700;font-size:18px}
      @page{size:80mm auto;margin:4mm}</style>
      <div class="band"></div><div style="margin-top:8px;font-weight:700">${site?.name ?? ''} WiFi</div>
      <div class="code">${s.code}</div>
      <div class="row"><span>${formatMoney(s.amount, s.currency)}</span><span>${formatDuration(s.uptime_seconds)}</span></div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}<\/script>`);
    w.document.close();
  }

  if (!siteId) {
    return (
      <div>
        <PageHeader title="Sell" actions={<SitePicker allowAll={false} />} />
        <Empty title="Choose a site to sell from">Vouchers only work at the site that sold them.</Empty>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Sell" subtitle={site?.name} actions={<SitePicker allowAll={false} />} />

      <div className="grid grid-cols-2 gap-2">
        {(['cash', 'agent_code'] as const).map((m) => (
          <button key={m} onClick={() => setMethod(m)}
            className={cx('flex items-center justify-center gap-2 rounded-2xl py-3.5 text-lg font-bold transition',
              method === m ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>
            {m === 'cash' ? <Banknote className="size-5" /> : <UserRound className="size-5" />}
            {m === 'cash' ? 'Cash' : 'Agent code'}
          </button>
        ))}
      </div>
      {method === 'agent_code' && (
        <Input value={agentCode} onChange={(e) => setAgentCode(e.target.value.toUpperCase())}
          placeholder="AGENT CODE" className="mt-2 text-center text-xl font-bold tracking-[0.3em]" autoCapitalize="characters" />
      )}

      {loading && data.plans.length === 0 ? <Spinner /> : data.plans.length === 0 ? (
        <div className="mt-4"><Empty title="No plans at this site">An admin can add plans under Settings → Plans.</Empty></div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {data.plans.map((p) => {
            const ready = data.stock[p.id] ?? 0;
            return (
              <button key={p.id} disabled={!!busy || ready === 0} onClick={() => sell(p)}
                style={{ backgroundColor: p.color }}
                className="relative rounded-3xl p-4 text-left text-white shadow-md transition active:scale-[.97] disabled:opacity-40">
                <div className="text-lg font-bold leading-tight drop-shadow-sm">{p.name}</div>
                <div className="mt-1 text-3xl font-black tabular-nums drop-shadow-sm">{Number(p.price).toLocaleString()}</div>
                <div className="text-sm font-semibold opacity-90">{p.currency} · {formatDuration(p.uptime_seconds)}</div>
                <div className="mt-2 inline-block rounded-full bg-black/20 px-2 py-0.5 text-xs font-semibold">
                  {busy === p.id ? 'Selling…' : `${ready} ready`}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>

      {sold && (
        <Card className="mt-4 border-4 text-center" >
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">{sold.plan} · {formatDuration(sold.uptime_seconds)}</div>
          <div className="my-3 select-all font-mono text-5xl font-black tracking-[0.18em] text-slate-900 sm:text-7xl">{sold.code}</div>
          <div className="text-2xl font-bold text-emerald-700">{formatMoney(sold.amount, sold.currency)}</div>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(sold.code)}><Copy className="size-4" />Copy</Button>
            <Button variant="secondary" onClick={() => printTicket(sold)}><Printer className="size-4" />Print ticket</Button>
          </div>
        </Card>
      )}

      {recent.length > 1 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-500">Sold this session</h2>
          <div className="flex flex-wrap gap-2">
            {recent.slice(1).map((r) => (
              <span key={r.voucher_id} className="rounded-xl bg-white px-3 py-1.5 font-mono text-sm font-bold ring-1 ring-slate-200">
                {r.code} <span className="font-sans font-normal text-slate-500">· {r.plan}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
