import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { MOCK_FAILURE_PRESETS, type MockBehavior } from '@hotzonex/mikrotik';

/**
 * Development/demo control for mock routers. A JSON file maps a router id (or
 * tunnel address) to a simulated condition, so you can "power off" a mock
 * router and watch it go OFFLINE, or make it reject logins:
 *
 *   pnpm --filter @hotzonex/connector mock:router <router-id> offline
 *
 * Only consulted for routers served by MockMikrotikProvider (all routers when
 * MIKROTIK_PROVIDER=mock, and DEMO routers always).
 */
export const MOCK_CONDITIONS = ['online', 'offline', 'timeout', 'auth_failed', 'api_disabled', 'permission_denied', 'malformed'] as const;
export type MockCondition = (typeof MOCK_CONDITIONS)[number];

interface StateShape {
  routers: Record<string, MockCondition>;
}

export function behaviorFor(condition: MockCondition | undefined): MockBehavior {
  switch (condition) {
    case 'offline':
      return { connectFailure: MOCK_FAILURE_PRESETS.offline };
    case 'timeout':
      return { connectFailure: MOCK_FAILURE_PRESETS.timeout };
    case 'auth_failed':
      return { connectFailure: MOCK_FAILURE_PRESETS.authFailed };
    case 'api_disabled':
      return { connectFailure: MOCK_FAILURE_PRESETS.apiDisabled };
    case 'permission_denied':
      return {
        methodFailures: {
          getHotspotServers: MOCK_FAILURE_PRESETS.permissionDenied,
          getHotspotProfiles: MOCK_FAILURE_PRESETS.permissionDenied,
        },
      };
    case 'malformed':
      return { methodFailures: { getSystemResource: MOCK_FAILURE_PRESETS.malformed } };
    default:
      return {};
  }
}

export class MockStateFile {
  private cache: StateShape = { routers: {} };
  private mtimeMs = -1;

  constructor(private readonly path: string) {}

  private load(): StateShape {
    let mtime: number;
    try {
      mtime = statSync(this.path).mtimeMs;
    } catch {
      this.cache = { routers: {} };
      this.mtimeMs = -1;
      return this.cache;
    }
    if (mtime !== this.mtimeMs) {
      try {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<StateShape>;
        const routers: Record<string, MockCondition> = {};
        for (const [k, v] of Object.entries(parsed.routers ?? {})) {
          if ((MOCK_CONDITIONS as readonly string[]).includes(v)) routers[k] = v as MockCondition;
        }
        this.cache = { routers };
      } catch {
        this.cache = { routers: {} };
      }
      this.mtimeMs = mtime;
    }
    return this.cache;
  }

  condition(routerId: string, host: string): MockCondition | undefined {
    const s = this.load();
    return s.routers[routerId] ?? s.routers[host];
  }

  behavior(routerId: string, host: string): MockBehavior {
    return behaviorFor(this.condition(routerId, host));
  }

  set(key: string, condition: MockCondition): void {
    const s = this.load();
    const routers = { ...s.routers };
    if (condition === 'online') delete routers[key];
    else routers[key] = condition;
    writeFileSync(this.path, `${JSON.stringify({ routers }, null, 2)}\n`);
    this.mtimeMs = -1;
  }
}
