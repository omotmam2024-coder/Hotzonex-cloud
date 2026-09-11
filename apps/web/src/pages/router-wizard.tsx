import { ArrowLeft, ArrowRight, Check, KeyRound, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  DEFAULT_API_USERNAME,
  SetupScriptInputError,
  buildRouterSetupScript,
  generateApiPassword,
  parsePastedPublicKey,
} from '@hotzonex/mikrotik/setup-script';
import { formatBytes, formatDuration } from '@hotzonex/shared/time';
import { CopyButton } from '@/components/copy-button';
import { ConnectionResultView, PermissionsResultView, SyncResultView } from '@/components/job-results';
import { JobProgress } from '@/components/job-progress';
import { RouterForm } from '@/components/router-form';
import { EmptyState, ErrorState, InlineError, PageHeader } from '@/components/states';
import { DemoBadge } from '@/components/status';
import { RelativeTime } from '@/components/time';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Facts, Skeleton } from '@/components/ui/surface';
import { useAuth } from '@/lib/auth';
import { useEnqueueJob, useSubmitCredentials } from '@/lib/queries/jobs';
import { useAssignRouterLocation, useConnector, useLocations, type ConnectorView } from '@/lib/queries/misc';
import { useCreateRouter, useRouter, useRouterHotspot, useUpdateRouter, type RouterWithLocation } from '@/lib/queries/routers';
import { cn, randomBytes } from '@/lib/utils';
import { WIZARD_STEPS, resumeStep, stepIndex, type WizardStep } from '@/lib/wizard';

