import { Check, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  DEFAULT_API_USERNAME,
  SetupScriptInputError,
  buildRouterSetupScript,
  generateApiPassword,
  parsePastedPublicKey,
} from '@hotzonex/mikrotik/setup-script';
import type { RouterConnectionInput } from '@hotzonex/shared/schemas';
import { formatBytes, formatDuration } from '@hotzonex/shared/time';
import { CopyButton } from '@/components/copy-button';
import { ConnectionResultView, PermissionsResultView, SyncResultView } from '@/components/job-results';
import { JobProgress } from '@/components/job-progress';
import { RouterConnectForm } from '@/components/router-connect-form';
import { RouterForm } from '@/components/router-form';
import { ConnectToInternet, FactoryLabel, PasteKeyBack, TerminalScript, TunnelCheck } from '@/components/router-illustrations';
import { EmptyState, ErrorState, InlineError } from '@/components/states';
import { DemoBadge } from '@/components/status';
import { RelativeTime } from '@/components/time';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Facts, Skeleton } from '@/components/ui/surface';
import { WizardAction, WizardFooter, WizardHeader, WizardNote, WizardScreen } from '@/components/wizard-ui';
import { useAuth } from '@/lib/auth';
import { useEnqueueJob, useSubmitCredentials } from '@/lib/queries/jobs';
import { useAssignRouterLocation, useConnector, useConnectors, useLocations, type ConnectorView } from '@/lib/queries/misc';
import {
  useConnectRouter,
  useCreateRouter,
  useReconnectRouter,
  useRouter,
  useRouterHotspot,
  useUpdateRouter,
  type RouterWithLocation,
} from '@/lib/queries/routers';
import { cn, randomBytes } from '@/lib/utils';
import { previousStep, resumeStep, routerMode, stepIndex, stepsFor, type WizardMode, type WizardStep } from '@/lib/wizard';

const DETAILS_FORM = 'router-details-form';
const CONNECT_FORM = 'router-connect-form';

// -----------------------------------------------------------------------------
// Connect — a router on this network, by address and login
// -----------------------------------------------------------------------------
function ConnectStep({
  router,
  connector,
  onConnected,
}: {
  router: RouterWithLocation | undefined;
  connector: ConnectorView | undefined;
  onConnected: (routerId: string) => void;
}) {
  const { profile } = useAuth();
  const connect = useConnectRouter();
  const reconnect = useReconnectRouter(router?.id ?? '');
  const connectors = useConnectors();

  // Each connector seals to its own key, so the password must be sealed to the
  // one that will open it — the one on the router's network.
  const choices = (connectors.data ?? []).filter((c) => c.row).map((c) => ({ id: c.row!.connector_id, online: c.online }));
  const keyFor = (connectorId: string | null) =>
    (connectorId ? connectors.data?.find((c) => c.row?.connector_id === connectorId) : undefined)?.sealingKey ?? connector?.sealingKey ?? null;

  if (connector?.row && !connector.sealingKey) {
    return (
      <ErrorState
        human={{
          title: 'The connector has not published an encryption key',
          explanation: 'The router’s password is encrypted in this browser to a key the connector publishes, so it cannot be sent until that key exists.',
          nextAction: 'Check that the connector is running, then reload this page.',
        }}
      />
    );
  }

  const submit = (values: RouterConnectionInput) => {
    const sealingKey = keyFor(values.connector_id);
    if (router) {
      reconnect.mutate({ input: values, sealingKey }, { onSuccess: () => onConnected(router.id) });
      return;
    }
    if (!profile) return;
    connect.mutate({ input: values, tenantId: profile.tenant_id, sealingKey }, { onSuccess: ({ routerId }) => onConnected(routerId) });
  };

  const active = router ? reconnect : connect;

  return (
    <>
      <WizardScreen
        title={router ? 'Sign in to this router again' : 'Add a router on this network'}
        caption={
          router
            ? 'Hotzonex has no working login for this router. Enter one that does and it will reconnect.'
            : 'Enter the router’s address and a login that already works on it.'
        }
      >
        <RouterConnectForm
          id={CONNECT_FORM}
          connectors={choices}
          defaults={
            router
              ? {
                  name: router.name,
                  host: router.host,
                  api_protocol: router.api_protocol,
                  api_port: router.api_port,
                  use_ssl: router.use_ssl,
                  connector_id: router.connector_id,
                }
              : undefined
          }
          lockName={Boolean(router)}
          onSubmit={submit}
          pending={active.isPending}
          error={active.error}
        />
        <WizardNote>
          Hotzonex reaches routers through the connector, so the connector has to be on this network too. For a site behind CGNAT that nothing can dial into,{' '}
          <Link className="underline" to="/routers/new?mode=tunnel">
            set it up over a tunnel
          </Link>{' '}
          instead.
        </WizardNote>
      </WizardScreen>
      <WizardFooter>
        <WizardAction type="submit" form={CONNECT_FORM} loading={active.isPending}>
          Connect
        </WizardAction>
      </WizardFooter>
    </>
  );
}

