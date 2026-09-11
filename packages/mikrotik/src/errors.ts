/**
 * The closed set of MikroTik failure codes. Every provider method either
 * returns a typed result or throws a MikrotikError carrying one of these.
 * Browser-safe: no Node imports.
 */

export const MIKROTIK_ERROR_CODES = [
  'UNREACHABLE',
  'TIMEOUT',
  'AUTH_FAILED',
  'API_DISABLED',
  'PORT_BLOCKED',
  'TLS_ERROR',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'INVALID_COMMAND',
  'UNKNOWN',
] as const;

export type MikrotikErrorCode = (typeof MIKROTIK_ERROR_CODES)[number];

/** Where in the conversation with the router the failure happened. */
export type MikrotikErrorStage = 'connect' | 'tls' | 'login' | 'command';

export class MikrotikError extends Error {
  override readonly name = 'MikrotikError';
  readonly code: MikrotikErrorCode;
  readonly stage: MikrotikErrorStage;
  /** Short, router- or socket-provided detail. Never contains credentials. */
  readonly detail: string | null;

  constructor(code: MikrotikErrorCode, stage: MikrotikErrorStage, detail: string | null = null) {
    super(detail ? `${code} during ${stage}: ${detail}` : `${code} during ${stage}`);
    this.code = code;
    this.stage = stage;
    this.detail = detail;
  }

  toJSON(): { code: MikrotikErrorCode; stage: MikrotikErrorStage; detail: string | null } {
    return { code: this.code, stage: this.stage, detail: this.detail };
  }
}

export function isMikrotikError(value: unknown): value is MikrotikError {
  return value instanceof MikrotikError;
}

export function isMikrotikErrorCode(value: unknown): value is MikrotikErrorCode {
  return typeof value === 'string' && (MIKROTIK_ERROR_CODES as readonly string[]).includes(value);
}

/** The router could not be reached at all — treat as "offline". */
export function isConnectivityError(code: MikrotikErrorCode): boolean {
  return code === 'UNREACHABLE' || code === 'TIMEOUT';
}

/**
 * Failures that may clear up on their own (router booting, tunnel flapping).
 * Everything else needs a human to change configuration or credentials.
 */
export function isRetryableError(code: MikrotikErrorCode): boolean {
  return (
    code === 'UNREACHABLE' ||
    code === 'TIMEOUT' ||
    code === 'PORT_BLOCKED' ||
    code === 'API_DISABLED' ||
    code === 'UNKNOWN'
  );
}

/**
 * Map a RouterOS `!trap` / REST error message to a code. RouterOS messages
 * are stable English strings; unknown messages map to INVALID_COMMAND when
 * the router says the command itself was wrong, otherwise UNKNOWN.
 */
export function classifyRouterMessage(message: string, stage: MikrotikErrorStage): MikrotikErrorCode {
  const m = message.toLowerCase();
  if (
    m.includes('invalid user name or password') ||
    m.includes('cannot log in') ||
    m.includes('not logged in') ||
    m.includes('bad user name or password')
  ) {
    return 'AUTH_FAILED';
  }
  if (m.includes('not enough permissions') || m.includes('permission denied') || m.includes('no permission')) {
    return 'PERMISSION_DENIED';
  }
  if (m.includes('no such item') || m.includes('no such object') || m.includes('not found')) {
    return 'NOT_FOUND';
  }
  if (m.includes('already have') || m.includes('already exists')) {
    return 'ALREADY_EXISTS';
  }
  if (
    m.includes('no such command') ||
    m.includes('unknown parameter') ||
    m.includes('expected end of command') ||
    m.includes('syntax error') ||
    m.includes('invalid value') ||
    m.includes('bad command')
  ) {
    return 'INVALID_COMMAND';
  }
  if (stage === 'login') return 'AUTH_FAILED';
  return 'UNKNOWN';
}

/** Minimal shape of a Node socket/TLS error; kept structural so this file stays browser-safe. */
interface ErrnoLike {
  code?: unknown;
  message?: unknown;
}

const TLS_CODE_PATTERN = /^(ERR_SSL_|ERR_TLS_|CERT_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT|ERR_OSSL_)/;

/** Map a transport-level failure (socket, DNS, TLS) to a code. */
export function classifyTransportError(error: unknown, stage: MikrotikErrorStage): MikrotikError {
  if (isMikrotikError(error)) return error;
  const e = (error ?? {}) as ErrnoLike;
  const errno = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';

  if (TLS_CODE_PATTERN.test(errno) || /certificate|ssl|tls handshake/i.test(message)) {
    return new MikrotikError('TLS_ERROR', 'tls', errno || 'TLS negotiation failed');
  }
  switch (errno) {
    case 'ECONNREFUSED':
      // RouterOS answers with a TCP reset when the service is disabled or restricted to other addresses.
      return new MikrotikError('API_DISABLED', stage, 'connection refused');
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return new MikrotikError('TIMEOUT', stage, 'no response before timeout');
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EHOSTDOWN':
    case 'ENETDOWN':
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new MikrotikError('UNREACHABLE', stage, errno.toLowerCase());
    case 'EACCES':
    case 'EPERM':
      // Local or upstream firewall rejected the packet (ICMP administratively prohibited).
      return new MikrotikError('PORT_BLOCKED', stage, 'connection administratively prohibited');
    case 'ECONNRESET':
    case 'EPIPE':
      // TCP was accepted but the peer hung up mid-handshake: it does not speak TLS on this port.
      if (stage === 'tls') return new MikrotikError('TLS_ERROR', 'tls', 'connection closed during TLS negotiation');
      return new MikrotikError('UNREACHABLE', stage, 'connection reset');
    default:
      return new MikrotikError('UNKNOWN', stage, errno ? errno.toLowerCase() : 'unexpected transport failure');
  }
}
