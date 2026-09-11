import { hostname } from 'node:os';
import { z } from 'zod';

const WG_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

const base64Key = z
  .string()
  .trim()
  .refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(v);
    } catch {
      return false;
    }
  }, 'must be 32 random bytes, base64-encoded (generate with: openssl rand -base64 32)');

const schema = z
  .object({
    SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'is required'),
    ENCRYPTION_KEY: base64Key,
    ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1),
    /** Optional: older keys kept for decryption during rotation, "1:<base64>,2:<base64>". */
    ENCRYPTION_KEYS_RETIRED: z.string().trim().optional().default(''),
    MIKROTIK_PROVIDER: z.enum(['mock', 'api', 'rest']).default('mock'),
    HEALTH_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
    JOB_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(2).max(300).default(10),
    JOB_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    WG_INTERFACE: z.string().regex(/^[a-zA-Z0-9_.-]{1,15}$/, 'must be an interface name such as wg0').default('wg0'),
    WG_SERVER_PUBLIC_KEY: z.string().trim().regex(WG_KEY, 'must be a WireGuard public key').optional(),
    WG_ENDPOINT: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9.-]{1,253}:\d{1,5}$/, 'must be host:port, e.g. wg.hotzonex.com:51820')
      .optional(),
    CONNECTOR_ID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).default(hostname().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64) || 'connector'),
    HEALTHZ_HOST: z.string().default('0.0.0.0'),
    HEALTHZ_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    MOCK_STATE_FILE: z.string().default('.mock-state.json'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.MIKROTIK_PROVIDER !== 'mock') {
      if (!cfg.WG_SERVER_PUBLIC_KEY) ctx.addIssue({ code: 'custom', path: ['WG_SERVER_PUBLIC_KEY'], message: 'is required with a real MIKROTIK_PROVIDER' });
      if (!cfg.WG_ENDPOINT) ctx.addIssue({ code: 'custom', path: ['WG_ENDPOINT'], message: 'is required with a real MIKROTIK_PROVIDER' });
    }
  });

export type ConnectorConfig = z.infer<typeof schema>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Parse env; on failure, list every problem by variable name (never echoing values). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConnectorConfig {
  // `.env.example` ships optional keys as `NAME=`; an empty value means "not set", not "invalid".
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const result = schema.safeParse(present);
  if (!result.success) {
    const lines = result.error.issues.map((i) => {
      const name = i.path.join('.') || '(env)';
      const value = env[name];
      const missing = value === undefined || value === '';
      return `  ${name}: ${missing ? 'is required' : i.message}`;
    });
    throw new ConfigError(`Invalid connector configuration:\n${lines.join('\n')}\nSee apps/connector/.env.example.`);
  }
  return result.data;
}

export function parseRetiredKeys(spec: string): Array<{ version: number; key: string }> {
  if (!spec) return [];
  return spec.split(',').map((part) => {
    const [v, key] = part.split(':');
    const version = Number(v);
    if (!Number.isInteger(version) || version < 1 || !key || Buffer.from(key, 'base64').length !== 32) {
      throw new ConfigError('ENCRYPTION_KEYS_RETIRED must look like "1:<base64 32 bytes>,2:<base64 32 bytes>"');
    }
    return { version, key };
  });
}