function Stepper({ current, reached, onSelect }: { current: WizardStep; reached: number; onSelect: (s: WizardStep) => void }) {
  const idx = stepIndex(current);
  return (
    <nav aria-label="Onboarding progress" className="mb-4">
      <p className="text-sm text-muted-foreground sm:hidden">
        Step {idx + 1} of {WIZARD_STEPS.length}: <span className="font-medium text-foreground">{WIZARD_STEPS[idx]?.label}</span>
      </p>
      <ol className="hidden gap-1 sm:flex">
        {WIZARD_STEPS.map((s, i) => {
          const done = i < idx;
          const enabled = i <= reached && i !== idx && s.key !== 'details';
          return (
            <li key={s.key} className="flex-1">
              <button
                type="button"
                disabled={!enabled}
                onClick={() => onSelect(s.key)}
                aria-current={i === idx ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 border-t-2 pt-2 text-left text-xs',
                  i === idx ? 'border-primary font-medium text-foreground' : done ? 'border-primary/40 text-muted-foreground' : 'border-border text-muted-foreground',
                  enabled && 'cursor-pointer hover:text-foreground',
                )}
              >
                <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]', done && 'border-primary bg-primary text-primary-foreground')}>
                  {done ? <Check className="size-3" /> : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// -----------------------------------------------------------------------------
// Step 2: connect — WireGuard + restricted API user script
// -----------------------------------------------------------------------------
function ConnectStep({ router, connector, onNext }: { router: RouterWithLocation; connector: ConnectorView | undefined; onNext: () => void }) {
  const submit = useSubmitCredentials(router.id);
  const update = useUpdateRouter(router.id);
  // The generated password lives only in this component's memory. It is never persisted.
  const [password, setPassword] = useState<string | null>(null);
  const [credJob, setCredJob] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const started = useRef(false);

  const issueCredentials = () => {
    const pw = generateApiPassword((n) => randomBytes(n));
    setPassword(pw);
    setCredJob(null);
    submit.mutate(
      { sealingKey: connector?.sealingKey ?? null, username: DEFAULT_API_USERNAME, password: pw },
      { onSuccess: (job) => setCredJob(job.id) },
    );
  };

  useEffect(() => {
    if (started.current || !connector?.sealingKey) return;
    started.current = true;
    issueCredentials();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- issue exactly once per visit
  }, [connector?.sealingKey]);

  const wg = connector?.wg ?? null;
  const script = useMemo(() => {
    if (!password || !wg) return { text: null, error: null as string | null };
    try {
      return {
        text: buildRouterSetupScript({
          routerName: router.name,
          generatedAt: new Date(),
          tunnel: {
            routerAddress: router.wg_address,
            serverAddress: wg.serverAddress,
            serverPublicKey: wg.serverPublicKey,
            endpointHost: wg.endpointHost,
            endpointPort: wg.endpointPort,
          },
          api: { protocol: router.api_protocol, port: router.api_port, useSsl: router.use_ssl, username: DEFAULT_API_USERNAME, password },
        }),
        error: null,
      };
    } catch (e) {
      return { text: null, error: e instanceof SetupScriptInputError ? e.message : 'The script could not be generated.' };
    }
  }, [password, wg, router.name, router.wg_address, router.api_protocol, router.api_port, router.use_ssl]);

  const saveKey = (key: string) => {
    setPasteError(null);
    update.mutate({ wg_public_key: key }, { onError: () => setPasteError('This key could not be saved. It may already belong to another router.') });
  };

  const onPaste = () => {
    const key = parsePastedPublicKey(pasted);
    if (!key) {
      setPasteError('That text does not contain a WireGuard public key. Paste the line that starts with HOTZONEX-WG-PUBLIC-KEY=.');
      return;
    }
    saveKey(key);
  };

  if (!connector?.row) {
    return (
      <ErrorState
        human={{
          title: 'The Hotzonex connector has never reported in',
          explanation: 'Credentials are encrypted to a key the connector publishes, and the router script needs its WireGuard details. Neither exists until the connector runs.',
          nextAction: 'Start the connector (see docs/RUNBOOK.md), then reload this page.',
        }}
      />
    );
  }

  const credsStored = router.credentials_status === 'set';
  const tunnelReady = Boolean(router.wg_public_key);
  const mockWithoutTunnel = connector.mock && !connector.wg;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>1. Run this script on the router</CardTitle>
            <CardDescription>
              Open WinBox → New Terminal (or SSH) on the router, paste the whole script, and press Enter. It is safe to run again.
            </CardDescription>
          </div>
          {script.text ? <CopyButton text={script.text} label="Copy script" /> : null}
        </CardHeader>
        <CardContent className="grid gap-3">
          <ul className="grid gap-1 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-good" aria-hidden />
              <span>The router dials out to Hotzonex over WireGuard. No port is opened on your Starlink connection and the API is never exposed to the internet.</span>
            </li>
            <li className="flex gap-2">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                Creates a restricted API user <span className="font-mono">{DEFAULT_API_USERNAME}</span> (read, write, api, test only — no admin rights), allowed to log in only through the tunnel.
              </span>
            </li>
          </ul>

          {mockWithoutTunnel ? (
            <div className="rounded-md bg-accent p-3 text-sm text-accent-foreground">
              <p className="font-medium">Mock mode — no real router script</p>
              <p className="mt-1">
                The connector is simulating routers and has no WireGuard endpoint, so there is nothing a real router could connect to. Credentials were still generated,
                sealed and stored exactly as in production. Use a simulated tunnel key to continue.
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                loading={update.isPending}
                onClick={() => {
                  // A syntactically valid, random WireGuard public key for the simulated tunnel.
                  const b = randomBytes(32);
                  saveKey(btoa(String.fromCharCode(...b)));
                }}
              >
                Use a simulated tunnel key
              </Button>
            </div>
          ) : script.error ? (
            <ErrorState human={{ title: 'Script could not be generated', explanation: script.error, nextAction: 'Check the connector’s WG_SERVER_PUBLIC_KEY and WG_ENDPOINT settings.' }} />
          ) : script.text ? (
            <>
              <p className="flex items-start gap-2 rounded-md bg-status-warning-bg px-3 py-2 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning" aria-hidden />
                This script contains the router’s new API password. It is shown only now and is not stored in this browser. If you lose it, generate a new one.
              </p>
              <pre className="max-h-80 overflow-auto rounded-md border bg-muted p-3 font-mono text-[11px] leading-relaxed" tabIndex={0} aria-label="RouterOS setup script">
                {script.text}
              </pre>
            </>
          ) : (
            <Skeleton className="h-40" />
          )}

          <div className="flex flex-wrap items-center gap-3 text-sm">
            {submit.isError ? <InlineError error={submit.error} /> : null}
            {credJob ? (
              <JobProgress jobId={credJob} type="router.ingest_credentials">
                {() => <span className="text-sm text-muted-foreground">Credentials encrypted and stored by the connector.</span>}
              </JobProgress>
            ) : null}
            <Button variant="ghost" size="sm" onClick={issueCredentials} disabled={submit.isPending || !connector.sealingKey}>
              <RefreshCw /> Generate a new password
            </Button>
          </div>
        </CardContent>
      </Card>

      {!mockWithoutTunnel ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>2. Paste the line the router printed</CardTitle>
              <CardDescription>The last line of output looks like HOTZONEX-WG-PUBLIC-KEY=…  It is the router’s public key; its private key never leaves the router.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Router output" htmlFor="wg-paste" error={pasteError ?? undefined}>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="wg-paste" className="font-mono" placeholder="HOTZONEX-WG-PUBLIC-KEY=…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
                <Button onClick={onPaste} loading={update.isPending} disabled={!pasted.trim()}>
                  Save key
                </Button>
              </div>
            </Field>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="grid gap-2 text-sm">
          <p className="font-medium">Tunnel</p>
          {!tunnelReady ? (
            <p className="text-muted-foreground">Waiting for the router’s public key.</p>
          ) : router.wg_last_handshake_at ? (
            <p className="flex items-center gap-2">
              <Check className="size-4 text-status-good" aria-hidden /> Tunnel is up — last handshake <RelativeTime value={router.wg_last_handshake_at} />.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Key saved. Waiting for the router’s first WireGuard handshake (the connector checks every 15 seconds). If nothing happens within a minute,
              check that the router has internet access.
            </p>
          )}
          <p className="text-muted-foreground">
            Tunnel address <span className="font-mono">{router.wg_address}</span> · Credentials: {credsStored ? 'stored' : router.credentials_status === 'pending' ? 'being stored…' : 'not stored yet'}
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!tunnelReady || router.credentials_status === 'not_set' || router.credentials_status === 'rejected'}>
          Continue <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Steps 3 & 4: test + discover
// -----------------------------------------------------------------------------
function TestStep({ router, onNext }: { router: RouterWithLocation; onNext: () => void }) {
  const enqueue = useEnqueueJob(router.id);
  const [testJob, setTestJob] = useState<string | null>(null);
  const [permJob, setPermJob] = useState<string | null>(null);
  const [passed, setPassed] = useState(false);
  const markPassed = useCallback(() => setPassed(true), []);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Test the connection</CardTitle>
          <CardDescription>The connector reaches the router through its tunnel, logs in with the stored credentials, and reads its identity.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Button loading={enqueue.isPending && enqueue.variables?.type === 'router.test_connection'} onClick={() => enqueue.mutate({ type: 'router.test_connection' }, { onSuccess: (j) => { setTestJob(j.id); setPassed(false); } })}>
            {testJob ? 'Test again' : 'Test connection'}
          </Button>
          <Button variant="outline" loading={enqueue.isPending && enqueue.variables?.type === 'router.test_permissions'} onClick={() => enqueue.mutate({ type: 'router.test_permissions' }, { onSuccess: (j) => setPermJob(j.id) })}>
            Test permissions
          </Button>
        </div>
        <InlineError error={enqueue.error} />
        {testJob ? (
          <JobProgress key={testJob} jobId={testJob} type="router.test_connection" onSucceeded={markPassed}>
            {(r) => <ConnectionResultView r={r} />}
          </JobProgress>
        ) : null}
        {permJob ? (
          <JobProgress key={permJob} jobId={permJob} type="router.test_permissions">
            {(r) => <PermissionsResultView r={r} />}
          </JobProgress>
        ) : null}
        <div className="flex justify-end">
          <Button onClick={onNext} disabled={!passed && !router.last_seen_at}>
            Continue <ArrowRight />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DiscoverStep({ router, onNext }: { router: RouterWithLocation; onNext: () => void }) {
  const enqueue = useEnqueueJob(router.id);
  const [job, setJob] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Discover the router</CardTitle>
          <CardDescription>Reads identity, version, resources, interfaces, hotspot servers and hotspot profiles. Read-only: nothing on the router changes.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div>
          <Button loading={enqueue.isPending} onClick={() => enqueue.mutate({ type: 'router.sync' }, { onSuccess: (j) => setJob(j.id) })}>
            {job || router.discovered_at ? 'Discover again' : 'Discover now'}
          </Button>
        </div>
        <InlineError error={enqueue.error} />
        {job ? (
          <JobProgress key={job} jobId={job} type="router.sync">
            {(r) => <SyncResultView r={r} />}
          </JobProgress>
        ) : null}
        {router.discovered_at ? (
          <Facts
            items={[
              { label: 'Identity', value: router.identity ?? '—' },
              { label: 'Board', value: router.board_name ?? '—' },
              { label: 'Architecture', value: router.architecture ?? '—' },
              { label: 'RouterOS', value: router.routeros_version ?? '—' },
              { label: 'CPU', value: router.cpu_load === null ? '—' : `${router.cpu_load}%` },
              {
                label: 'Memory',
                value:
                  router.total_memory && router.free_memory !== null
                    ? `${formatBytes(router.total_memory - router.free_memory)} of ${formatBytes(router.total_memory)}`
                    : '—',
              },
              { label: 'Uptime', value: formatDuration(router.uptime_seconds) },
            ]}
          />
        ) : null}
        <div className="flex justify-end">
          <Button onClick={onNext} disabled={!router.discovered_at}>
            Continue <ArrowRight />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Step 5: hotspot selection
// -----------------------------------------------------------------------------
function HotspotStep({ router, onNext }: { router: RouterWithLocation; onNext: () => void }) {
  const hotspot = useRouterHotspot(router.id);
  const update = useUpdateRouter(router.id);
  const [server, setServer] = useState<string | null>(router.hotspot_server_id);
  const [profile, setProfile] = useState<string | null>(router.default_hotspot_profile_id);
  const servers = (hotspot.data?.servers ?? []).filter((s) => !s.removed_at);
  const profiles = (hotspot.data?.profiles ?? []).filter((p) => !p.removed_at);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Choose the hotspot server and default profile</CardTitle>
          <CardDescription>Hotzonex will manage users on this hotspot server in a later release. Choosing it now changes nothing on the router.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        {hotspot.isPending ? (
          <Skeleton className="h-24" />
        ) : hotspot.isError ? (
          <ErrorState error={hotspot.error} onRetry={() => void hotspot.refetch()} />
        ) : servers.length === 0 ? (
          <EmptyState
            title="No hotspot server found on this router"
            description="Set one up on the router (IP → Hotspot → Hotspot Setup), then run discovery again. You can also skip this and choose later from the router page."
          />
        ) : (
          <>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Hotspot server</legend>
              {servers.map((s) => (
                <label key={s.id} className={cn('flex cursor-pointer items-start gap-3 rounded-md border p-3', server === s.id && 'border-primary bg-accent/50')}>
                  <input type="radio" name="server" className="mt-1 accent-[var(--primary)]" checked={server === s.id} onChange={() => setServer(s.id)} />
                  <span className="text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      interface {s.interface ?? '—'} · pool {s.address_pool ?? '—'}
                      {s.disabled ? ' · disabled on router' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Default user profile</legend>
              {profiles.map((p) => (
                <label key={p.id} className={cn('flex cursor-pointer items-start gap-3 rounded-md border p-3', profile === p.id && 'border-primary bg-accent/50')}>
                  <input type="radio" name="profile" className="mt-1 accent-[var(--primary)]" checked={profile === p.id} onChange={() => setProfile(p.id)} />
                  <span className="text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      rate limit {p.rate_limit ?? 'none'} · shared users {p.shared_users ?? 'unlimited'} · session {p.session_timeout_seconds ? formatDuration(p.session_timeout_seconds) : 'no limit'}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        <InlineError error={update.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onNext}>
            Skip for now
          </Button>
          <Button
            disabled={!server}
            loading={update.isPending}
            onClick={() => update.mutate({ hotspot_server_id: server, default_hotspot_profile_id: profile }, { onSuccess: onNext })}
          >
            Save and continue <ArrowRight />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Step 6 & 7: location, finish
// -----------------------------------------------------------------------------
function LocationStep({ router, onNext }: { router: RouterWithLocation; onNext: () => void }) {
  const locations = useLocations();
  const assign = useAssignRouterLocation();
  const { can } = useAuth();
  const [value, setValue] = useState(router.location_id ?? '');
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Assign a location</CardTitle>
          <CardDescription>Which site is this router at?</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {locations.isError ? <ErrorState error={locations.error} onRetry={() => void locations.refetch()} /> : null}
        <Field label="Location" htmlFor="loc" hint={can.manageLocations ? <>Missing a site? <Link className="underline" to="/locations" target="_blank" rel="noopener">Add a location</Link>, then come back.</> : 'Ask an admin to add missing locations.'}>
          <Select id="loc" value={value} onChange={(e) => setValue(e.target.value)} disabled={locations.isPending}>
            <option value="">Unassigned</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <InlineError error={assign.error} />
        <div className="flex justify-end">
          <Button loading={assign.isPending} onClick={() => assign.mutate({ routerId: router.id, locationId: value || null }, { onSuccess: onNext })}>
            Save and continue <ArrowRight />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FinishStep({ router }: { router: RouterWithLocation }) {
  const update = useUpdateRouter(router.id);
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Ready</CardTitle>
          <CardDescription>The connector will now check this router’s health every few minutes.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Facts
          items={[
            { label: 'Router', value: router.name },
            { label: 'Identity', value: router.identity ?? '—' },
            { label: 'RouterOS', value: router.routeros_version ?? '—' },
            { label: 'Location', value: router.location?.name ?? 'Unassigned' },
            { label: 'Tunnel address', value: router.wg_address, mono: true },
            { label: 'Credentials', value: router.credentials_status === 'set' ? 'Set (encrypted, never shown)' : 'Not set' },
          ]}
        />
        <InlineError error={update.error} />
        <div className="flex justify-end">
          <Button
            loading={update.isPending}
            onClick={() =>
              router.onboarding_completed_at
                ? navigate(`/routers/${router.id}`)
                : update.mutate({ onboarding_completed_at: new Date().toISOString() }, { onSuccess: () => navigate(`/routers/${router.id}`) })
            }
          >
            Finish <Check />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------
export function RouterWizardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, can } = useAuth();
  const router = useRouter(id);
  const connector = useConnector();
  const create = useCreateRouter();
  const [step, setStep] = useState<WizardStep | null>(id ? null : 'details');
  const [reached, setReached] = useState(0);

  // Resume where the router left off, once its data arrives (state adjusted during render, not in an effect).
  if (step === null && router.data) {
    const s = resumeStep(router.data);
    setStep(s);
    setReached(stepIndex(s));
  }

  const go = (s: WizardStep) => {
    setStep(s);
    setReached((r) => Math.max(r, stepIndex(s)));
    window.scrollTo({ top: 0 });
  };
  const next = (s: WizardStep) => () => go(s);

  if (!can.createRouters) {
    return <EmptyState title="You cannot add routers" description="Only admins and technicians can onboard routers." />;
  }

  return (
    <>
      <PageHeader
        title={router.data ? `Onboard ${router.data.name}` : 'Add a router'}
        description="Connect a MikroTik router to Hotzonex Cloud. You can leave and resume at any time."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link to={id ? `/routers/${id}` : '/routers'}>
              <ArrowLeft /> Back
            </Link>
          </Button>
        }
      />
      {router.data?.is_demo ? (
        <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <DemoBadge /> This is a demo router served by the mock provider.
        </p>
      ) : null}
      {step ? <Stepper current={step} reached={reached} onSelect={go} /> : null}

      {id && router.isPending ? <Skeleton className="h-64" /> : null}
      {id && router.isError ? <ErrorState error={router.error} onRetry={() => void router.refetch()} /> : null}

      {step === 'details' ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Router details</CardTitle>
              <CardDescription>Hotzonex assigns this router a private tunnel address; you will choose its location at the end.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <RouterForm
              showLocation={false}
              submitLabel="Create and continue"
              pending={create.isPending}
              error={create.error}
              onSubmit={(values) => {
                if (!profile) return;
                create.mutate(
                  { ...values, tenant_id: profile.tenant_id },
                  {
                    onSuccess: ({ id: newId }) => {
                      navigate(`/routers/${newId}/onboard`, { replace: true });
                      go('connect');
                    },
                  },
                );
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {router.data && step === 'connect' ? <ConnectStep router={router.data} connector={connector.data} onNext={next('test')} /> : null}
      {router.data && step === 'test' ? <TestStep router={router.data} onNext={next('discover')} /> : null}
      {router.data && step === 'discover' ? <DiscoverStep router={router.data} onNext={next('hotspot')} /> : null}
      {router.data && step === 'hotspot' ? <HotspotStep router={router.data} onNext={next('location')} /> : null}
      {router.data && step === 'location' ? <LocationStep router={router.data} onNext={next('finish')} /> : null}
      {router.data && step === 'finish' ? <FinishStep router={router.data} /> : null}
    </>
  );
}
