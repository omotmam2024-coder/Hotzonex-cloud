import { MikrotikError, isMikrotikError, isRemoteAccessWriter, type MikrotikProvider } from '@hotzonex/mikrotik';
import { FORBIDDEN_POLICIES, REQUIRED_POLICIES, buildRemoteAccessPlan } from '@hotzonex/mikrotik/setup-script';
import { fetchLogsPayloadSchema, ingestCredentialsPayloadSchema, type JobType } from '@hotzonex/shared/jobs';
import { SealError } from '@hotzonex/shared/sealing';
import { JobFailure, type JobContext, type JobHandler } from './context.js';
import type { ConnectorRouter } from '../store/store.js';

function requireRouter(ctx: JobContext): ConnectorRouter {
  if (!ctx.router) throw new JobFailure('ROUTER_NOT_FOUND', 'router no longer exists');
  return ctx.router;
}

const HANDSHAKE_FRESH_MS = 3 * 60_000;

/**
 * Make connectivity failures specific: a connect timeout while the WireGuard
 * handshake is fresh means the tunnel works and a firewall is dropping the API
 * port; no handshake at all means the tunnel never came up.
 */
function refineConnectError(error: unknown, router: ConnectorRouter, now: number): unknown {
  if (!isMikrotikError(error) || error.stage !== 'connect') return error;
  const handshake = router.wg_last_handshake_at ? Date.parse(router.wg_last_handshake_at) : null;
  const fresh = handshake !== null && now - handshake < HANDSHAKE_FRESH_MS;
  if (error.code === 'TIMEOUT' && fresh) {
    return new MikrotikError('PORT_BLOCKED', 'connect', 'the WireGuard tunnel is up but the API port does not answer');
  }
  if ((error.code === 'TIMEOUT' || error.code === 'UNREACHABLE') && handshake === null && !router.is_demo) {
    return new MikrotikError('UNREACHABLE', 'connect', 'the router has not completed a WireGuard handshake yet');
  }
  return error;
}

async function onRouter<T>(ctx: JobContext, fn: (p: MikrotikProvider) => Promise<T>): Promise<T> {
  const router = requireRouter(ctx);
  try {
    return await ctx.access.run(router, fn);
  } catch (error) {
    throw refineConnectError(error, router, ctx.now());
  }
}

const testConnection: JobHandler = async (ctx) => {
  const router = requireRouter(ctx);
  const { test, resource } = await onRouter(ctx, async (p) => ({
    test: await p.testConnection(),
    resource: await p.getSystemResource(),
  }));
  // A successful test is also a successful health sample: the router shows ONLINE immediately.
  await ctx.store.recordPoll({
    routerId: router.id,
    reachable: true,
    status: router.status === 'warning' || router.status === 'critical' ? router.status : 'online',
    metrics: {
      latency_ms: test.latencyMs,
      cpu_load: resource.cpuLoad,
      free_memory: resource.freeMemory,
      total_memory: resource.totalMemory,
      uptime_seconds: resource.uptimeSeconds,
      routeros_version: test.routerOsVersion,
      board_name: resource.boardName,
      architecture: resource.architecture,
    },
  });
  return {
    latencyMs: test.latencyMs,
    identity: test.identity,
    routerOsVersion: test.routerOsVersion,
    boardName: test.boardName,
    architecture: test.architecture,
    cpuLoad: resource.cpuLoad,
    freeMemory: resource.freeMemory,
    totalMemory: resource.totalMemory,
    uptimeSeconds: resource.uptimeSeconds,
  };
};

/**
 * Reports which operations the API user can actually perform. Reads are proven
 * by performing them; `write`, `api`/`rest-api` and `test` are verified from the
 * group's policy list — Hotzonex never changes router config just to test.
 */
