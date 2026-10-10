import { useMemo, useState } from 'react';
import { Download, Plus, Search } from 'lucide-react';
import { must, useApp, useLoad } from '../lib/app';
import { supabase, errText, type Device, type DeviceKind } from '../lib/supabase';
import { downloadCsv, formatMoney } from '../lib/format';
import { Badge, Button, ErrorBox, Field, Input, Modal, PageHeader, Select, SitePicker, Stat, Table, Td, Textarea } from '../components/ui';

export const KINDS: { v: DeviceKind; label: string }[] = [
  { v: 'router', label: 'Router' }, { v: 'switch', label: 'Switch' }, { v: 'access_point', label: 'Access point' },
  { v: 'bridge', label: 'PtP bridge' }, { v: 'starlink', label: 'Starlink' }, { v: 'olt', label: 'OLT' }, { v: 'onu', label: 'ONU' },
  { v: 'media_converter', label: 'Media converter' }, { v: 'ups', label: 'UPS / power' }, { v: 'server', label: 'Server' }, { v: 'other', label: 'Other' },
];
const STATUS = { in_service: { label: 'In service', tone: 'green' }, spare: { label: 'Spare', tone: 'sky' }, faulty: { label: 'Faulty', tone: 'red' }, retired: { label: 'Retired', tone: 'slate' } } as const;
const kindLabel = (k: DeviceKind) => KINDS.find((x) => x.v === k)?.label ?? k;