// -----------------------------------------------------------------------------
// Remote access — the offer, made once the local connection works
// -----------------------------------------------------------------------------
function RemoteStep({ router, onNext }: { router: RouterWithLocation; onNext: () => void }) {
  const enqueue = useEnqueueJob(router.id);
  const [jobId, setJobId] = useState<string | null>(null);
  const done = Boolean(router.wg_public_key);

  return (
    <>
      <WizardScreen
        title="Reach this router from anywhere?"
        illustration={<TunnelCheck />}
        caption={
          <>
            Right now {router.name} can only be managed from this network. Hotzonex can set up a private tunnel so it stays reachable after you leave the
            site — it dials out, so nothing is exposed to the internet.
          </>
        }
      >
        <div className="rounded-lg border bg-card p-3 text-sm">
          <p className="font-medium">What happens if you say yes</p>
          <ul className="mt-2 grid gap-1.5 text-muted-foreground">
            <li>Hotzonex configures WireGuard on the router over the connection it already has — nothing to type on the router.</li>
            <li>
              The router keeps its own private key and takes the tunnel address{' '}
              <span className="font-mono text-foreground">{router.wg_address}</span>, reserved for it since it was added.
            </li>
            <li>It is managed over the tunnel from then on, so it keeps working when its local address changes.</li>
          </ul>
        </div>

        <InlineError error={enqueue.error} />
        {jobId ? (
          <JobProgress key={jobId} jobId={jobId} type="router.enable_remote">
            {(r) => (
              <p className="text-sm">
                Remote access is on. This router now answers at <span className="font-mono">{r.address}</span>.
              </p>
            )}
          </JobProgress>
        ) : null}
      </WizardScreen>

      <WizardFooter
        secondary={
          <Button variant="ghost" size="sm" onClick={onNext}>
            {done ? 'Continue' : 'Not now — keep it local'}
          </Button>
        }
      >
        {done ? (
          <WizardAction onClick={onNext}>Continue</WizardAction>
        ) : (
          <WizardAction
            loading={enqueue.isPending}
            onClick={() => enqueue.mutate({ type: 'router.enable_remote' }, { onSuccess: (j) => setJobId(j.id) })}
          >
            Yes, set up remote access
          </WizardAction>
        )}
      </WizardFooter>
    </>
  );
}

// -----------------------------------------------------------------------------
// Steps that only explain what to do with the hardware
// -----------------------------------------------------------------------------
function PrepareStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <WizardScreen
        title="Connect your router to the internet"
        illustration={<ConnectToInternet />}
        caption={
          <>
            Use the internet cable to connect your provider’s router to the MikroTik on the first port, <strong className="text-foreground">ether 1</strong>.
          </>
        }
      >
        <WizardNote>Make sure you hear a click when the plug goes in. Then power the MikroTik on and give it a minute to start.</WizardNote>
      </WizardScreen>
      <WizardFooter>
        <WizardAction onClick={onNext}>Next</WizardAction>
      </WizardFooter>
    </>
  );
}

function CredentialsStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <WizardScreen
        title="Get your router’s username and password"
        illustration={<FactoryLabel />}
        caption="They are printed on the sticker underneath the router. You need them to open WinBox on the next screen."
      >
        <WizardNote tone="warning">
          Keep this password to yourself. Hotzonex never asks for it and never stores it — the next step creates a separate, limited user instead.
        </WizardNote>
      </WizardScreen>
      <WizardFooter>
        <WizardAction onClick={onNext}>Next</WizardAction>
      </WizardFooter>
    </>
  );
}

// -----------------------------------------------------------------------------
// Script — issues credentials and shows the RouterOS script to paste
// -----------------------------------------------------------------------------
function ScriptStep({ router, connector, onNext }: { router: RouterWithLocation; connector: ConnectorView | undefined; onNext: () => void }) {
  const submit = useSubmitCredentials(router.id);
  // The generated password lives only in this component's memory. It is never persisted.
  const [password, setPassword] = useState<string | null>(null);
  const [credJob, setCredJob] = useState<string | null>(null);
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

  const mockWithoutTunnel = connector.mock && !connector.wg;

  return (
    <>
      <WizardScreen
        title="Run this script on the router"
        illustration={<TerminalScript />}
        caption="In WinBox open New Terminal, paste the whole script, and press Enter. Running it twice is safe."
      >
        {mockWithoutTunnel ? (
          <WizardNote>
            <p className="font-medium">Mock mode — no real router script</p>
            <p className="mt-1 text-muted-foreground">
              The connector is simulating routers and has no WireGuard endpoint, so there is nothing a real router could connect to. Credentials were still
              generated, sealed and stored exactly as in production.
            </p>
          </WizardNote>
        ) : script.error ? (
          <ErrorState human={{ title: 'Script could not be generated', explanation: script.error, nextAction: 'Check the connector’s WG_SERVER_PUBLIC_KEY and WG_ENDPOINT settings.' }} />
        ) : script.text ? (
          <>
            <div className="flex justify-end">
              <CopyButton text={script.text} label="Copy script" />
            </div>
            <pre className="max-h-72 overflow-auto rounded-lg border bg-muted p-3 font-mono text-[11px] leading-relaxed" tabIndex={0} aria-label="RouterOS setup script">
              {script.text}
            </pre>
            <WizardNote tone="warning">
              This script contains the router’s new API password. It is shown only now and is not stored in this browser. If you lose it, generate a new one.
            </WizardNote>
          </>
        ) : (
          <Skeleton className="h-40" />
        )}

        <p className="flex gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-status-good" aria-hidden />
          <span>
            The router dials out to Hotzonex — no port is opened on your connection — and the script creates a restricted user{' '}
            <span className="font-mono">{DEFAULT_API_USERNAME}</span> with no admin rights.
          </span>
        </p>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          {submit.isError ? <InlineError error={submit.error} /> : null}
          {credJob ? (
            <JobProgress jobId={credJob} type="router.ingest_credentials">
              {() => <span className="text-sm text-muted-foreground">Credentials encrypted and stored by the connector.</span>}
            </JobProgress>
          ) : null}
        </div>
      </WizardScreen>

      <WizardFooter
        secondary={
          <Button variant="ghost" size="sm" onClick={issueCredentials} disabled={submit.isPending || !connector.sealingKey}>
            <RefreshCw /> Generate a new password
          </Button>
        }
      >
        <WizardAction onClick={onNext}>I have run the script</WizardAction>
      </WizardFooter>
    </>
  );
}