const testPermissions: JobHandler = async (ctx) => {
  const router = requireRouter(ctx);
  return onRouter(ctx, async (p) => {
    const policies = await p.getCurrentUserPolicies();
    const probes: Array<[string, () => Promise<unknown>]> = [
      ['read system resources', () => p.getSystemResource()],
      ['read interfaces', () => p.getInterfaces()],
      ['read hotspot servers', () => p.getHotspotServers()],
      ['read hotspot profiles', () => p.getHotspotProfiles()],
      ['read logs', () => p.getLogs({ limit: 1 })],
    ];
    const checks: Array<{ operation: string; ok: boolean; errorCode: string | null }> = [];
    for (const [operation, probe] of probes) {
      try {
        await probe();
        checks.push({ operation, ok: true, errorCode: null });
      } catch (error) {
        if (!isMikrotikError(error) || error.stage !== 'command') throw error;
        checks.push({ operation, ok: false, errorCode: error.code });
      }
    }
    const required = [...REQUIRED_POLICIES[router.api_protocol]];
    for (const policy of required.filter((x) => x !== 'read')) {
      checks.push({ operation: `${policy} policy (checked in group, not exercised)`, ok: policies.policies.includes(policy), errorCode: null });
    }
    return {
      username: policies.username,
      group: policies.group,
      policies: policies.policies,
      required,
      missing: required.filter((x) => !policies.policies.includes(x)),
      excess: policies.policies.filter((x) => FORBIDDEN_POLICIES.includes(x)),
      checks,
    };
  });
};

/** Read-only discovery + non-destructive mirror. Never writes to the router. */
const sync: JobHandler = async (ctx) => {
  const router = requireRouter(ctx);
  const snap = await onRouter(ctx, async (p) => {
    const identity = await p.getIdentity();
    const resource = await p.getSystemResource();
    const version = await p.getRouterOsVersion();
    const interfaces = await p.getInterfaces();
    const servers = await p.getHotspotServers();
    const profiles = await p.getHotspotProfiles();
    return { identity, resource, version, interfaces, servers, profiles };
  });
  const summary = await ctx.store.applySync(router.id, {
    identity: snap.identity.name,
    routeros_version: snap.version.version,
    board_name: snap.resource.boardName,
    architecture: snap.resource.architecture,
    resource: {
      cpu_load: snap.resource.cpuLoad,
      free_memory: snap.resource.freeMemory,
      total_memory: snap.resource.totalMemory,
      uptime_seconds: snap.resource.uptimeSeconds,
    },
    interfaces: snap.interfaces.map((i) => ({
      mikrotik_id: i.id, name: i.name, type: i.type, mac: i.macAddress, running: i.running, disabled: i.disabled,
      rx_bytes: i.rxBytes, tx_bytes: i.txBytes, mtu: i.mtu, comment: i.comment,
    })),
    hotspot_servers: snap.servers.map((s) => ({
      mikrotik_id: s.id, name: s.name, interface: s.interface, address_pool: s.addressPool, profile: s.profile,
      disabled: s.disabled, invalid: s.invalid,
    })),
    hotspot_profiles: snap.profiles.map((h) => ({
      mikrotik_id: h.id, name: h.name, rate_limit: h.rateLimit, shared_users: h.sharedUsers,
      session_timeout_seconds: h.sessionTimeoutSeconds, idle_timeout_seconds: h.idleTimeoutSeconds,
      keepalive_timeout_seconds: h.keepaliveTimeoutSeconds, address_pool: h.addressPool, is_default: h.isDefault,
    })),
  });
  return {
    identity: snap.identity.name,
    routerOsVersion: snap.version.version,
    boardName: snap.resource.boardName,
    architecture: snap.resource.architecture,
    ...summary,
  };
};

const fetchLogs: JobHandler = async (ctx) => {
  const payload = fetchLogsPayloadSchema.parse(ctx.job.payload);
  const entries = await onRouter(ctx, (p) => p.getLogs({ limit: payload.limit }));
  return { entries };
};

