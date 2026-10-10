import { useEffect, useState } from 'react';
import { Ban, RefreshCw } from 'lucide-react';
import { must, useApp, useLoad } from '../lib/app';
import { supabase, errText } from '../lib/supabase';
import { routerApi, routerApiConfigured } from '../lib/routerApi';
import { formatBytes, formatDuration, timeAgo } from '../lib/format';
import { Badge, Button, ErrorBox, PageHeader, SitePicker, Stat, Table, Td } from '../components/ui';

type Row = {
  router_id: string; site_id: string; username: string; mac: string; address: string | null;
  uptime_seconds: number; bytes_in: number; bytes_out: number; seen_at: string;
  voucher: { id: string; status: string; plan: { name: string; color: string; uptime_seconds: number } | null; uptime_used_seconds: number } | null;
};

export default function ActivePage() {
  const { siteId, sites, isAdmin, tenant } = useApp();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: rows, error, reload, loading } = useLoad(async () => {
    let q = supabase.from('active_sessions')
      .select('router_id, site_id, username, mac, address, uptime_seconds, bytes_in, bytes_out, seen_at, voucher:vouchers(id, status, uptime_used_seconds, plan:plans(name, color, uptime_seconds))')
      .order('uptime_seconds', { ascending: false });
    if (siteId) q = q.eq('site_id', siteId);
    return must(await q) as unknown as Row[];
  }, [siteId, tenant?.id], []);

  // Each router sync replaces the whole set, so refetch rather than patch rows.
  useEffect(() => {
    const ch = supabase.channel('active-sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'active_sessions' }, () => reload())
      .subscribe();
    const t = setInterval(reload, 60000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [reload]);

  async function disconnect(r: Row) {
    if (!r.voucher) return;
    if (!confirm(`Disable voucher ${r.username} and disconnect this customer now? This cannot be undone.`)) return;
    setBusy(r.username); setActionError(null);
    try {
      const { error } = await supabase.rpc('disable_vouchers', { p_ids: [r.voucher.id] });
      if (error) throw error;
      if (routerApiConfigured) await routerApi.sync(r.router_id);
      reload();
    } catch (e) { setActionError(errText(e)); } finally { setBusy(null); }
  }

  const totalBytes = rows.reduce((a, r) => a + Number(r.bytes_in) + Number(r.bytes_out), 0);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? '';
  const lastSeen = rows.reduce<string | null>((a, r) => (!a || r.seen_at > a ? r.seen_at : a), null);

  return (
    <div>
      <PageHeader title="Active users" subtitle={`Updated ${timeAgo(lastSeen)} · live`}
        actions={<><SitePicker /><Button variant="secondary" onClick={reload} busy={loading}><RefreshCw className="size-4" />Refresh</Button></>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Online now" value={rows.length} tone="text-emerald-700" />
        <Stat label="Data this session" value={formatBytes(totalBytes)} />
      </div>
      <ErrorBox>{error ?? actionError}</ErrorBox>
      <Table empty={!loading && rows.length === 0}
        head={['Code', 'Plan', ...(siteId ? [] : ['Site']), 'Device', 'Session', 'Time left', 'Data', ...(isAdmin ? [''] : [])]}>
        {rows.map((r) => {
          const plan = r.voucher?.plan;
          const left = plan ? Math.max(0, plan.uptime_seconds - Math.max(r.voucher!.uptime_used_seconds, r.uptime_seconds)) : null;
          return (
            <tr key={`${r.router_id}-${r.username}-${r.mac}`}>
              <Td className="font-mono font-bold">{r.username}</Td>
              <Td>{plan ? <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: plan.color }} />{plan.name}</span> : <Badge>not from Hotzonex Cloud</Badge>}</Td>
              {!siteId && <Td>{siteName(r.site_id)}</Td>}
              <Td><div className="font-mono text-xs">{r.mac}</div><div className="text-xs text-slate-500">{r.address}</div></Td>
              <Td className="tabular-nums">{formatDuration(r.uptime_seconds)}</Td>
              <Td className="tabular-nums">{left === null ? '—' : <span className={left < 600 ? 'font-semibold text-amber-600' : ''}>{formatDuration(left)}</span>}</Td>
              <Td className="tabular-nums">{formatBytes(Number(r.bytes_in) + Number(r.bytes_out))}</Td>
              {isAdmin && (
                <Td>{r.voucher && (
                  <Button variant="ghost" size="sm" busy={busy === r.username} onClick={() => disconnect(r)} title="Disable voucher and disconnect">
                    <Ban className="size-4 text-red-600" />
                  </Button>
                )}</Td>
              )}
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
