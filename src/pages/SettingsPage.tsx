import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { must, useApp, useLoad } from '../lib/app';
import { supabase, errText, ROUTER_COLS, type Agent, type Plan, type Role, type Router, type Site } from '../lib/supabase';
import { routerApi, routerApiConfigured } from '../lib/routerApi';
import { formatBytes, formatDuration, formatMoney, parseDurationInput, toDurationInput } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Field, InfoBox, Input, Modal, PageHeader, Select, Table, Td, cx } from '../components/ui';

const TABS = ['Plans', 'Sites', 'Agents', 'Staff', 'Business'] as const;
type Tab = (typeof TABS)[number];
const COLORS = ['#16a34a', '#0ea5e9', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#0d9488', '#334155'];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Plans');
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cx('rounded-full px-4 py-2 text-sm font-semibold', tab === t ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-200')}>{t}</button>
        ))}
      </div>
      {tab === 'Plans' && <PlansTab />}
      {tab === 'Sites' && <SitesTab />}
      {tab === 'Agents' && <AgentsTab />}
      {tab === 'Staff' && <StaffTab />}
      {tab === 'Business' && <BusinessTab />}
    </div>
  );
}

/* ---------------- Plans ---------------- */
function PlansTab() {
  const { sites, tenant } = useApp();
  const { data: plans, reload, error } = useLoad(async () => must(await supabase.from('plans').select('*').order('price')) as Plan[], [tenant?.id], []);
  const [edit, setEdit] = useState<Partial<Plan> | null>(null);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Each site sets its own plans and prices. Speed and shared-users live in the router's hotspot profile.</p>
        <Button disabled={!sites.length} onClick={() => setEdit({ site_id: sites[0]?.id, currency: tenant?.currency ?? 'SSP', hotspot_profile: 'default', color: COLORS[0], active: true })}>
          <Plus className="size-4" />Add plan</Button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      {sites.map((s) => {
        const sp = plans.filter((p) => p.site_id === s.id);
        return (
          <div key={s.id} className="mb-5">
            <h3 className="mb-2 font-semibold">{s.name}</h3>
            {sp.length === 0 ? <p className="text-sm text-slate-500">No plans yet.</p> : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {sp.map((p) => (
                  <button key={p.id} onClick={() => setEdit(p)} className={cx('flex items-stretch overflow-hidden rounded-2xl bg-white text-left shadow-sm ring-1 ring-slate-200 hover:ring-slate-400', !p.active && 'opacity-50')}>
                    <span className="w-2" style={{ background: p.color }} />
                    <span className="flex-1 p-3">
                      <span className="flex justify-between"><b>{p.name}</b><span className="font-bold tabular-nums">{formatMoney(p.price, p.currency)}</span></span>
                      <span className="mt-0.5 block text-sm text-slate-500">
                        {formatDuration(p.uptime_seconds)} online
                        {p.validity_seconds ? ` · within ${formatDuration(p.validity_seconds)}` : ''}
                        {p.bytes_limit ? ` · ${formatBytes(p.bytes_limit)}` : ''} · profile {p.hotspot_profile}
                        {!p.active && ' · hidden'}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {edit && <PlanModal plan={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function PlanModal({ plan, onClose, onSaved }: { plan: Partial<Plan>; onClose: () => void; onSaved: () => void }) {
  const { sites, tenant } = useApp();
  const [f, setF] = useState({
    site_id: plan.site_id ?? '', name: plan.name ?? '', price: plan.price?.toString() ?? '', currency: plan.currency ?? 'SSP',
    uptime: toDurationInput(plan.uptime_seconds), validity: toDurationInput(plan.validity_seconds),
    gb: plan.bytes_limit ? String(+(plan.bytes_limit / 1024 ** 3).toFixed(2)) : '', profile: plan.hotspot_profile ?? 'default',
    color: plan.color ?? COLORS[0], active: plan.active ?? true,
  });
  const [profiles, setProfiles] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uptime = parseDurationInput(f.uptime);
  const validity = f.validity ? parseDurationInput(f.validity) : null;

  async function loadProfiles() {
    setError(null);
    try {
      const r = must(await supabase.from('routers').select(ROUTER_COLS).eq('site_id', f.site_id)) as unknown as Router[];
      if (!r[0]) throw new Error('No router at this site yet');
      setProfiles((await routerApi.profiles(r[0].id)).map((p) => p.name));
    } catch (e) { setError(errText(e)); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!uptime) { setError('Online time: use a value like 1h, 30m, 1d or 1d12h'); return; }
    if (f.validity && !validity) { setError('Valid-within: use a value like 1d or 7d, or leave it empty'); return; }
    setBusy(true); setError(null);
    const row = {
      tenant_id: tenant!.id, site_id: f.site_id, name: f.name.trim(), price: Number(f.price), currency: f.currency,
      uptime_seconds: uptime, validity_seconds: validity, bytes_limit: f.gb ? Math.round(Number(f.gb) * 1024 ** 3) : null,
      hotspot_profile: f.profile.trim() || 'default', color: f.color, active: f.active,
    };
    const r = plan.id ? await supabase.from('plans').update(row).eq('id', plan.id) : await supabase.from('plans').insert(row);
    setBusy(false);
    if (r.error) { setError(r.error.code === '23505' ? 'This site already has a plan with that name' : errText(r.error)); return; }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={plan.id ? 'Edit plan' : 'New plan'}>
      <form onSubmit={save} className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Site">
            <Select value={f.site_id} onChange={(e) => { setF({ ...f, site_id: e.target.value }); setProfiles(null); }} disabled={!!plan.id}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="1 Hour, LITE, Power…" required /></Field>
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Field label="Price"><Input type="number" min={0} step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required /></Field>
          <Field label="Currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option>SSP</option><option>USD</option></Select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Online time" hint={uptime ? formatDuration(uptime) : 'e.g. 1h, 30m, 1d'}>
            <Input value={f.uptime} onChange={(e) => setF({ ...f, uptime: e.target.value })} placeholder="1h" required />
          </Field>
          <Field label="Valid within (optional)" hint={validity ? `Expires ${formatDuration(validity)} after first login` : 'Calendar limit after first login'}>
            <Input value={f.validity} onChange={(e) => setF({ ...f, validity: e.target.value })} placeholder="1d" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data cap in GB (optional)"><Input type="number" min={0} step="0.1" value={f.gb} onChange={(e) => setF({ ...f, gb: e.target.value })} /></Field>
          <Field label="Hotspot profile" hint={routerApiConfigured ? <button type="button" className="text-sky-700" onClick={loadProfiles}>Load from router</button> : 'Must exist on the router'}>
            {profiles ? (
              <Select value={f.profile} onChange={(e) => setF({ ...f, profile: e.target.value })}>
                {!profiles.includes(f.profile) && <option>{f.profile}</option>}
                {profiles.map((p) => <option key={p}>{p}</option>)}
              </Select>
            ) : <Input value={f.profile} onChange={(e) => setF({ ...f, profile: e.target.value })} />}
          </Field>
        </div>
        <Field label="Colour (on cards and sell buttons)">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setF({ ...f, color: c })} aria-label={c}
                className={cx('size-9 rounded-full ring-offset-2', f.color === c && 'ring-2 ring-slate-900')} style={{ background: c }} />
            ))}
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="size-4" />Show on the sell screen</label>
        <ErrorBox>{error}</ErrorBox>
        <Button busy={busy} size="lg">Save plan</Button>
      </form>
    </Modal>
  );
}

/* ---------------- Sites ---------------- */
function SitesTab() {
  const { sites, tenant, reload } = useApp();
  const [edit, setEdit] = useState<Partial<Site> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return;
    setBusy(true); setError(null);
    const row = {
      tenant_id: tenant!.id, name: edit.name?.trim(), timezone: edit.timezone || 'Africa/Juba',
      opens_at: edit.opens_at || null, closes_at: edit.closes_at || null, hotspot_server: edit.hotspot_server?.trim() || 'all',
    };
    const r = edit.id ? await supabase.from('sites').update(row).eq('id', edit.id) : await supabase.from('sites').insert(row);
    setBusy(false);
    if (r.error) { setError(r.error.code === '23505' ? 'A site with that name already exists' : errText(r.error)); return; }
    setEdit(null); reload();
  }
  async function remove(s: Site) {
    if (!confirm(`Delete site ${s.name}? Its plans, vouchers, sales and router link are deleted too. This cannot be undone.`)) return;
    if (prompt(`Type the site name to confirm: ${s.name}`) !== s.name) return;
    const r = await supabase.from('sites').delete().eq('id', s.id);
    if (r.error) setError(errText(r.error)); else reload();
  }

  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={() => setEdit({ timezone: 'Africa/Juba', hotspot_server: 'all' })}><Plus className="size-4" />Add site</Button></div>
      <ErrorBox>{!edit && error}</ErrorBox>
      <Table head={['Site', 'Hours', 'Hotspot server', '']}>
        {sites.map((s) => (
          <tr key={s.id}>
            <Td className="font-semibold">{s.name}</Td>
            <Td>{s.opens_at ? `${s.opens_at.slice(0, 5)}–${s.closes_at?.slice(0, 5) ?? '?'}` : '—'}</Td>
            <Td className="font-mono">{s.hotspot_server}</Td>
            <Td className="text-right">
              <Button size="sm" variant="ghost" onClick={() => setEdit(s)}><Pencil className="size-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => remove(s)}><Trash2 className="size-4 text-red-600" /></Button>
            </Td>
          </tr>
        ))}
      </Table>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit site' : 'New site'}>
        {edit && (
          <form onSubmit={save} className="grid gap-3">
            <Field label="Name"><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Opens"><Input type="time" value={edit.opens_at?.slice(0, 5) ?? ''} onChange={(e) => setEdit({ ...edit, opens_at: e.target.value })} /></Field>
              <Field label="Closes"><Input type="time" value={edit.closes_at?.slice(0, 5) ?? ''} onChange={(e) => setEdit({ ...edit, closes_at: e.target.value })} /></Field>
            </div>
            <Field label="Hotspot server name" hint="Exact RouterOS hotspot server name, or 'all'. A wrong name gives customers 'invalid username or password'.">
              <Input value={edit.hotspot_server ?? 'all'} onChange={(e) => setEdit({ ...edit, hotspot_server: e.target.value })} className="font-mono" />
            </Field>
            <ErrorBox>{error}</ErrorBox>
            <Button busy={busy} size="lg">Save site</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}

/* ---------------- Agents ---------------- */
function AgentsTab() {
  const { sites, tenant } = useApp();
  const { data: agents, reload, error } = useLoad(async () => must(await supabase.from('agents').select('*').order('name')) as Agent[], [tenant?.id], []);
  const [edit, setEdit] = useState<Partial<Agent> | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return;
    setBusy(true); setFormError(null);
    const row = {
      tenant_id: tenant!.id, name: edit.name?.trim(), phone: edit.phone || null, code: (edit.code ?? '').trim().toUpperCase(),
      commission_pct: Number(edit.commission_pct ?? 0), site_id: edit.site_id || null, active: edit.active ?? true,
    };
    const r = edit.id ? await supabase.from('agents').update(row).eq('id', edit.id) : await supabase.from('agents').insert(row);
    setBusy(false);
    if (r.error) { setFormError(r.error.code === '23505' ? 'That agent code is already used' : errText(r.error)); return; }
    setEdit(null); reload();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Agents sell on your behalf. The cashier enters their code; commission shows in Reports.</p>
        <Button onClick={() => setEdit({ commission_pct: 10, active: true })}><Plus className="size-4" />Add agent</Button>
      </div>
      <ErrorBox>{error}</ErrorBox>
      <Table empty={agents.length === 0} head={['Agent', 'Code', 'Site', 'Commission', 'Phone', '']}>
        {agents.map((a) => (
          <tr key={a.id} className={a.active ? '' : 'opacity-50'}>
            <Td className="font-semibold">{a.name}</Td>
            <Td className="font-mono font-bold">{a.code}</Td>
            <Td>{a.site_id ? sites.find((s) => s.id === a.site_id)?.name : 'Any site'}</Td>
            <Td>{Number(a.commission_pct)}%</Td>
            <Td>{a.phone ?? '—'}</Td>
            <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEdit(a)}><Pencil className="size-4" /></Button></Td>
          </tr>
        ))}
      </Table>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit agent' : 'New agent'}>
        {edit && (
          <form onSubmit={save} className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></Field>
              <Field label="Code"><Input value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} className="font-mono" required /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Commission %"><Input type="number" min={0} max={100} step="0.5" value={edit.commission_pct ?? 0} onChange={(e) => setEdit({ ...edit, commission_pct: Number(e.target.value) })} /></Field>
              <Field label="Phone"><Input value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} inputMode="tel" /></Field>
            </div>
            <Field label="Site">
              <Select value={edit.site_id ?? ''} onChange={(e) => setEdit({ ...edit, site_id: e.target.value || null })}>
                <option value="">Any site</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="size-4" />Active</label>
            <ErrorBox>{formError}</ErrorBox>
            <Button busy={busy} size="lg">Save agent</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}

/* ---------------- Staff ---------------- */
type Member = { user_id: string; email: string; role: Role; site_id: string | null };
function StaffTab() {
  const { tenant, sites, session, isOwner } = useApp();
  const { data: members, reload, error } = useLoad(async () =>
    must(await supabase.rpc('list_members', { p_tenant: tenant!.id })) as Member[], [tenant?.id], []);
  const [f, setF] = useState({ email: '', role: 'cashier' as Role, site_id: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setFormError(null);
    const { error } = await supabase.rpc('add_member', { p_tenant: tenant!.id, p_email: f.email, p_role: f.role, p_site: f.site_id || null });
    setBusy(false);
    if (error) { setFormError(errText(error)); return; }
    setF({ ...f, email: '' }); reload();
  }
  async function remove(m: Member) {
    if (!confirm(`Remove ${m.email} from ${tenant?.name}?`)) return;
    const { error } = await supabase.rpc('remove_member', { p_tenant: tenant!.id, p_user: m.user_id });
    if (error) setFormError(errText(error)); else reload();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div>
        <ErrorBox>{error}</ErrorBox>
        <Table head={['Email', 'Role', 'Site', '']}>
          {members.map((m) => (
            <tr key={m.user_id}>
              <Td>{m.email}{m.user_id === session?.user.id && <span className="ml-1 text-xs text-slate-500">(you)</span>}</Td>
              <Td><Badge tone={m.role === 'owner' ? 'violet' : m.role === 'admin' ? 'sky' : 'slate'}>{m.role}</Badge></Td>
              <Td>{m.site_id ? sites.find((s) => s.id === m.site_id)?.name : 'All sites'}</Td>
              <Td className="text-right">{m.user_id !== session?.user.id && <Button size="sm" variant="ghost" onClick={() => remove(m)}><Trash2 className="size-4 text-red-600" /></Button>}</Td>
            </tr>
          ))}
        </Table>
      </div>
      <Card>
        <h3 className="mb-1 font-semibold">Add staff</h3>
        <p className="mb-3 text-sm text-slate-500">They sign up on the login page first, then you add their email here.</p>
        <form onSubmit={add} className="grid gap-3">
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
          <Field label="Role" hint="Cashiers sell and see sales; admins also manage vouchers, routers and settings.">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              <option value="cashier">Cashier</option><option value="agent">Agent</option><option value="admin">Admin</option>
              {isOwner && <option value="owner">Owner</option>}
            </Select>
          </Field>
          <Field label="Site">
            <Select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}>
              <option value="">All sites</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <ErrorBox>{formError}</ErrorBox>
          <Button busy={busy}>Add to {tenant?.name}</Button>
        </form>
      </Card>
    </div>
  );
}

/* ---------------- Business ---------------- */
function BusinessTab() {
  const { tenant, reload } = useApp();
  const [f, setF] = useState({ name: tenant?.name ?? '', currency: tenant?.currency ?? 'SSP', auto: tenant?.auto_sale_on_activation ?? true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setSaved(false);
    const { error } = await supabase.from('tenants').update({ name: f.name.trim(), currency: f.currency, auto_sale_on_activation: f.auto }).eq('id', tenant!.id);
    setBusy(false);
    if (error) { setError(errText(error)); return; }
    setSaved(true); reload();
  }

  return (
    <Card className="max-w-xl">
      <form onSubmit={save} className="grid gap-4">
        <Field label="Business name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Main currency"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option>SSP</option><option>USD</option></Select></Field>
        <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
          <input type="checkbox" checked={f.auto} onChange={(e) => setF({ ...f, auto: e.target.checked })} className="mt-1 size-4" />
          <span className="text-sm">
            <b>Count printed cards as cash sales on first login.</b><br />
            When a card is handed out without pressing Sell, the first time a customer logs in with it a cash sale is recorded at the plan price.
            Turn this off if you only want sales that a cashier entered.
          </span>
        </label>
        <ErrorBox>{error}</ErrorBox>
        {saved && <InfoBox>Saved.</InfoBox>}
        <Button busy={busy}>Save</Button>
      </form>
    </Card>
  );
}
