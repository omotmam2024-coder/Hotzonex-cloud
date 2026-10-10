import { useMemo, useState } from 'react';
import { Copy, Download, Pencil, Plug, Plus, RefreshCw, Trash2, Zap } from 'lucide-react';
import { must, useApp, useLoad } from '../lib/app';
import { supabase, errText, ROUTER_COLS, type Router } from '../lib/supabase';
import { routerApi, routerApiConfigured, type RouterInput } from '../lib/routerApi';
import { buildOnboardScript, nextTunnelIp } from '../lib/onboard';
import { randomPassword, timeAgo } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorBox, Field, InfoBox, Input, Modal, PageHeader, Select, Textarea, routerTone } from '../components/ui';

const VPS_ENDPOINT = (import.meta.env.VITE_VPS_ENDPOINT as string | undefined) ?? '';
const VPS_PUBKEY = (import.meta.env.VITE_VPS_WG_PUBLIC_KEY as string | undefined) ?? '';

export default function RoutersPage() {
  const { sites, tenant } = useApp();
  const { data: routers, reload, error } = useLoad(async () =>
    must(await supabase.from('routers').select(ROUTER_COLS).order('name')) as unknown as Router[], [tenant?.id], []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Router | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

  const freeSites = sites.filter((s) => !routers.some((r) => r.site_id === s.id));
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? '';

  async function act(r: Router, kind: 'test' | 'sync' | 'delete') {
    if (kind === 'delete' && !confirm(`Remove ${r.name} from Hotzonex Cloud? Vouchers stay on the router; syncing stops.`)) return;
    setBusy(`${r.id}:${kind}`);
    try {
      if (kind === 'test') {
        const t = await routerApi.test(r.id);
        setMsg((m) => ({ ...m, [r.id]: { ok: true, text: `Connected · RouterOS ${t.version} · ${t.board} · up ${t.uptime}` } }));
      } else if (kind === 'sync') {
        const s = await routerApi.sync(r.id);
        setMsg((m) => ({ ...m, [r.id]: s.ok
          ? { ok: true, text: `Synced · ${s.pushed} pushed · ${s.active} online · ${s.expired} expired · ${s.removed} removed` }
          : { ok: false, text: s.error ?? 'Sync failed' } }));
      } else {
        await routerApi.remove(r.id);
      }
    } catch (e) {
      setMsg((m) => ({ ...m, [r.id]: { ok: false, text: errText(e) } }));
    } finally { setBusy(null); reload(); }
  }

  return (
    <div>
      <PageHeader title="Routers" subtitle="One MikroTik hotspot router per site, reached over WireGuard"
        actions={<Button onClick={() => setAdding(true)} disabled={!freeSites.length}><Plus className="size-4" />Add router</Button>} />
      {!routerApiConfigured && <div className="mb-4"><InfoBox>The router API address isn't set. Add <code>VITE_ROUTER_API_URL</code> in Vercel and redeploy to add and sync routers.</InfoBox></div>}
      <ErrorBox>{error}</ErrorBox>

      {routers.length === 0 ? (
        <Empty title="No routers yet">Add your first MikroTik. The wizard gives you the script to paste into Winbox.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {routers.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-bold">{r.name}</div>
                  <div className="text-sm text-slate-500">{siteName(r.site_id)}</div>
                </div>
                <Badge tone={routerTone[r.status]}>{r.status.replace('_', ' ')}</Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-slate-500">Address</dt><dd className="font-mono">{r.host}:{r.port}</dd>
                <dt className="text-slate-500">Connection</dt><dd>{r.conn === 'rest' ? 'REST' : 'API'}{r.tls ? ' + TLS' : ''} · {r.username}</dd>
                <dt className="text-slate-500">RouterOS</dt><dd>{r.routeros_version ?? '—'}</dd>
                <dt className="text-slate-500">Board</dt><dd>{r.board_name ?? '—'}</dd>
                <dt className="text-slate-500">Last seen</dt><dd>{timeAgo(r.last_seen_at)}</dd>
              </dl>
              {r.last_error && r.status !== 'online' && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{r.last_error}</p>}
              {msg[r.id] && <p className={`mt-2 rounded-lg p-2 text-xs ${msg[r.id].ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg[r.id].text}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" busy={busy === `${r.id}:test`} onClick={() => act(r, 'test')}><Plug className="size-4" />Test</Button>
                <Button size="sm" variant="secondary" busy={busy === `${r.id}:sync`} onClick={() => act(r, 'sync')}><RefreshCw className="size-4" />Sync now</Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(r)}><Pencil className="size-4" />Edit</Button>
                <Button size="sm" variant="ghost" busy={busy === `${r.id}:delete`} onClick={() => act(r, 'delete')}><Trash2 className="size-4 text-red-600" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AddRouterWizard open={adding} onClose={() => setAdding(false)} tenantId={tenant!.id} sites={freeSites}
        usedHosts={routers.map((r) => r.host)} onAdded={() => { setAdding(false); reload(); }} />
      {editing && <EditConnection router={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function AddRouterWizard({ open, onClose, tenantId, sites, usedHosts, onAdded }: {
  open: boolean; onClose: () => void; tenantId: string; sites: { id: string; name: string }[]; usedHosts: string[]; onAdded: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const tunnel = useMemo(() => nextTunnelIp(usedHosts), [usedHosts]);
  const [cfg, setCfg] = useState({ vpsEndpoint: VPS_ENDPOINT, vpsPublicKey: VPS_PUBKEY, tunnelIp: tunnel, apiUser: 'hzcloud', apiPass: randomPassword() });
  const [routerKey, setRouterKey] = useState('');
  const [mode, setMode] = useState<'tunnel' | 'public'>('tunnel');
  const script = buildOnboardScript(cfg);

  const reset = () => { setStep(1); setRouterKey(''); setCfg({ ...cfg, tunnelIp: tunnel, apiPass: randomPassword() }); };
  const close = () => { reset(); onClose(); };

  return (
    <Modal open={open} onClose={close} title={`Add router · step ${step} of 3`} wide>
      {step === 1 && (
        <div className="grid gap-4">
          <div className="flex gap-2">
            {(['tunnel', 'public'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${mode === m ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>
                {m === 'tunnel' ? 'Starlink / CGNAT (WireGuard)' : 'Router has a public IP'}
              </button>
            ))}
          </div>
          {mode === 'public' ? (
            <>
              <InfoBox>Enable <b>www-ssl</b> (or <b>api-ssl</b>) on the router with a certificate, limit that service's address to your VPS IP, then add it directly by its public IP with TLS on.</InfoBox>
              <Button onClick={() => setStep(3)}>Continue</Button>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="VPS public IP"><Input value={cfg.vpsEndpoint} onChange={(e) => setCfg({ ...cfg, vpsEndpoint: e.target.value.trim() })} placeholder="203.0.113.10" /></Field>
                <Field label="Tunnel IP for this router"><Input value={cfg.tunnelIp} onChange={(e) => setCfg({ ...cfg, tunnelIp: e.target.value.trim() })} className="font-mono" /></Field>
                <Field label="VPS WireGuard public key" className="sm:col-span-2" hint="On the VPS: sudo wg show wg0 public-key">
                  <Input value={cfg.vpsPublicKey} onChange={(e) => setCfg({ ...cfg, vpsPublicKey: e.target.value.trim() })} className="font-mono text-sm" />
                </Field>
                <Field label="Router login for Hotzonex Cloud"><Input value={cfg.apiUser} onChange={(e) => setCfg({ ...cfg, apiUser: e.target.value.trim() })} /></Field>
                <Field label="Password (generated)"><Input value={cfg.apiPass} onChange={(e) => setCfg({ ...cfg, apiPass: e.target.value })} className="font-mono text-sm" /></Field>
              </div>
              <Field label="1 · Paste this into the router (Winbox → New Terminal)">
                <Textarea readOnly value={script} rows={8} className="font-mono text-xs" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(script)}><Copy className="size-4" />Copy script</Button>
                <Button variant="secondary" onClick={() => {
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(new Blob([script], { type: 'text/plain' }));
                  a.download = `hotzonex-onboard-${cfg.tunnelIp}.rsc`; a.click();
                }}><Download className="size-4" />Download .rsc</Button>
                <Button className="ml-auto" disabled={!cfg.vpsEndpoint || !cfg.vpsPublicKey} onClick={() => setStep(2)}>I ran it</Button>
              </div>
            </>
          )}
        </div>
      )}
      {step === 2 && (
        <div className="grid gap-4">
          <Field label="2 · Router WireGuard public key" hint="The script printed it on the last line.">
            <Input value={routerKey} onChange={(e) => setRouterKey(e.target.value.trim())} className="font-mono text-sm" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=" />
          </Field>
          <Field label="Run this on the VPS">
            <div className="flex gap-2">
              <Input readOnly value={`sudo /opt/hotzonex/wg-add-peer.sh ${routerKey || '<router-key>'} ${cfg.tunnelIp}`} className="font-mono text-xs" />
              <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(`sudo /opt/hotzonex/wg-add-peer.sh ${routerKey} ${cfg.tunnelIp}`)}><Copy className="size-4" /></Button>
            </div>
          </Field>
          <p className="text-sm text-slate-500">It waits for the handshake and prints "OK" once the router is connected.</p>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
            <Button disabled={routerKey.length < 40} onClick={() => setStep(3)}>Handshake OK</Button>
          </div>
        </div>
      )}
      {step === 3 && (
        <RouterForm sites={sites} submitLabel="Test & add router"
          initial={mode === 'tunnel'
            ? { host: cfg.tunnelIp, conn: 'rest', tls: false, username: cfg.apiUser, password: cfg.apiPass }
            : { host: '', conn: 'rest', tls: true, username: '', password: '' }}
          onSubmit={async (b, extra) => { await routerApi.add({ ...b, ...extra!, tenant_id: tenantId }); reset(); onAdded(); }} />
      )}
    </Modal>
  );
}

function RouterForm({ sites, initial, onSubmit, submitLabel }: {
  sites?: { id: string; name: string }[];
  initial: RouterInput & { port?: number };
  submitLabel: string;
  onSubmit: (b: RouterInput, extra?: { site_id: string; name: string }) => Promise<void>;
}) {
  const [f, setF] = useState({ ...initial, port: initial.port ? String(initial.port) : '', site_id: sites?.[0]?.id ?? '', name: sites?.[0]?.name ? `${sites[0].name} router` : '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultPort = f.conn === 'api' ? (f.tls ? 8729 : 8728) : (f.tls ? 443 : 80);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await onSubmit(
        { host: f.host.trim(), port: f.port ? Number(f.port) : undefined, conn: f.conn, tls: f.tls, username: f.username.trim(), password: f.password },
        sites ? { site_id: f.site_id, name: f.name.trim() } : undefined,
      );
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      {sites && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Site">
            <Select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })} required>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Router name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Address" className="sm:col-span-2" hint="Tunnel IP 10.99.0.x, or public IP/DNS">
          <Input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} className="font-mono" required />
        </Field>
        <Field label="Port"><Input value={f.port} onChange={(e) => setF({ ...f, port: e.target.value.replace(/\D/g, '') })} placeholder={String(defaultPort)} inputMode="numeric" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Connection">
          <Select value={f.conn} onChange={(e) => setF({ ...f, conn: e.target.value as 'rest' | 'api' })}>
            <option value="rest">REST API (RouterOS 7.1+)</option>
            <option value="api">RouterOS API (8728)</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-3 text-sm">
          <input type="checkbox" checked={f.tls} onChange={(e) => setF({ ...f, tls: e.target.checked })} className="size-4" />
          Use TLS (public IP only)
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Username"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" required /></Field>
        <Field label="Password"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" required /></Field>
      </div>
      <ErrorBox>{error}</ErrorBox>
      <Button busy={busy} size="lg"><Zap className="size-4" />{busy ? 'Connecting to router…' : submitLabel}</Button>
    </form>
  );
}

function EditConnection({ router, onClose, onSaved }: { router: Router; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Edit connection · ${router.name}`}>
      <p className="mb-3 text-sm text-slate-500">The router is tested with the new settings before anything is saved. Enter the password again.</p>
      <RouterForm submitLabel="Test & save"
        initial={{ host: router.host, port: router.port, conn: router.conn, tls: router.tls, username: router.username, password: '' }}
        onSubmit={async (b) => { await routerApi.updateConnection(router.id, b); onSaved(); }} />
    </Modal>
  );
}