export default function DevicesPage() {
  const { siteId, sites, isAdmin, tenant } = useApp();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [edit, setEdit] = useState<Partial<Device> | null>(null);

  const { data: devices, reload, error, loading } = useLoad(async () => {
    let qd = supabase.from('devices').select('*').order('kind').order('name');
    if (siteId) qd = qd.eq('site_id', siteId);
    return must(await qd) as Device[];
  }, [siteId, tenant?.id], []);

  const rows = useMemo(() => devices.filter((d) => (!kind || d.kind === kind) &&
    (!q || [d.name, d.model, d.vendor, d.serial, d.mac, d.ip, d.location].some((x) => x?.toLowerCase().includes(q.toLowerCase())))), [devices, q, kind]);
  const siteName = (id: string | null) => (id ? sites.find((s) => s.id === id)?.name ?? '' : 'Store');
  const faulty = devices.filter((d) => d.status === 'faulty').length;
  const value = devices.filter((d) => d.status !== 'retired' && d.currency === 'USD').reduce((a, d) => a + Number(d.purchase_price ?? 0), 0);

  return (
    <div>
      <PageHeader title="Network devices" subtitle="Every AP, switch, bridge, Starlink and router, by site"
        actions={<>
          <SitePicker />
          <Button variant="secondary" disabled={!rows.length} onClick={() => downloadCsv('hotzonex-devices.csv', [
            ['Name', 'Type', 'Site', 'Vendor', 'Model', 'Serial', 'MAC', 'IP', 'Location', 'Status', 'Installed', 'Price', 'Currency', 'Notes'],
            ...rows.map((d) => [d.name, kindLabel(d.kind), siteName(d.site_id), d.vendor, d.model, d.serial, d.mac, d.ip, d.location, STATUS[d.status].label, d.installed_on, d.purchase_price, d.currency, d.notes]),
          ])}><Download className="size-4" />CSV</Button>
          {isAdmin && <Button onClick={() => setEdit({ kind: 'access_point', status: 'in_service', currency: 'USD', site_id: siteId || null })}><Plus className="size-4" />Add device</Button>}
        </>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Devices" value={devices.length} />
        <Stat label="Faulty" value={faulty} tone={faulty ? 'text-red-600' : undefined} />
        <Stat label="Equipment value (USD)" value={formatMoney(value, 'USD')} />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, model, serial, MAC, IP" className="w-64 py-2 pl-9" />
        </div>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto py-2">
          <option value="">All types</option>
          {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
        </Select>
      </div>
      <ErrorBox>{error}</ErrorBox>

      <Table empty={!loading && rows.length === 0} head={['Name', 'Type', ...(siteId ? [] : ['Site']), 'Model', 'IP / MAC', 'Location', 'Status']}>
        {rows.map((d) => (
          <tr key={d.id} onClick={() => isAdmin && setEdit(d)} className={isAdmin ? 'cursor-pointer hover:bg-slate-50' : ''}>
            <Td className="font-semibold">{d.name}</Td>
            <Td>{kindLabel(d.kind)}</Td>
            {!siteId && <Td>{siteName(d.site_id)}</Td>}
            <Td>{[d.vendor, d.model].filter(Boolean).join(' ') || '—'}</Td>
            <Td><div className="font-mono text-xs">{d.ip ?? '—'}</div><div className="font-mono text-xs text-slate-500">{d.mac}</div></Td>
            <Td>{d.location ?? '—'}</Td>
            <Td><Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge></Td>
          </tr>
        ))}
      </Table>

      {edit && <DeviceModal device={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function DeviceModal({ device, onClose, onSaved }: { device: Partial<Device>; onClose: () => void; onSaved: () => void }) {
  const { tenant, sites } = useApp();
  const [f, setF] = useState<Partial<Device>>(device);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Device) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value === '' ? null : e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const row = {
      tenant_id: tenant!.id, site_id: f.site_id || null, kind: f.kind, name: f.name?.trim(), vendor: f.vendor, model: f.model,
      serial: f.serial, mac: f.mac?.toUpperCase() ?? null, ip: f.ip, location: f.location, status: f.status,
      installed_on: f.installed_on, purchase_price: f.purchase_price === null || f.purchase_price === undefined ? null : Number(f.purchase_price),
      currency: f.currency ?? 'USD', notes: f.notes,
    };
    const r = f.id ? await supabase.from('devices').update(row).eq('id', f.id) : await supabase.from('devices').insert(row);
    setBusy(false);
    if (r.error) { setError(errText(r.error)); return; }
    onSaved();
  }
  async function remove() {
    if (!f.id || !confirm(`Delete ${f.name}? Consider marking it Retired instead to keep the history.`)) return;
    const r = await supabase.from('devices').delete().eq('id', f.id);
    if (r.error) { setError(errText(r.error)); return; }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={f.id ? 'Edit device' : 'Add device'} wide>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name ?? ''} onChange={set('name')} placeholder="AP Mast 1 North" required /></Field>
        <Field label="Type">
          <Select value={f.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}</Select>
        </Field>
        <Field label="Site">
          <Select value={f.site_id ?? ''} onChange={set('site_id')}>
            <option value="">In store / unassigned</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set('status')}>
            {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Vendor"><Input value={f.vendor ?? ''} onChange={set('vendor')} placeholder="MikroTik, Grandstream…" /></Field>
        <Field label="Model"><Input value={f.model ?? ''} onChange={set('model')} placeholder="GWN7664ELR" /></Field>
        <Field label="Serial number"><Input value={f.serial ?? ''} onChange={set('serial')} className="font-mono" /></Field>
        <Field label="MAC address"><Input value={f.mac ?? ''} onChange={set('mac')} className="font-mono" placeholder="AA:BB:CC:DD:EE:FF" /></Field>
        <Field label="IP address"><Input value={f.ip ?? ''} onChange={set('ip')} className="font-mono" /></Field>
        <Field label="Location"><Input value={f.location ?? ''} onChange={set('location')} placeholder="Mast 2, 12 m · Rack U14" /></Field>
        <Field label="Installed on"><Input type="date" value={f.installed_on ?? ''} onChange={set('installed_on')} /></Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label="Purchase price"><Input type="number" min={0} step="0.01" value={f.purchase_price ?? ''} onChange={set('purchase_price')} /></Field>
          <Field label="Currency"><Select value={f.currency ?? 'USD'} onChange={set('currency')}><option>USD</option><option>SSP</option></Select></Field>
        </div>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes ?? ''} onChange={set('notes')} /></Field>
        <div className="sm:col-span-2"><ErrorBox>{error}</ErrorBox></div>
        <div className="flex gap-2 sm:col-span-2">
          {f.id && <Button type="button" variant="ghost" onClick={remove} className="text-red-600">Delete</Button>}
          <Button busy={busy} className="ml-auto">Save device</Button>
        </div>
      </form>
    </Modal>
  );
}