// -----------------------------------------------------------------------------
// Key — the line the router printed comes back into Hotzonex
// -----------------------------------------------------------------------------
function KeyStep({ router, connector, onNext }: { router: RouterWithLocation; connector: ConnectorView | undefined; onNext: () => void }) {
  const update = useUpdateRouter(router.id);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const tunnelReady = Boolean(router.wg_public_key);
  const mockWithoutTunnel = Boolean(connector?.mock && !connector.wg);

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

  return (
    <>
      <WizardScreen
        title="Paste the line the router printed"
        illustration={<PasteKeyBack />}
        caption="The last line of the output starts with HOTZONEX-WG-PUBLIC-KEY=. Copy that whole line and paste it here."
      >
        {mockWithoutTunnel ? (
          <WizardNote>
            <p>No real router printed anything in mock mode. Use a simulated key to carry on.</p>
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
          </WizardNote>
        ) : (
          <Field label="Router output" htmlFor="wg-paste" error={pasteError ?? undefined}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="wg-paste" className="font-mono" placeholder="HOTZONEX-WG-PUBLIC-KEY=…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
              <Button onClick={onPaste} loading={update.isPending} disabled={!pasted.trim()}>
                Save key
              </Button>
            </div>
          </Field>
        )}

        <div className="rounded-lg border bg-card p-3 text-sm">
          <p className="font-medium">Tunnel</p>
          {!tunnelReady ? (
            <p className="mt-1 text-muted-foreground">Waiting for the router’s public key. Its private key never leaves the router.</p>
          ) : router.wg_last_handshake_at ? (
            <p className="mt-1 flex items-center gap-2">
              <Check className="size-4 text-status-good" aria-hidden /> Tunnel is up — last handshake <RelativeTime value={router.wg_last_handshake_at} />.
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">
              Key saved. Waiting for the router’s first handshake (checked every 15 seconds). If nothing happens within a minute, check that the router has
              internet access.
            </p>
          )}
          <p className="mt-1 text-muted-foreground">
            Tunnel address <span className="font-mono">{router.wg_address}</span> ·{' '}
            {router.credentials_status === 'set' ? 'Credentials stored' : router.credentials_status === 'pending' ? 'Storing credentials…' : 'Credentials not stored'}
          </p>
        </div>
      </WizardScreen>

      <WizardFooter>
        <WizardAction onClick={onNext} disabled={!tunnelReady || router.credentials_status === 'not_set' || router.credentials_status === 'rejected'}>
          Continue
        </WizardAction>
      </WizardFooter>
    </>
  );
}

// -----------------------------------------------------------------------------
// Test and discover
// -----------------------------------------------------------------------------
function TestStep({ router, onNext }: { router: RouterWithLocation; onNext: () => void }) {
  const enqueue = useEnqueueJob(router.id);
  const [testJob, setTestJob] = useState<string | null>(null);
  const [permJob, setPermJob] = useState<string | null>(null);
  const [passed, setPassed] = useState(false);
  const markPassed = useCallback(() => setPassed(true), []);
  return (
    <>
      <WizardScreen
        title="Test the connection"
        illustration={<TunnelCheck />}
        caption="Hotzonex reaches the router through its tunnel, logs in with the stored credentials, and reads its identity."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            loading={enqueue.isPending && enqueue.variables?.type === 'router.test_connection'}
            onClick={() => enqueue.mutate({ type: 'router.test_connection' }, { onSuccess: (j) => { setTestJob(j.id); setPassed(false); } })}
          >
            {testJob ? 'Test again' : 'Test connection'}
          </Button>
          <Button
            variant="outline"
            loading={enqueue.isPending && enqueue.variables?.type === 'router.test_permissions'}
            onClick={() => enqueue.mutate({ type: 'router.test_permissions' }, { onSuccess: (j) => setPermJob(j.id) })}
          >
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
      </WizardScreen>
      <WizardFooter>
        <WizardAction onClick={onNext} disabled={!passed && !router.last_seen_at}>
          Continue
        </WizardAction>
      </WizardFooter>
    </>
  );
}

function DiscoverStep({ router, onNext }: { router: RouterWithLocation; onNext: () => void }) {
  const enqueue = useEnqueueJob(router.id);
  const [job, setJob] = useState<string | null>(null);
  return (
    <>
      <WizardScreen
        title="Discover the router"
        caption="Reads identity, version, resources, interfaces and hotspot settings. Read-only: nothing on the router changes."
      >
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
      </WizardScreen>
      <WizardFooter>
        <WizardAction onClick={onNext} disabled={!router.discovered_at}>
          Continue
        </WizardAction>
      </WizardFooter>
    </>
  );
}

