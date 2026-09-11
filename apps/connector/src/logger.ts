import pino, { type DestinationStream, type Logger } from 'pino';

export type { Logger };

/**
 * Structured JSON logs to stdout. Anything that could hold a secret is
 * redacted by path, and the code never passes connection params, envelopes or
 * credentials to the logger in the first place (a test asserts no secret ever
 * reaches the log stream).
 */
export const REDACT_PATHS = [
  'password',
  '*.password',
  '*.*.password',
  'password_ciphertext',
  '*.password_ciphertext',
  'ciphertext',
  '*.ciphertext',
  'sealed',
  '*.sealed',
  'envelope',
  '*.envelope',
  'authorization',
  '*.authorization',
  '*.headers.authorization',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ENCRYPTION_KEY',
  'ENCRYPTION_KEYS_RETIRED',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: 'hotzonex-connector' },
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}
