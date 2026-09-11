import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, KeyRound, Pencil, PlayCircle, RefreshCw, ShieldCheck, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { JobRow } from '@hotzonex/shared/database';
import { describeJobError } from '@hotzonex/shared/errors';
import { JOB_TYPES, type JobType } from '@hotzonex/shared/jobs';
import { credentialsSchema, type CredentialsInput } from '@hotzonex/shared/schemas';
import { settingValue } from '@hotzonex/shared/settings';
import { formatBytes, formatDuration } from '@hotzonex/shared/time';
import { AuditTable } from '@/components/audit-table';
import { ConnectionResultView, PermissionsResultView, SyncResultView } from '@/components/job-results';
import { JobProgress } from '@/components/job-progress';
import { RouterForm } from '@/components/router-form';
import { EmptyState, ErrorState, InlineError, PageHeader, TableSkeleton } from '@/components/states';
import { CredentialsBadge, DemoBadge, StatusBadge } from '@/components/status';
import { LastSeen, RelativeTime } from '@/components/time';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, fieldA11y } from '@/components/ui/form-controls';
import { ConfirmDialog, Dialog, SheetContent, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Facts, Skeleton } from '@/components/ui/surface';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { UptimeBars, buildUptimeSeries } from '@/components/uptime-bars';
import { useAuth } from '@/lib/auth';
import { userMessage } from '@/lib/errors';
import { humanStatusReason } from '@/lib/status-reason';
import { JOB_STATUS_LABEL, useEnqueueJob, useRouterJobs, useSubmitCredentials } from '@/lib/queries/jobs';
import { useConnector, useLocations, useSettings } from '@/lib/queries/misc';
import {
  useDeleteRouter,
  useLatestMetric,
  useResolveDrift,
  useRouter,
  useRouterDrift,
  useRouterHotspot,
  useRouterInterfaces,
  useUpdateRouter,
  useUptime,
  type RouterWithLocation,
} from '@/lib/queries/routers';

const TABS = ['overview', 'system', 'interfaces', 'hotspot', 'logs', 'audit'] as const;
type Tab = (typeof TABS)[number];

// -----------------------------------------------------------------------------
// Overview
// -----------------------------------------------------------------------------
function ActionPanel({ router }: { router: RouterWithLocation }) {
  const { can } = useAuth();
  const enqueue = useEnqueueJob(router.id);
  const [active, setActive] = useState<{ id: string; type: JobType } | null>(null);
  const run = (type: 'router.test_connection' | 'router.test_permissions' | 'router.sync') =>
    enqueue.mutate({ type }, { onSuccess: (j) => setActive({ id: j.id, type }) });
  if (!can.runRouterActions) return null;
  const blocked = !router.is_demo && router.credentials_status !== 'set' && router.credentials_status !== 'pending';
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Actions</CardTitle>
          <CardDescription>Queued for the connector; results appear here live. Offline routers run them when they come back.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {blocked ? <p className="text-sm text-muted-foreground">Set this router’s credentials first (Replace credentials, above).</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={blocked} loading={enqueue.isPending && enqueue.variables?.type === 'router.test_connection'} onClick={() => run('router.test_connection')}>
            <PlayCircle /> Test connection
          </Button>
          <Button variant="outline" disabled={blocked} loading={enqueue.isPending && enqueue.variables?.type === 'router.test_permissions'} onClick={() => run('router.test_permissions')}>
            <ShieldCheck /> Test permissions
          </Button>
          <Button variant="outline" disabled={blocked} loading={enqueue.isPending && enqueue.variables?.type === 'router.sync'} onClick={() => run('router.sync')}>
            <RefreshCw /> Sync now
          </Button>
        </div>
        <InlineError error={enqueue.error} />
        {active?.type === 'router.test_connection' ? (
          <JobProgress key={active.id} jobId={active.id} type="router.test_connection">{(r) => <ConnectionResultView r={r} />}</JobProgress>
        ) : null}
        {active?.type === 'router.test_permissions' ? (
          <JobProgress key={active.id} jobId={active.id} type="router.test_permissions">{(r) => <PermissionsResultView r={r} />}</JobProgress>
        ) : null}
        {active?.type === 'router.sync' ? (
          <JobProgress key={active.id} jobId={active.id} type="router.sync">{(r) => <SyncResultView r={r} />}</JobProgress>
        ) : null}
      </CardContent>
    </Card>
  );
}

