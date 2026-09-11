import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { AuditTable } from '@/components/audit-table';
import { PageHeader } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form-controls';
import { Card } from '@/components/ui/surface';
import type { AuditFilters } from '@/lib/queries/misc';

const ACTION_GROUPS = [
  { value: '', label: 'All actions' },
  { value: 'auth.', label: 'Sign-in & sign-out' },
  { value: 'router.', label: 'Routers (all)' },
  { value: 'router.credentials', label: 'Router credentials' },
  { value: 'router.test_connection', label: 'Connection tests' },
  { value: 'router.sync', label: 'Syncs' },
  { value: 'location.', label: 'Locations' },
  { value: 'settings', label: 'Settings' },
  { value: 'team.', label: 'Team & invitations' },
];

const ENTITY_TYPES = ['', 'user', 'router', 'location', 'system_setting', 'tenant', 'profile', 'invite'];

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const filters: AuditFilters = useMemo(
    () => ({
      ...(params.get('action') ? { action: params.get('action') as string } : {}),
      ...(params.get('entity') ? { entityType: params.get('entity') as string } : {}),
      ...(params.get('actor') ? { actor: params.get('actor') as string } : {}),
      ...(params.get('from') ? { from: params.get('from') as string } : {}),
      ...(params.get('to') ? { to: params.get('to') as string } : {}),
    }),
    [params],
  );
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Audit Logs" description="Every sign-in, change and router action, recorded server-side. Entries cannot be edited or deleted." />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Select className="w-auto" aria-label="Action" value={params.get('action') ?? ''} onChange={(e) => set('action', e.target.value)}>
          {ACTION_GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </Select>
        <Select className="w-auto" aria-label="Entity type" value={params.get('entity') ?? ''} onChange={(e) => set('entity', e.target.value)}>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t ? t.replace('_', ' ') : 'All entities'}</option>)}
        </Select>
        <Input className="w-48" placeholder="Actor email" aria-label="Actor email" value={params.get('actor') ?? ''} onChange={(e) => set('actor', e.target.value)} />
        <label className="grid gap-1 text-xs text-muted-foreground">
          From
          <Input type="date" className="w-40" value={params.get('from') ?? ''} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          To
          <Input type="date" className="w-40" value={params.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} />
        </label>
        {params.size > 0 ? <Button variant="ghost" onClick={() => setParams({}, { replace: true })}>Clear</Button> : null}
      </div>
      <Card>
        <AuditTable filters={filters} />
      </Card>
    </>
  );
}
