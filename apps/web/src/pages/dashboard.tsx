import { Plus, Router as RouterIcon } from 'lucide-react';
import { Link } from 'react-router';
import { settingValue } from '@hotzonex/shared/settings';
import { RouterTable, sortRoutersForOps } from '@/components/router-table';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui/surface';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/queries/misc';
import { useRouters, useUptime, type RouterWithLocation } from '@/lib/queries/routers';
import { cn } from '@/lib/utils';

export interface DashboardCounts {
  total: number;
  online: number;
  offline: number;
  attention: number;
  unknown: number;
  demo: number;
}

/** Real routers only — DEMO routers are counted separately and never as online. */
export function countRouters(routers: Pick<RouterWithLocation, 'status' | 'is_demo'>[]): DashboardCounts {
  const real = routers.filter((r) => !r.is_demo);
  return {
    total: real.length,
    online: real.filter((r) => r.status === 'online').length,
    offline: real.filter((r) => r.status === 'offline').length,
    attention: real.filter((r) => r.status === 'warning' || r.status === 'critical').length,
    unknown: real.filter((r) => r.status === 'unknown').length,
    demo: routers.length - real.length,
  };
}

function StatTile({ label, value, note, tone }: { label: string; value: number | null; note?: string; tone?: 'good' | 'critical' | 'warning' }) {
  const dot = { good: 'bg-status-good', critical: 'bg-status-critical', warning: 'bg-status-warning' } as const;
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {tone ? <span className={cn('size-2 rounded-full', dot[tone])} aria-hidden /> : null}
        {label}
      </p>
      {value === null ? <Skeleton className="mt-2 h-8 w-16" /> : <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>}
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </Card>
  );
}

export function DashboardPage() {
  const { can } = useAuth();
  const routers = useRouters();
  const uptime = useUptime(7);
  const settings = useSettings();
  const poll = settingValue('health_poll_interval_seconds', settings.data ?? []);
  const counts = routers.data ? countRouters(routers.data) : null;

  return (
    <>
      <PageHeader title="Dashboard" description="Live state of every router, refreshed as the connector reports in." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Routers" value={counts?.total ?? null} note={counts?.demo ? `+${counts.demo} demo, not counted` : counts?.unknown ? `${counts.unknown} not reporting yet` : undefined} />
        <StatTile label="Online" value={counts?.online ?? null} tone="good" />
        <StatTile label="Offline" value={counts?.offline ?? null} tone="critical" note={counts && counts.offline > 0 ? 'Last contact kept on each router' : undefined} />
        <StatTile label="Needs attention" value={counts?.attention ?? null} tone="warning" note="High CPU, memory or sensor alarms" />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <div>
            <CardTitle>Router status</CardTitle>
            <CardDescription>Problems first. Uptime bars: share of health polls answered per 6-hour window.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/routers">All routers</Link>
          </Button>
        </CardHeader>
        {routers.isPending ? (
          <TableSkeleton rows={4} cols={6} />
        ) : routers.isError ? (
          <div className="p-4">
            <ErrorState error={routers.error} onRetry={() => void routers.refetch()} />
          </div>
        ) : routers.data.length === 0 ? (
          <EmptyState
            icon={<RouterIcon />}
            title="No routers yet"
            description="Add a router to start monitoring it. The wizard gives you a one-time script for the router and checks the connection for you."
            action={
              can.createRouters ? (
                <Button asChild>
                  <Link to="/routers/new">
                    <Plus /> Add router
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <RouterTable
            routers={sortRoutersForOps(routers.data)}
            columns={['status', 'location', 'lastSeen', 'version', 'cpu', 'uptime7d']}
            pollIntervalSeconds={poll}
            uptime={uptime.data}
          />
        )}
        {uptime.isError ? <p className="border-t px-4 py-2 text-xs text-muted-foreground">Uptime history could not be loaded; statuses above are current.</p> : null}
      </Card>
    </>
  );
}
