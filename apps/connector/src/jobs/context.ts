import type { Keyring } from '../crypto/keyring.js';
import type { SealingKeys } from '../crypto/sealing-keys.js';
import type { Logger } from '../logger.js';
import type { RouterAccess } from '../routers/access.js';
import type { ConnectorRouter, ConnectorStore, JobRow } from '../store/store.js';

export interface JobContext {
  job: JobRow;
  /** Null only for job types that do not need a router row. */
  router: ConnectorRouter | null;
  store: ConnectorStore;
  access: RouterAccess;
  keyring: Keyring;
  sealing: SealingKeys;
  log: Logger;
  now: () => number;
}

/** A job-level failure that is not a router error (maps to JOB_ERROR_CODES). */
export class JobFailure extends Error {
  override readonly name = 'JobFailure';
  constructor(
    readonly code: 'NO_CREDENTIALS' | 'CREDENTIALS_UNREADABLE' | 'ROUTER_NOT_FOUND' | 'INTERNAL',
    message: string,
  ) {
    super(message);
  }
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;
