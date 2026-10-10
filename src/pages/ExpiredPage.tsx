import { useState } from 'react';
import { Download } from 'lucide-react';
import { must, useApp, useLoad } from '../lib/app';
import { supabase } from '../lib/supabase';
import { downloadCsv, formatBytes, formatDateTime, formatDuration } from '../lib/format';
import { Badge, Button, ErrorBox, PageHeader, SitePicker, Table, Td } from '../components/ui';

type Row = {
  id: string; site_id: string; code: string; status: 'expired' | 'disabled'; first_login_at: string | null; expired_at: string | null;
  uptime_used_seconds: number; bytes_used: number; removed_at: string | null; plan: { name: string; color: string } | null;
};

export default function ExpiredPage() {
  const { siteId, sites, tenant } = useApp();
  const [which, setWhich] = useState<'expired' | 'disabled'>('expired');

  const { data: rows, loading, error } = useLoad(async () => {
    let q = supabase.from('vouchers')
      .select('id, site_id, code, status, first_login_at, expired_at, uptime_used_seconds, bytes_used, removed_at, plan:plans(name, color)')
      .eq('status', which)
      .order(which === 'expired' ? 'expired_at' : 'created_at', { ascending: false, nullsFirst: false })
      .limit(500);
    if (siteId) q = q.eq('site_id', siteId);
    return must(await q) as unknown as Row[];
  }, [siteId, which, tenant?.id], []);

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? '';
  const stillOnRouter = rows.filter((r) => !r.removed_at).length;

  return (
    <div>
      <PageHeader title="Expired users" subtitle={stillOnRouter ? `${stillOnRouter} still on the router (removed after the customer logs out)` : 'All removed from routers'}
        actions={<>
          <SitePicker />
          <Button variant="secondary" disabled={!rows.length} onClick={() => downloadCsv(`${which}-vouchers.csv`, [
            ['Code', 'Plan', 'Site', 'First login', 'Ended', 'Time used', 'Data used', 'Removed from router'],
            ...rows.map((r) => [r.code, r.plan?.name, siteName(r.site_id), r.first_login_at, r.expired_at, formatDuration(r.uptime_used_seconds), formatBytes(r.bytes_used), r.removed_at ?? 'no']),
          ])}><Download className="size-4" />CSV</Button>
        </>} />
      <div className="mb-3 flex gap-1">
        {(['expired', 'disabled'] as const).map((w) => (
          <button key={w} onClick={() => setWhich(w)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold capitalize ${which === w ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-200'}`}>{w}</button>
        ))}
      </div>
      <ErrorBox>{error}</ErrorBox>
      <Table empty={!loading && rows.length === 0} head={['Code', 'Plan', ...(siteId ? [] : ['Site']), 'First login', which === 'expired' ? 'Expired' : 'Status', 'Time used', 'Data used', 'Router']}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="font-mono font-bold">{r.code}</Td>
            <Td><span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: r.plan?.color }} />{r.plan?.name}</span></Td>
            {!siteId && <Td>{siteName(r.site_id)}</Td>}
            <Td>{formatDateTime(r.first_login_at)}</Td>
            <Td>{which === 'expired' ? formatDateTime(r.expired_at) : <Badge tone="red">disabled</Badge>}</Td>
            <Td className="tabular-nums">{formatDuration(r.uptime_used_seconds)}</Td>
            <Td className="tabular-nums">{formatBytes(r.bytes_used)}</Td>
            <Td>{r.removed_at ? <Badge>removed</Badge> : <Badge tone="amber">on router</Badge>}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
