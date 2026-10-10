import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { must, useApp, useLoad } from '../lib/app';
import { supabase, type Plan } from '../lib/supabase';
import { formatDuration, formatMoney } from '../lib/format';
import { Button, ErrorBox, Spinner } from '../components/ui';

type Data = { vouchers: { id: string; code: string; status: string; pushed_at: string | null }[]; plan: Plan | null; siteName: string };

export default function PrintPage() {
  const { batchId } = useParams();
  const { sites } = useApp();
  const [onlyUnused, setOnlyUnused] = useState(true);
  const [cols, setCols] = useState(4);

  const { data, loading, error } = useLoad<Data>(async () => {
    const batch = must(await supabase.from('voucher_batches').select('plan_id, site_id').eq('id', batchId!).single()) as { plan_id: string; site_id: string };
    const [v, p] = await Promise.all([
      supabase.from('vouchers').select('id, code, status, pushed_at').eq('batch_id', batchId!).order('code'),
      supabase.from('plans').select('*').eq('id', batch.plan_id).single(),
    ]);
    return {
      vouchers: must(v) as Data['vouchers'],
      plan: must(p) as Plan,
      siteName: sites.find((s) => s.id === batch.site_id)?.name ?? '',
    };
  }, [batchId, sites], { vouchers: [], plan: null, siteName: '' });

  if (loading) return <Spinner />;
  if (error || !data.plan) return <div className="p-6"><ErrorBox>{error ?? 'Batch not found'}</ErrorBox></div>;
  const plan = data.plan;
  const rows = onlyUnused ? data.vouchers.filter((v) => v.status === 'unused') : data.vouchers;
  const notPushed = rows.filter((v) => !v.pushed_at).length;

  return (
    <div className="bg-white">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-white p-3">
        <b>{plan.name}</b><span className="text-slate-500">{rows.length} cards · {data.siteName}</span>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={onlyUnused} onChange={(e) => setOnlyUnused(e.target.checked)} />Only unsold</label>
        <label className="flex items-center gap-1 text-sm">Columns
          <select value={cols} onChange={(e) => setCols(Number(e.target.value))} className="rounded border px-1">
            {[3, 4, 5].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        {notPushed > 0 && <span className="text-sm text-amber-700">{notPushed} not on the router yet — wait for sync before handing these out.</span>}
        <Button className="ml-auto" onClick={() => window.print()}><Printer className="size-4" />Print</Button>
      </div>
      <div className="print-sheet" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        <style>{`
          @page { size: A4; margin: 8mm; }
          .print-sheet { display: grid; gap: 3mm; padding: 4mm; }
          .vcard { border: 1px dashed #94a3b8; border-radius: 3mm; overflow: hidden; break-inside: avoid; }
          .vband { height: 5mm; display:flex; align-items:center; justify-content:center; color:#fff; font: 800 8pt system-ui; letter-spacing:.05em; }
          .vcode { font: 900 ${cols >= 5 ? 15 : 18}pt ui-monospace, monospace; letter-spacing: .12em; text-align: center; padding: 2.5mm 0 1.5mm; }
          .vmeta { display: flex; justify-content: space-between; font: 800 ${cols >= 5 ? 8 : 10}pt system-ui; padding: 0 2mm 2mm; }
          @media screen { .print-sheet { max-width: 210mm; margin: auto; } }
          @media print { .print-sheet { padding: 0; } }
        `}</style>
        {rows.map((v) => (
          <div key={v.id} className="vcard">
            <div className="vband" style={{ background: plan.color }}>{data.siteName.toUpperCase()} WIFI</div>
            <div className="vcode">{v.code}</div>
            <div className="vmeta">
              <span>{formatMoney(plan.price, plan.currency)}</span>
              <span>{formatDuration(plan.uptime_seconds)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
