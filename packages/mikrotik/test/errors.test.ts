import { describe, expect, it } from 'vitest';
import {
  MIKROTIK_ERROR_CODES,
  MikrotikError,
  classifyRouterMessage,
  classifyTransportError,
  isConnectivityError,
  isMikrotikErrorCode,
  isRetryableError,
  type MikrotikErrorCode,
} from '../src/errors.js';

describe('MikrotikError code mapping — all eleven codes', () => {
  const transport: Array<[string, MikrotikErrorCode]> = [
    ['EHOSTUNREACH', 'UNREACHABLE'],
    ['ENETUNREACH', 'UNREACHABLE'],
    ['ENOTFOUND', 'UNREACHABLE'],
    ['ECONNRESET', 'UNREACHABLE'],
    ['ETIMEDOUT', 'TIMEOUT'],
    ['ECONNREFUSED', 'API_DISABLED'],
    ['EACCES', 'PORT_BLOCKED'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'TLS_ERROR'],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'TLS_ERROR'],
    ['ESOMETHINGELSE', 'UNKNOWN'],
  ];

  it.each(transport)('socket %s → %s', (errno, code) => {
    expect(classifyTransportError({ code: errno, message: 'x' }, 'connect').code).toBe(code);
  });

  const router: Array<[string, MikrotikErrorCode]> = [
    ['invalid user name or password (6)', 'AUTH_FAILED'],
    ['not enough permissions (9)', 'PERMISSION_DENIED'],
    ['no such item', 'NOT_FOUND'],
    ['failure: already have such name', 'ALREADY_EXISTS'],
    ['no such command prefix', 'INVALID_COMMAND'],
    ['unknown parameter', 'INVALID_COMMAND'],
    ['something odd happened', 'UNKNOWN'],
  ];

  it.each(router)('router message %j → %s', (message, code) => {
    expect(classifyRouterMessage(message, 'command')).toBe(code);
  });

  it('treats a reset during TLS negotiation as TLS_ERROR, not UNREACHABLE', () => {
    expect(classifyTransportError({ code: 'ECONNRESET', message: 'read ECONNRESET' }, 'tls').code).toBe('TLS_ERROR');
    expect(classifyTransportError({ code: 'ECONNREFUSED', message: 'x' }, 'tls').code).toBe('API_DISABLED');
  });

  it('treats any unrecognised trap during login as AUTH_FAILED', () => {
    expect(classifyRouterMessage('cannot log in', 'login')).toBe('AUTH_FAILED');
    expect(classifyRouterMessage('weird', 'login')).toBe('AUTH_FAILED');
  });

  it('covers exactly the closed set', () => {
    const produced = new Set<MikrotikErrorCode>([...transport.map(([, c]) => c), ...router.map(([, c]) => c)]);
    expect([...produced].sort()).toEqual([...MIKROTIK_ERROR_CODES].sort());
  });

  it('classifies retryability and connectivity', () => {
    expect(isConnectivityError('TIMEOUT')).toBe(true);
    expect(isConnectivityError('AUTH_FAILED')).toBe(false);
    expect(isRetryableError('API_DISABLED')).toBe(true);
    expect(isRetryableError('AUTH_FAILED')).toBe(false);
    expect(isRetryableError('PERMISSION_DENIED')).toBe(false);
    expect(isMikrotikErrorCode('TIMEOUT')).toBe(true);
    expect(isMikrotikErrorCode('BOOM')).toBe(false);
  });

  it('serialises without stack or credentials', () => {
    const e = new MikrotikError('AUTH_FAILED', 'login', 'invalid user name or password (6)');
    expect(JSON.parse(JSON.stringify(e))).toEqual({ code: 'AUTH_FAILED', stage: 'login', detail: 'invalid user name or password (6)' });
  });
});