// -----------------------------------------------------------------------------
// Hotspot, location, finish
// -----------------------------------------------------------------------------
function HotspotStep({ router, onNext }: { router: RouterWithLocation; onNext: () => void }) {
  const hotspot = useRouterHotspot(router.id);
  const update = useUpdateRouter(router.id);
  const [server, setServer] = useState<string | null>(router.hotspot_server_id);
  const [profile, setProfile] = useState<string | null>(router.default_hotspot_profile_id);
  const servers = (hotspot.data?.servers ?? []).filter((s) => !s.removed_at);
  const profiles = (hotspot.data?.profiles ?? []).filter((p) => !p.removed_at);

  return (
    <>
      <WizardScreen
        title="Choose the hotspot server"
        caption="Hotzonex will manage users on this hotspot in a later release. Choosing it now changes nothing on the router."
      >
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
                <label key={s.id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3', server === s.id && 'border-primary bg-accent/50')}>
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
                <label key={p.id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3', profile === p.id && 'border-primary bg-accent/50')}>
                  <input type="radio" name="profile" className="mt-1 accent-[var(--primary)]" checked={profile === p.id} onChange={() => setProfile(p.id)} />
                  <span className="text-sm">
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      rate limit {p.rate_limit ?? 'none'} · shared users {p.shared_users ?? 'unlimited'} · session{' '}
                      {p.session_timeout_seconds ? formatDuration(p.session_timeout_seconds) : 'no limit'}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </>
        )}
        <InlineError error={update.error} />
      </WizardScreen>
      <WizardFooter
        secondary={
          <Button variant="ghost" size="sm" onClick={onNext}>
            Skip for now
          </Button>
        }
      >
        <WizardAction
          disabled={!server}
          loading={update.isPending}
          onClick={() => update.mutate({ hotspot_server_id: server, default_hotspot_profile_id: profile }, { onSuccess: onNext })}
        >
          Save and continue
        </WizardAction>
      </WizardFooter>
    </>
  );
}

function LocationStep({ router, onNext }: { router: RouterWithLocation; onNext: () => void }) {
  const locations = useLocations();
  const assign = useAssignRouterLocation();
  const { can } = useAuth();
  const [value, setValue] = useState(router.location_id ?? '');
  return (
    <>
      <WizardScreen title="Where is this router?" caption="Assign the site it serves, so it shows up under the right location.">
        {locations.isError ? <ErrorState error={locations.error} onRetry={() => void locations.refetch()} /> : null}
        <Field
          label="Location"
          htmlFor="loc"
          hint={
            can.manageLocations ? (
              <>
                Missing a site?{' '}
                <Link className="underline" to="/locations" target="_blank" rel="noopener">
                  Add a location
                </Link>
                , then come back.
              </>
            ) : (
              'Ask an admin to add missing locations.'
            )
          }
        >
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
      </WizardScreen>
      <WizardFooter>
        <WizardAction loading={assign.isPending} onClick={() => assign.mutate({ routerId: router.id, locationId: value || null }, { onSuccess: onNext })}>
          Save and continue
        </WizardAction>
      </WizardFooter>
    </>
  );
}

