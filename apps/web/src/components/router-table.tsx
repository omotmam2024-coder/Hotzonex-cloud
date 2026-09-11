import { Link } from 'react-router';
import type { UptimeBucket, RouterWithLocation } from '@/lib/queries/routers';
import { formatDuration } from '@hotzonex/shared/time';
import { humanStatusReason } from '@/lib/status-reason';
import { CredentialsBadge, DemoBadge, StatusBadge } from './status';
import { LastSeen, RelativeTime } from './time';
import { Table, TBody, TD, TH, THead, TR } from './ui/table';
import { UptimeBars, buildUptimeSeries } from './uptime-bars';

export type RouterColumn = 'status' | 'location' | 'lastSeen' | 'tunnel' | 'version' | 'cpu' | 'uptime7d' | 'credentials' | 'protocol';

const STATUS_ORDER: Record<string, number> = { offline: 0, critical: 1, warning: 2, unknown: 3, online: 4 };

/** Problems first, demo routers last, then by name. */
export function sortRoutersForOps(routers: RouterWithLocation[]): RouterWithLocation[] {
  return [...routers].sort(
    (a, b) =>
      Number(a.is_demo) - Number(b.is_demo) ||
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      a.name.localeCompare(b.name),
  );
}

export function RouterTable({
  routers,
  columns,
  pollIntervalSeconds,
  uptime,
}: {
  routers: RouterWithLocation[];
  columns: RouterColumn[];
  pollIntervalSeconds: number;
  uptime?: UptimeBucket[] | undefined;
}) {
  const has = (c: RouterColumn) => columns.includes(c);
  const now = new Date();
  return (
    <>
      <RouterCards routers={routers} columns={columns} pollIntervalSeconds={pollIntervalSeconds} uptime={uptime} now={now} />
      <Table containerClassName="hidden max-h-[70dvh] sm:block">
      <THead>
        <TR className="hover:bg-transparent">
          <TH>Router</TH>
          {has('status') && <TH>Status</TH>}
          {has('location') && <TH>Location</TH>}
          {has('lastSeen') && <TH>Last seen</TH>}
          {has('tunnel') && <TH>Tunnel</TH>}
          {has('protocol') && <TH>API</TH>}
          {has('version') && <TH>RouterOS</TH>}
          {has('cpu') && <TH className="text-right">CPU</TH>}
          {has('credentials') && <TH>Credentials</TH>}
          {has('uptime7d') && <TH>7-day uptime</TH>}
        </TR>
      </THead>
      <TBody>
        {routers.map((r) => (
          <TR key={r.id}>
            <TD className="max-w-64">
              <div className="flex items-center gap-2">
                <Link to={`/routers/${r.id}`} className="truncate font-medium hover:underline">
                  {r.name}
                </Link>
                {r.is_demo ? <DemoBadge /> : null}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {r.identity ?? (r.onboarding_completed_at ? '—' : 'Onboarding not finished')}
              </div>
            </TD>
            {has('status') && (
              <TD>
                <StatusBadge status={r.status} />
                {r.status_reason && r.status !== 'online' ? (
                  <div className="mt-0.5 max-w-48 truncate text-xs text-muted-foreground" title={humanStatusReason(r.status_reason) ?? undefined}>
                    {humanStatusReason(r.status_reason)}
                  </div>
                ) : null}
              </TD>
            )}
            {has('location') && <TD className="whitespace-nowrap">{r.location?.name ?? <span className="text-muted-foreground">Unassigned</span>}</TD>}
            {has('lastSeen') && (
              <TD>
                <LastSeen value={r.last_seen_at} pollIntervalSeconds={pollIntervalSeconds} status={r.status} />
              </TD>
            )}
            {has('tunnel') && (
              <TD className="whitespace-nowrap text-xs">
                <span className="font-mono">{r.wg_address}</span>
                <div className="text-muted-foreground">
                  {r.is_demo ? 'simulated' : r.wg_last_handshake_at ? <>handshake <RelativeTime value={r.wg_last_handshake_at} /></> : 'no handshake yet'}
                </div>
              </TD>
            )}
            {has('protocol') && <TD className="whitespace-nowrap text-xs font-mono">{r.api_protocol}:{r.api_port}</TD>}
            {has('version') && <TD className="whitespace-nowrap tabular">{r.routeros_version ?? '—'}</TD>}
            {has('cpu') && (
              <TD className="text-right tabular">
                {r.cpu_load === null ? '—' : `${r.cpu_load}%`}
                {r.uptime_seconds !== null ? <div className="text-xs text-muted-foreground">up {formatDuration(r.uptime_seconds)}</div> : null}
              </TD>
            )}
            {has('credentials') && (
              <TD>
                {r.is_demo ? <span className="text-xs text-muted-foreground">not needed (demo)</span> : <CredentialsBadge status={r.credentials_status} />}
              </TD>
            )}
            {has('uptime7d') && (
              <TD>
                <UptimeBars series={buildUptimeSeries(uptime ?? [], r.id, now)} label={r.name} />
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
    </>
  );
}

/** Phones (< 640px): one card per router instead of a wide table, so nothing hides off-screen. */
function RouterCards({
  routers,
  columns,
  pollIntervalSeconds,
  uptime,
  now,
}: {
  routers: RouterWithLocation[];
  columns: RouterColumn[];
  pollIntervalSeconds: number;
  uptime?: UptimeBucket[] | undefined;
  now: Date;
}) {
  const has = (c: RouterColumn) => columns.includes(c);
  return (
    <ul className="divide-y sm:hidden">
      {routers.map((r) => (
        <li key={r.id}>
          <Link to={`/routers/${r.id}`} className="grid gap-1.5 px-4 py-3 hover:bg-muted/50">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{r.name}</span>
                  {r.is_demo ? <DemoBadge /> : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {r.location?.name ?? 'Unassigned'} · {r.identity ?? (r.onboarding_completed_at ? '—' : 'onboarding not finished')}
                </div>
              </div>
              <StatusBadge status={r.status} className="shrink-0" />
            </div>
            {r.status_reason && r.status !== 'online' ? (
              <p className="text-xs text-muted-foreground">{humanStatusReason(r.status_reason)}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                Last seen <LastSeen value={r.last_seen_at} pollIntervalSeconds={pollIntervalSeconds} status={r.status} />
              </span>
              {has('version') && r.routeros_version ? <span>RouterOS {r.routeros_version}</span> : null}
              {has('cpu') && r.cpu_load !== null ? <span>CPU {r.cpu_load}%</span> : null}
              {has('credentials') && !r.is_demo && r.credentials_status !== 'set' ? <CredentialsBadge status={r.credentials_status} /> : null}
            </div>
            {has('uptime7d') ? <UptimeBars series={buildUptimeSeries(uptime ?? [], r.id, now)} label={r.name} /> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
