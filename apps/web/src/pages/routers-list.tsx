import { Plus, Router as RouterIcon, Search } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { settingValue } from '@hotzonex/shared/settings';
import { ROUTER_STATUSES, ROUTER_STATUS_LABELS } from '@hotzonex/shared/status';
import { RouterTable, sortRoutersForOps } from '@/components/router-table';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form-controls';
import { Card } from '@/components/ui/surface';
import { useAuth } from '@/lib/auth';
import { useLocations, useSettings } from '@/lib/queries/misc';
import { useRouters } from '@/lib/queries/routers';

export function RoutersPage() {
  const { can } = useAuth();
  const routers = useRouters();
  const locations = useLocations();
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const location = params.get('location') ?? '';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sortRoutersForOps(
      (routers.data ?? []).filter(
        (r) =>
          (!needle || [r.name, r.identity, r.wg_address, r.board_name].some((v) => v?.toLowerCase().includes(needle))) &&
          (!status || r.status === status) &&
          (!location || (location === 'none' ? r.location_id === null : r.location_id === location)),
      ),
    );
  }, [routers.data, q, status, location]);

  return (
    <>
      <PageHeader
        title="Routers"
        description="Every MikroTik router, reached by the connector over its WireGuard tunnel."
        actions={
          can.createRouters ? (
            <Button asChild>
              <Link to="/routers/new">
                <Plus /> Add router
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-8" placeholder="Search name, identity, tunnel IP" aria-label="Search routers" value={q} onChange={(e) => setParam('q', e.target.value)} />
        </div>
        <Select className="w-auto" aria-label="Filter by status" value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">All statuses</option>
          {ROUTER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ROUTER_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select className="w-auto" aria-label="Filter by location" value={location} onChange={(e) => setParam('location', e.target.value)}>
          <option value="">All locations</option>
          <option value="none">Unassigned</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {routers.isPending ? (
          <TableSkeleton rows={6} cols={7} />
        ) : routers.isError ? (
          <div className="p-4">
            <ErrorState error={routers.error} onRetry={() => void routers.refetch()} />
          </div>
        ) : routers.data.length === 0 ? (
          <EmptyState
            icon={<RouterIcon />}
            title="No routers yet"
            description="Add your first router. You will get a one-time script to paste into its terminal; it connects the router to Hotzonex over an outbound WireGuard tunnel."
            action={can.createRouters ? <Button asChild><Link to="/routers/new"><Plus /> Add router</Link></Button> : undefined}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No routers match these filters" description="Clear the search or pick a different status or location." action={<Button variant="outline" onClick={() => setParams({}, { replace: true })}>Clear filters</Button>} />
        ) : (
          <RouterTable
            routers={filtered}
            columns={['status', 'location', 'lastSeen', 'tunnel', 'protocol', 'version', 'credentials']}
            pollIntervalSeconds={settingValue('health_poll_interval_seconds', settings.data ?? [])}
          />
        )}
      </Card>
    </>
  );
}