function FinishStep({ router }: { router: RouterWithLocation }) {
  const update = useUpdateRouter(router.id);
  const navigate = useNavigate();
  return (
    <>
      <WizardScreen
        title={`${router.name} is ready`}
        illustration={
          <div className="flex size-24 items-center justify-center rounded-full bg-status-good-bg">
            <Check className="size-12 text-status-good" aria-hidden />
          </div>
        }
        caption="Hotzonex will now check this router’s health every few minutes."
      >
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
      </WizardScreen>
      <WizardFooter>
        <WizardAction
          loading={update.isPending}
          onClick={() =>
            router.onboarding_completed_at
              ? navigate(`/routers/${router.id}`)
              : update.mutate({ onboarding_completed_at: new Date().toISOString() }, { onSuccess: () => navigate(`/routers/${router.id}`) })
          }
        >
          Finish
        </WizardAction>
      </WizardFooter>
    </>
  );
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------
export function RouterWizardPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { profile, can } = useAuth();
  const router = useRouter(id);
  const connector = useConnector();
  const create = useCreateRouter();
  // A new router starts on whichever path was asked for; an existing one is
  // read from its address — a router reached at its own tunnel address took the
  // script route.
  const requested: WizardMode = search.get('mode') === 'tunnel' ? 'tunnel' : 'lan';
  const mode: WizardMode = router.data ? routerMode(router.data) : requested;
  const [step, setStep] = useState<WizardStep | null>(id ? null : requested === 'tunnel' ? 'details' : 'connect');

  // Resume where the router left off, once its data arrives (state adjusted during render, not in an effect).
  if (step === null && router.data) setStep(resumeStep(router.data));

  const go = (s: WizardStep) => {
    setStep(s);
    window.scrollTo({ top: 0 });
  };
  const next = (s: WizardStep) => () => go(s);

  const onBack = () => {
    const prev = step ? previousStep(step, mode) : null;
    if (!prev) {
      navigate(id ? `/routers/${id}` : '/routers');
      return;
    }
    go(prev);
  };

  if (!can.createRouters) {
    return <EmptyState title="You cannot add routers" description="Only admins and technicians can onboard routers." />;
  }

  const current = step ?? (mode === 'tunnel' ? 'details' : 'connect');
  const data = router.data;

  return (
    <>
      <WizardHeader title={data ? data.name : 'New router'} step={stepIndex(current, mode)} total={stepsFor(mode).length} onBack={onBack} />

      {data?.is_demo ? (
        <p className="mx-auto mb-4 flex w-full max-w-xl items-center gap-2 text-sm text-muted-foreground">
          <DemoBadge /> This is a demo router served by the mock provider.
        </p>
      ) : null}

      {id && router.isPending ? <Skeleton className="h-64" /> : null}
      {id && router.isError ? <ErrorState error={router.error} onRetry={() => void router.refetch()} /> : null}

      {step === 'connect' && (!id || data) ? (
        <ConnectStep
          router={data}
          connector={connector.data}
          onConnected={(routerId) => {
            if (!id) navigate(`/routers/${routerId}/onboard`, { replace: true });
            go('test');
          }}
        />
      ) : null}

      {step === 'details' ? (
        <>
          <WizardScreen title="Name this router" caption="Use the name your team would say out loud — usually the site it serves.">
            <RouterForm
              id={DETAILS_FORM}
              hideSubmit
              advancedCollapsed
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
                      go('prepare');
                    },
                  },
                );
              }}
            />
          </WizardScreen>
          <WizardFooter>
            <WizardAction type="submit" form={DETAILS_FORM} loading={create.isPending}>
              Create and continue
            </WizardAction>
          </WizardFooter>
        </>
      ) : null}

      {step === 'prepare' ? <PrepareStep onNext={next('credentials')} /> : null}
      {step === 'credentials' ? <CredentialsStep onNext={next('script')} /> : null}
      {data && step === 'script' ? <ScriptStep router={data} connector={connector.data} onNext={next('key')} /> : null}
      {data && step === 'key' ? <KeyStep router={data} connector={connector.data} onNext={next('test')} /> : null}
      {data && step === 'test' ? <TestStep router={data} onNext={next(mode === 'lan' ? 'remote' : 'discover')} /> : null}
      {data && step === 'remote' ? <RemoteStep router={data} onNext={next('discover')} /> : null}
      {data && step === 'discover' ? <DiscoverStep router={data} onNext={next('hotspot')} /> : null}
      {data && step === 'hotspot' ? <HotspotStep router={data} onNext={next('location')} /> : null}
      {data && step === 'location' ? <LocationStep router={data} onNext={next('finish')} /> : null}
      {data && step === 'finish' ? <FinishStep router={data} /> : null}
    </>
  );
}
