import { RouterosApiProvider } from './api/provider.js';
import { MockMikrotikProvider, type MockOptions } from './mock/provider.js';
import type { MikrotikProvider } from './provider.js';
import { RouterosRestProvider } from './rest/provider.js';
import type { ConnectionParams } from './types.js';

/** Mirrors MIKROTIK_PROVIDER=mock|api|rest. */
export type ProviderKind = 'mock' | 'api' | 'rest';

/**
 * `kind` selects real vs mock. With a real kind, the router's own protocol
 * decides between binary API (api/api_ssl) and REST — a fleet can mix both.
 */
export function createProvider(kind: ProviderKind, params: ConnectionParams, mock?: MockOptions): MikrotikProvider {
  if (kind === 'mock') return new MockMikrotikProvider(params, mock);
  if (params.protocol === 'rest') return new RouterosRestProvider(params);
  return new RouterosApiProvider(params);
}