function JobHistory({ routerId }: { routerId: string }) {
  const jobs = useRouterJobs(routerId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent jobs</CardTitle>
      </CardHeader>
      {jobs.isPending ? (
        <TableSkeleton rows={3} cols={4} />
      ) : jobs.isError ? (
        <div className="p-4">
          <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
        </div>
      ) : jobs.data.length === 0 ? (
        <EmptyState title="No jobs yet" description="Connection tests, syncs and log fetches you run will be listed here with their outcome." />
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Job</TH>
              <TH>Status</TH>
              <TH>Requested</TH>
              <TH>Outcome</TH>
            </TR>
          </THead>
          <TBody>
            {jobs.data.map((j: JobRow) => (
              <TR key={j.id}>
                <TD className="whitespace-nowrap">{JOB_TYPES[j.type as JobType]?.label ?? j.type}</TD>
                <TD className="whitespace-nowrap">
                  {JOB_STATUS_LABEL[j.status]}
                  {j.attempts > 1 ? <span className="text-xs text-muted-foreground"> · {j.attempts} attempts</span> : null}
                </TD>
                <TD className="whitespace-nowrap text-xs"><RelativeTime value={j.created_at} /></TD>
                <TD className="max-w-72 text-xs">
                  {j.status === 'failed' || j.status === 'dead' ? (
                    <span title={j.last_error ?? undefined}>{describeJobError(j.last_error_code).title}</span>
                  ) : j.status === 'pending' && j.last_error_code ? (
                    <span className="text-muted-foreground">waiting: {describeJobError(j.last_error_code).title.toLowerCase()}</span>
                  ) : j.status === 'succeeded' ? (
                    <span className="text-success-text">OK</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function OverviewTab({ router, poll }: { router: RouterWithLocation; poll: number }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="self-start">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <Facts
            items={[
              { label: 'Status', value: <StatusBadge status={router.status} /> },
              { label: 'Last seen', value: <LastSeen value={router.last_seen_at} pollIntervalSeconds={poll} status={router.status} /> },
              { label: 'Reason', value: humanStatusReason(router.status_reason) ?? '—' },
              { label: 'Last poll', value: <RelativeTime value={router.last_polled_at} /> },
              { label: 'Location', value: router.location?.name ?? 'Unassigned' },
              { label: 'Credentials', value: router.is_demo ? 'Not needed (demo)' : <CredentialsBadge status={router.credentials_status} /> },
              { label: 'Tunnel address', value: router.wg_address, mono: true },
              {
                label: 'Tunnel',
                value: router.is_demo ? 'Simulated' : !router.wg_public_key ? 'Router key not provided yet' : router.wg_last_handshake_at ? <>handshake <RelativeTime value={router.wg_last_handshake_at} /></> : 'No handshake yet',
              },
              { label: 'API', value: `${router.api_protocol} on port ${router.api_port}${router.api_protocol === 'rest' ? (router.use_ssl ? ' (HTTPS)' : ' (HTTP)') : ''}`, mono: true },
              { label: 'Added', value: <RelativeTime value={router.created_at} /> },
            ]}
          />
          {router.notes ? <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{router.notes}</p> : null}
        </CardContent>
      </Card>
      <div className="grid content-start gap-4">
        <ActionPanel router={router} />
        <JobHistory routerId={router.id} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// System
// -----------------------------------------------------------------------------
function SystemTab({ router }: { router: RouterWithLocation }) {
  const metric = useLatestMetric(router.id);
  const uptime = useUptime(7);
  const sensors = ((metric.data?.health as { sensors?: Array<{ name: string; value: number | null; unit: string | null; state: string | null }> } | null)?.sensors ?? []);
  const usedPct = router.total_memory && router.free_memory !== null ? Math.round((1 - router.free_memory / router.total_memory) * 100) : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>System</CardTitle>
        </CardHeader>
        <CardContent>
          {!router.identity && !router.routeros_version ? (
            <EmptyState title="Not discovered yet" description="Run “Sync now” on the Overview tab (or finish onboarding) to read the router’s identity and resources." />
          ) : (
            <Facts
              items={[
                { label: 'Identity', value: router.identity ?? '—' },
                { label: 'RouterOS version', value: router.routeros_version ?? '—' },
                { label: 'Board', value: router.board_name ?? '—' },
                { label: 'Architecture', value: router.architecture ?? '—' },
                { label: 'CPU load', value: router.cpu_load === null ? '—' : `${router.cpu_load}%` },
                { label: 'Memory used', value: usedPct === null ? '—' : `${usedPct}% (${formatBytes((router.total_memory ?? 0) - (router.free_memory ?? 0))} of ${formatBytes(router.total_memory)})` },
                { label: 'Uptime', value: formatDuration(router.uptime_seconds) },
                { label: 'Last discovery', value: <RelativeTime value={router.discovered_at} /> },
                { label: 'Poll latency', value: metric.data && metric.data.latency_ms !== null ? `${metric.data.latency_ms} ms` : '—' },
              ]}
            />
          )}
        </CardContent>
      </Card>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>7-day uptime</CardTitle>
              <CardDescription>Share of health polls answered, per 6-hour window.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {uptime.isPending ? <Skeleton className="h-6 w-64" /> : uptime.isError ? <ErrorState error={uptime.error} /> : <UptimeBars series={buildUptimeSeries(uptime.data, router.id, new Date())} label={router.name} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Health sensors</CardTitle>
          </CardHeader>
          {metric.isPending ? (
            <TableSkeleton rows={2} cols={2} />
          ) : sensors.length === 0 ? (
            <EmptyState title="No sensor data" description="Some hardware (and virtual CHR routers) report no voltage or temperature sensors. Values appear after the next health poll if available." />
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Sensor</TH>
                  <TH className="text-right">Value</TH>
                </TR>
              </THead>
              <TBody>
                {sensors.map((s) => (
                  <TR key={s.name}>
                    <TD className="font-mono text-xs">{s.name}</TD>
                    <TD className="text-right tabular">{s.value !== null ? `${s.value}${s.unit ? ` ${s.unit}` : ''}` : s.state ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Interfaces
// -----------------------------------------------------------------------------
function InterfacesTab({ router }: { router: RouterWithLocation }) {
  const ifaces = useRouterInterfaces(router.id);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Interfaces</CardTitle>
          <CardDescription>Mirrored from the router at the last sync. Interfaces removed on the router stay listed, marked “gone”.</CardDescription>
        </div>
      </CardHeader>
      {ifaces.isPending ? (
        <TableSkeleton rows={5} cols={6} />
      ) : ifaces.isError ? (
        <div className="p-4"><ErrorState error={ifaces.error} onRetry={() => void ifaces.refetch()} /></div>
      ) : ifaces.data.length === 0 ? (
        <EmptyState title="No interfaces synced yet" description="Run “Sync now” on the Overview tab to read the router’s interfaces." />
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>State</TH>
              <TH>MAC</TH>
              <TH className="text-right">RX</TH>
              <TH className="text-right">TX</TH>
              <TH>Comment</TH>
            </TR>
          </THead>
          <TBody>
            {ifaces.data.map((i) => (
              <TR key={i.id} className={i.removed_at ? 'opacity-60' : undefined}>
                <TD className="font-medium">{i.name}</TD>
                <TD className="text-xs">{i.type}</TD>
                <TD className="whitespace-nowrap text-xs">{i.removed_at ? 'gone from router' : i.disabled ? 'disabled' : i.running ? 'running' : 'down'}</TD>
                <TD className="font-mono text-[11px]">{i.mac ?? '—'}</TD>
                <TD className="text-right tabular text-xs">{formatBytes(i.rx_bytes)}</TD>
                <TD className="text-right tabular text-xs">{formatBytes(i.tx_bytes)}</TD>
                <TD className="max-w-48 truncate text-xs text-muted-foreground">{i.comment ?? ''}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Hotspot discovery + drift
// -----------------------------------------------------------------------------
function HotspotTab({ router }: { router: RouterWithLocation }) {
  const { can } = useAuth();
  const hotspot = useRouterHotspot(router.id);
  const drift = useRouterDrift(router.id);
  const resolve = useResolveDrift(router.id);
  const update = useUpdateRouter(router.id);
  const [server, setServer] = useState(router.hotspot_server_id ?? '');
  const [profile, setProfile] = useState(router.default_hotspot_profile_id ?? '');
  const openDrift = (drift.data ?? []).filter((d) => !d.resolved_at);

  return (
    <div className="grid gap-4">
      {openDrift.length > 0 ? (
        <Card className="border-status-warning/50">
          <CardHeader>
            <div>
              <CardTitle>Drift detected</CardTitle>
              <CardDescription>The router no longer matches what Hotzonex relies on. Hotzonex never changes the router to “fix” this; review and acknowledge.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2">
            {openDrift.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-status-warning-bg px-3 py-2 text-sm">
                <span>
                  {d.message} <span className="text-xs text-muted-foreground">(<RelativeTime value={d.detected_at} />)</span>
                </span>
                {can.runRouterActions ? (
                  <Button size="sm" variant="outline" loading={resolve.isPending && resolve.variables === d.id} onClick={() => resolve.mutate(d.id)}>
                    Acknowledge
                  </Button>
                ) : null}
              </div>
            ))}
            <InlineError error={resolve.error} />
          </CardContent>
        </Card>
      ) : null}

      {hotspot.isPending ? (
        <Skeleton className="h-40" />
      ) : hotspot.isError ? (
        <ErrorState error={hotspot.error} onRetry={() => void hotspot.refetch()} />
      ) : (
        <>
          {can.editRouters && hotspot.data.servers.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Selection</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label="Hotspot server" htmlFor="sel-server">
                  <Select id="sel-server" value={server} onChange={(e) => setServer(e.target.value)}>
                    <option value="">None</option>
                    {hotspot.data.servers.filter((s) => !s.removed_at).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
                <Field label="Default profile" htmlFor="sel-profile">
                  <Select id="sel-profile" value={profile} onChange={(e) => setProfile(e.target.value)}>
                    <option value="">None</option>
                    {hotspot.data.profiles.filter((p) => !p.removed_at).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
                <Button
                  loading={update.isPending}
                  onClick={() => update.mutate({ hotspot_server_id: server || null, default_hotspot_profile_id: profile || null }, { onSuccess: () => toast.success('Hotspot selection saved') })}
                >
                  Save
                </Button>
                <div className="sm:col-span-3"><InlineError error={update.error} /></div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Hotspot servers</CardTitle>
                <CardDescription>Discovered read-only from /ip hotspot.</CardDescription>
              </div>
            </CardHeader>
            {hotspot.data.servers.length === 0 ? (
              <EmptyState title="No hotspot servers discovered" description="Either the router has none configured or it has not been synced yet. Run “Sync now” on the Overview tab." />
            ) : (
              <Table>
                <THead><TR className="hover:bg-transparent"><TH>Name</TH><TH>Interface</TH><TH>Address pool</TH><TH>Server profile</TH><TH>State</TH><TH>RouterOS id</TH></TR></THead>
                <TBody>
                  {hotspot.data.servers.map((s) => (
                    <TR key={s.id} className={s.removed_at ? 'opacity-60' : undefined}>
                      <TD className="font-medium">{s.name}{s.id === router.hotspot_server_id ? <span className="ml-2 text-xs text-primary">selected</span> : null}</TD>
                      <TD>{s.interface ?? '—'}</TD>
                      <TD>{s.address_pool ?? '—'}</TD>
                      <TD>{s.profile ?? '—'}</TD>
                      <TD className="text-xs">{s.removed_at ? 'gone from router' : s.invalid ? 'invalid' : s.disabled ? 'disabled' : 'enabled'}</TD>
                      <TD className="font-mono text-[11px] text-muted-foreground">{s.mikrotik_id}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Hotspot user profiles</CardTitle>
                <CardDescription>Discovered read-only from /ip hotspot user profile. Packages will map onto these in a later release.</CardDescription>
              </div>
            </CardHeader>
            {hotspot.data.profiles.length === 0 ? (
              <EmptyState title="No hotspot profiles discovered" description="Run “Sync now” on the Overview tab." />
            ) : (
              <Table>
                <THead><TR className="hover:bg-transparent"><TH>Name</TH><TH>Rate limit</TH><TH>Shared users</TH><TH>Session timeout</TH><TH>Idle timeout</TH><TH>RouterOS id</TH></TR></THead>
                <TBody>
                  {hotspot.data.profiles.map((p) => (
                    <TR key={p.id} className={p.removed_at ? 'opacity-60' : undefined}>
                      <TD className="font-medium">{p.name}{p.id === router.default_hotspot_profile_id ? <span className="ml-2 text-xs text-primary">default</span> : null}{p.removed_at ? <span className="ml-2 text-xs text-muted-foreground">gone from router</span> : null}</TD>
                      <TD className="font-mono text-xs">{p.rate_limit ?? 'none'}</TD>
                      <TD className="tabular">{p.shared_users ?? 'unlimited'}</TD>
                      <TD>{p.session_timeout_seconds ? formatDuration(p.session_timeout_seconds) : 'none'}</TD>
                      <TD>{p.idle_timeout_seconds ? formatDuration(p.idle_timeout_seconds) : 'none'}</TD>
                      <TD className="font-mono text-[11px] text-muted-foreground">{p.mikrotik_id}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Logs (on demand, to spare metered links)
// -----------------------------------------------------------------------------
function LogsTab({ router }: { router: RouterWithLocation }) {
  const { can } = useAuth();
  const enqueue = useEnqueueJob(router.id);
  const [limit, setLimit] = useState(100);
  const [job, setJob] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Router log</CardTitle>
          <CardDescription>Fetched on demand, not on a timer, to save the site’s metered bandwidth.</CardDescription>
        </div>
        {can.runRouterActions ? (
          <div className="flex items-center gap-2">
            <Select aria-label="Number of lines" className="w-auto" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[50, 100, 250, 500].map((n) => <option key={n} value={n}>{n} lines</option>)}
            </Select>
            <Button loading={enqueue.isPending} onClick={() => enqueue.mutate({ type: 'router.fetch_logs', payload: { limit } }, { onSuccess: (j) => setJob(j.id) })}>
              Fetch logs
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <InlineError error={enqueue.error} />
        {!job ? (
          <EmptyState title="No logs fetched yet" description="Choose how many lines and press “Fetch logs”. The connector reads the most recent entries from the router." />
        ) : (
          <JobProgress key={job} jobId={job} type="router.fetch_logs">
            {(r) =>
              r.entries.length === 0 ? (
                <EmptyState title="The router’s log is empty" description="RouterOS keeps recent log lines in memory; they are cleared on reboot." />
              ) : (
                <Table containerClassName="max-h-[60dvh]">
                  <THead><TR className="hover:bg-transparent"><TH>Time</TH><TH>Topics</TH><TH>Message</TH></TR></THead>
                  <TBody>
                    {[...r.entries].reverse().map((e) => (
                      <TR key={e.id}>
                        <TD className="whitespace-nowrap font-mono text-[11px]">{e.time}</TD>
                        <TD className="whitespace-nowrap text-xs text-muted-foreground">{e.topics.join(', ')}</TD>
                        <TD className="font-mono text-[12px]">{e.message}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )
            }
          </JobProgress>
        )}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Edit / credentials / delete
// -----------------------------------------------------------------------------
function EditSheet({ router, open, onOpenChange }: { router: RouterWithLocation; open: boolean; onOpenChange: (o: boolean) => void }) {
  const update = useUpdateRouter(router.id);
  const locations = useLocations();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Edit router" description="Changes are recorded in the audit log.">
        <RouterForm
          showLocation
          locations={locations.data ?? []}
          defaults={{ name: router.name, location_id: router.location_id, api_protocol: router.api_protocol, api_port: router.api_port, use_ssl: router.use_ssl, notes: router.notes }}
          submitLabel="Save changes"
          pending={update.isPending}
          error={update.error}
          onSubmit={(v) => update.mutate(v, { onSuccess: () => { toast.success('Router saved'); onOpenChange(false); } })}
        />
      </SheetContent>
    </Dialog>
  );
}

function CredentialsSheet({ router, open, onOpenChange }: { router: RouterWithLocation; open: boolean; onOpenChange: (o: boolean) => void }) {
  const connector = useConnector();
  const submit = useSubmitCredentials(router.id);
  const [job, setJob] = useState<string | null>(null);
  const form = useForm<CredentialsInput>({ resolver: zodResolver(credentialsSchema), defaultValues: { username: 'hotzonex-api', password: '' } });
  const { errors } = form.formState;
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { form.reset(); setJob(null); } }}>
      <SheetContent title="Replace credentials" description="Use this if the API user’s password was changed on the router. The current credentials are never shown.">
        <form
          className="grid gap-4"
          noValidate
          onSubmit={form.handleSubmit((v) =>
            submit.mutate(
              { sealingKey: connector.data?.sealingKey ?? null, username: v.username, password: v.password },
              { onSuccess: (j) => { setJob(j.id); form.setValue('password', ''); } },
            ),
          )}
        >
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            The password is encrypted in this browser to the connector’s key before it is sent. Only the connector can read it; it is stored encrypted and never returned to any screen.
          </p>
          <Field label="API username" htmlFor="username" error={errors.username?.message}>
            <Input autoComplete="off" {...fieldA11y('username', errors.username?.message)} {...form.register('username')} />
          </Field>
          <Field label="API password" htmlFor="password" error={errors.password?.message}>
            <Input type="password" autoComplete="new-password" {...fieldA11y('password', errors.password?.message)} {...form.register('password')} />
          </Field>
          <InlineError error={submit.error} />
          <div className="flex justify-end">
            <Button type="submit" loading={submit.isPending}>
              <KeyRound /> Encrypt and save
            </Button>
          </div>
          {job ? (
            <JobProgress jobId={job} type="router.ingest_credentials">
              {(r) => <p className="text-sm">{r.stored ? 'Stored. Run “Test connection” to confirm they work.' : 'A newer submission replaced this one.'}</p>}
            </JobProgress>
          ) : null}
        </form>
      </SheetContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------
export function RouterDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const router = useRouter(id);
  const settings = useSettings();
  const del = useDeleteRouter();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  const [editOpen, setEditOpen] = useState(false);
  const [credOpen, setCredOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const poll = settingValue('health_poll_interval_seconds', settings.data ?? []);

  if (router.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (router.isError) {
    return (
      <>
        <Button asChild variant="ghost" size="sm" className="mb-3"><Link to="/routers"><ArrowLeft /> Routers</Link></Button>
        <ErrorState error={router.error} onRetry={() => void router.refetch()} />
      </>
    );
  }
  const r = router.data;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/routers"><ArrowLeft /> Routers</Link>
      </Button>
      <PageHeader
        title={r.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} />
            {r.is_demo ? <DemoBadge /> : null}
            <span>{r.identity ?? 'identity not discovered yet'}</span>
            {r.location ? <span>· {r.location.name}</span> : null}
          </span>
        }
        actions={
          <>
            {!r.onboarding_completed_at && can.editRouters ? (
              <Button asChild>
                <Link to={`/routers/${r.id}/onboard`}><Wand2 /> Resume onboarding</Link>
              </Button>
            ) : null}
            {can.editRouters ? <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button> : null}
            {can.editRouters && !r.is_demo ? <Button variant="outline" onClick={() => setCredOpen(true)}><KeyRound /> Replace credentials</Button> : null}
            {can.deleteRouters ? <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 /> Delete</Button> : null}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="interfaces">Interfaces</TabsTrigger>
          <TabsTrigger value="hotspot">Hotspot discovery</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab router={r} poll={poll} /></TabsContent>
        <TabsContent value="system"><SystemTab router={r} /></TabsContent>
        <TabsContent value="interfaces"><InterfacesTab router={r} /></TabsContent>
        <TabsContent value="hotspot"><HotspotTab router={r} /></TabsContent>
        <TabsContent value="logs"><LogsTab router={r} /></TabsContent>
        <TabsContent value="audit">
          <Card><AuditTable filters={{ entityId: r.id }} /></Card>
        </TabsContent>
      </Tabs>

      {can.editRouters ? <EditSheet router={r} open={editOpen} onOpenChange={setEditOpen} /> : null}
      {can.editRouters && !r.is_demo ? <CredentialsSheet router={r} open={credOpen} onOpenChange={setCredOpen} /> : null}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${r.name}?`}
        description={
          <>
            <p>This removes the router, its stored credentials, health history and discovered data from Hotzonex Cloud. Nothing on the router itself is changed.</p>
            <p className="mt-2">To fully disconnect it, also remove the <span className="font-mono">hotzonex-wg</span> interface and <span className="font-mono">hotzonex-api</span> user on the router.</p>
          </>
        }
        confirmLabel="Delete router"
        pending={del.isPending}
        onConfirm={() =>
          del.mutate(r.id, {
            onSuccess: () => {
              toast.success(`${r.name} deleted`);
              navigate('/routers', { replace: true });
            },
            onError: (e) => toast.error(userMessage(e)),
          })
        }
      />
    </>
  );
}