/**
 * Unseal credentials submitted from the browser and store them encrypted at
 * rest. The plaintext exists only in this function's scope.
 */
const ingestCredentials: JobHandler = async (ctx) => {
  const { submission_id } = ingestCredentialsPayloadSchema.parse(ctx.job.payload);
  const submission = await ctx.store.takeSubmission(submission_id);
  if (!submission) return { stored: false, superseded: true, keyVersion: null };
  if (submission.superseded) {
    // A newer submission for this router is queued; storing it will consume this one.
    return { stored: false, superseded: true, keyVersion: null };
  }
  let plaintext: { username: string; password: string };
  try {
    plaintext = await ctx.sealing.open(submission.router_id, submission.sealed);
  } catch (error) {
    if (error instanceof SealError) {
      await ctx.store.rejectSubmission(submission_id, error.message);
      throw new JobFailure('CREDENTIALS_UNREADABLE', error.message);
    }
    throw error;
  }
  const { ciphertext, keyVersion } = ctx.keyring.encrypt(plaintext.password, submission.router_id);
  await ctx.store.storeCredentials(submission_id, plaintext.username, ciphertext, keyVersion);
  if (ctx.router) ctx.access.resetBreaker(ctx.router);
  return { stored: true, superseded: false, keyVersion };
};

/**
 * Configures the WireGuard tunnel on a router we can already reach, so a router
 * added on the local network becomes reachable from anywhere without anyone
 * pasting a script. The router generates its own private key and hands back
 * only the public half.
 *
 * The peer is the connector that publishes an endpoint, which is normally not
 * this one: a site connector sits on the LAN and has no endpoint of its own.
 */
const enableRemote: JobHandler = async (ctx) => {
  const router = requireRouter(ctx);
  const server = await ctx.store.tunnelServer();
  if (!server?.wg_endpoint || !server.wg_server_public_key || !server.wg_server_address) {
    throw new JobFailure('INTERNAL', 'No connector publishes a WireGuard endpoint, so the router has nothing to dial.');
  }
  const endpoint = /^(.+):(\d{1,5})$/.exec(server.wg_endpoint);
  if (!endpoint) throw new JobFailure('INTERNAL', `the tunnel endpoint "${server.wg_endpoint}" is not host:port`);
  if (!router.wg_address) throw new JobFailure('INTERNAL', 'the router has no tunnel address allocated');

  const steps = buildRemoteAccessPlan({
    tunnel: {
      routerAddress: router.wg_address,
      serverAddress: server.wg_server_address,
      serverPublicKey: server.wg_server_public_key,
      endpointHost: endpoint[1] as string,
      endpointPort: Number(endpoint[2]),
    },
    api: { protocol: router.api_protocol, port: router.api_port },
  });

  const { publicKey } = await onRouter(ctx, async (p) => {
    if (!isRemoteAccessWriter(p)) {
      throw new JobFailure('INTERNAL', 'this router is reached with a provider that cannot configure a tunnel');
    }
    return p.enableRemoteAccess(steps);
  });

  // From here the router answers on its tunnel address, and the connector that
  // serves the tunnel takes it over.
  const updated = await ctx.store.enableRemote(router.id, publicKey);
  ctx.log.info({ router_id: router.id, host: updated.host, connector_id: updated.connector_id }, 'remote access enabled');
  return { publicKey, address: updated.host, connectorId: updated.connector_id };
};

export const HANDLERS: Record<JobType, { handler: JobHandler; needsConnection: boolean }> = {
  'router.test_connection': { handler: testConnection, needsConnection: true },
  'router.test_permissions': { handler: testPermissions, needsConnection: true },
  'router.sync': { handler: sync, needsConnection: true },
  'router.fetch_logs': { handler: fetchLogs, needsConnection: true },
  'router.ingest_credentials': { handler: ingestCredentials, needsConnection: false },
  'router.enable_remote': { handler: enableRemote, needsConnection: true },
};
