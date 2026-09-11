/**
 * Credential handling end to end, and proof that router passwords appear in
 * no API response, no log line, and no readable database column.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { as, rpc } from '@hotzonex/db/testing';
import { sealCredentials } from '@hotzonex/shared/sealing';
import { Keyring, KeyringError } from '../src/crypto/keyring.js';
import { rekeyAll } from '../src/crypto/rekey.js';
import { SealingKeys } from '../src/crypto/sealing-keys.js';
import { addRouter, createWorld, enqueue, job, router, runJobs, type World } from './world.js';

const key = (): string => randomBytes(32).toString('base64');

describe('Keyring (AES-256-GCM at rest)', () => {
  it('round-trips and never embeds the plaintext', () => {
    const k = Keyring.fromBase64({ version: 1, key: key() });
    const { ciphertext, keyVersion } = k.encrypt('S3cret-Password-123', 'router-1');
    expect(keyVersion).toBe(1);
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain('S3cret');
    expect(k.decrypt(ciphertext, 1, 'router-1')).toBe('S3cret-Password-123');
  });

  it('uses a fresh IV every time', () => {
    const k = Keyring.fromBase64({ version: 1, key: key() });
    expect(k.encrypt('same', 'r').ciphertext).not.toBe(k.encrypt('same', 'r').ciphertext);
  });

  it('binds ciphertext to its router (AAD): copying it to another router fails', () => {
    const k = Keyring.fromBase64({ version: 1, key: key() });
    const { ciphertext } = k.encrypt('pw-pw-pw-pw', 'router-a');
    expect(() => k.decrypt(ciphertext, 1, 'router-b')).toThrow(KeyringError);
  });

  it('detects tampering and wrong keys', () => {
    const k1 = Keyring.fromBase64({ version: 1, key: key() });
    const k2 = Keyring.fromBase64({ version: 1, key: key() });
    const { ciphertext } = k1.encrypt('pw-pw-pw-pw', 'r');
    expect(() => k2.decrypt(ciphertext, 1, 'r')).toThrow(/failed authentication/);
    const parts = ciphertext.split('.');
    parts[2] = `${parts[2]!.slice(0, -2)}AA`;
    expect(() => k1.decrypt(parts.join('.'), 1, 'r')).toThrow(KeyringError);
    expect(() => k1.decrypt('garbage', 1, 'r')).toThrow(/expected format/);
  });

  it('supports rotation: old versions still decrypt, new writes use the current version', () => {
    const oldKey = key();
    const v1 = Keyring.fromBase64({ version: 1, key: oldKey });
    const { ciphertext } = v1.encrypt('rotate-me-123', 'r');
    const v2 = Keyring.fromBase64({ version: 2, key: key() }, [{ version: 1, key: oldKey }]);
    expect(v2.decrypt(ciphertext, 1, 'r')).toBe('rotate-me-123');
    expect(v2.encrypt('x', 'r').keyVersion).toBe(2);
    expect(() => v2.decrypt(ciphertext, 2, 'r')).toThrow(/does not match/);
    const v3 = Keyring.fromBase64({ version: 3, key: key() });
    expect(() => v3.decrypt(ciphertext, 1, 'r')).toThrow(/ENCRYPTION_KEYS_RETIRED/);
  });

  it('rejects malformed key material', () => {
    expect(() => Keyring.fromBase64({ version: 1, key: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/);
    expect(() => new Keyring(2, [{ version: 1, key: randomBytes(32) }])).toThrow(/no key/);
  });
});

describe('sealing key derivation', () => {
  it('is deterministic per ENCRYPTION_KEY + version and rotates with the version', async () => {
    const material = key();
    const a = await SealingKeys.fromKeyring(Keyring.fromBase64({ version: 1, key: material }));
    const b = await SealingKeys.fromKeyring(Keyring.fromBase64({ version: 1, key: material }));
    const c = await SealingKeys.fromKeyring(Keyring.fromBase64({ version: 2, key: material }));
    expect(a.current.kid).toBe(b.current.kid);
    expect(a.current.publicKey).toEqual(b.current.publicKey);
    expect(c.current.kid).not.toBe(a.current.kid);
    expect(a.current.publicKey.jwk).not.toHaveProperty('d');
  });

  it('opens envelopes sealed to a retired key during rotation', async () => {
    const oldKey = key();
    const before = await SealingKeys.fromKeyring(Keyring.fromBase64({ version: 1, key: oldKey }));
    const env = await sealCredentials(before.current.publicKey, 'router-x', { username: 'u-user', password: 'p-password-1' });
    const after = await SealingKeys.fromKeyring(Keyring.fromBase64({ version: 2, key: key() }, [{ version: 1, key: oldKey }]));
    expect(await after.open('router-x', env)).toEqual({ username: 'u-user', password: 'p-password-1' });
  });
});

describe('credential submission → connector → encrypted at rest', () => {
  let w: World;
  afterEach(async () => {
    await w?.close();
  });

  const SECRET = 'Wq7Lp2Xz9Rb4Nt6Vc8Hs3Dk5Mj1Fg0Ya';

  async function submit(routerId: string, password = SECRET, sealTo = w.sealing.current.publicKey): Promise<string> {
    // What the browser does: seal to the connector's published key, then call the RPC.
    const envelope = await sealCredentials(sealTo, routerId, { username: 'hotzonex-api', password });
    const [row] = await as(w.db, { kind: 'user', id: w.admin.id, headers: { 'user-agent': 'browser', 'x-forwarded-for': '41.79.9.9' } }, (tx) =>
      rpc<{ id: string }>(tx, 'submit_router_credentials', { p_router_id: routerId, p_sealed: envelope, p_idempotency_key: randomUUID() }),
    );
    return row!.id;
  }

  it('stores only ciphertext; the API, the logs and every readable column stay free of the password', async () => {
    w = await createWorld();
    const r = await addRouter(w, { withCredentials: false });
    const jobId = await submit(r.id);
    expect((await router(w, r.id))['credentials_status']).toBe('pending');

    await runJobs(w);
    expect(await job(w, jobId)).toMatchObject({ status: 'succeeded', result: { stored: true, superseded: false, keyVersion: 1 } });
    expect((await router(w, r.id))['credentials_status']).toBe('set');

    const creds = await w.db.query<{ username: string; password_ciphertext: string; key_version: number }>(
      `select username, password_ciphertext, key_version from public.router_credentials where router_id = $1`,
      [r.id],
    );
    expect(creds.rows[0]?.password_ciphertext).not.toContain(SECRET);
    expect(w.keyring.decrypt(creds.rows[0]!.password_ciphertext, creds.rows[0]!.key_version, r.id)).toBe(SECRET);
    expect((await w.db.query(`select 1 from public.router_credential_submissions where router_id = $1`, [r.id])).rows).toHaveLength(0);

    // The stored credentials actually work for a connection test.
    const test = await enqueue(w, r.id, 'router.test_connection');
    await runJobs(w);
    expect((await job(w, test)).status).toBe('succeeded');

    // 1. No API response: an admin reading every table they can see never gets the password.
    const tables = (await w.db.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'public'`)).rows.map((x) => x.t);
    for (const t of tables) {
      try {
        const rows = await as(w.db, { kind: 'user', id: w.admin.id }, (tx) => tx.query(`select * from public.${t}`));
        expect(JSON.stringify(rows.rows), t).not.toContain(SECRET);
      } catch (error) {
        expect((error as { code?: string }).code, t).toBe('42501');
      }
    }
    // 2. Nowhere in the database at all (even as superuser), except as ciphertext.
    for (const t of tables) {
      const rows = await w.db.query(`select * from public.${t}`);
      expect(JSON.stringify(rows.rows), t).not.toContain(SECRET);
    }
    // 3. Not in any log line.
    expect(w.logs.text.length).toBeGreaterThan(0);
    expect(w.logs.text).not.toContain(SECRET);
    // 4. Audit says credentials changed, without the secret.
    const audit = await w.db.query<{ action: string; ip: string | null }>(`select action, ip from public.audit_logs where entity_id = $1 order by id`, [r.id]);
    expect(audit.rows.map((a) => a.action)).toEqual(expect.arrayContaining(['router.credentials.submitted', 'router.credentials.stored']));
    expect(audit.rows.find((a) => a.action === 'router.credentials.submitted')?.ip).toBe('41.79.9.9');
  });

  it('a newer submission supersedes an older one; only the newest password is stored', async () => {
    w = await createWorld();
    const r = await addRouter(w, { withCredentials: false });
    const first = await submit(r.id, 'OldPassword111111111111');
    const second = await submit(r.id, 'NewPassword222222222222');
    await runJobs(w);
    expect((await job(w, first)).result).toMatchObject({ stored: false, superseded: true });
    expect((await job(w, second)).result).toMatchObject({ stored: true });
    const c = await w.db.query<{ password_ciphertext: string; key_version: number }>(`select password_ciphertext, key_version from public.router_credentials where router_id = $1`, [r.id]);
    expect(w.keyring.decrypt(c.rows[0]!.password_ciphertext, c.rows[0]!.key_version, r.id)).toBe('NewPassword222222222222');
  });

  it('an envelope sealed to an unknown key is rejected with CREDENTIALS_UNREADABLE', async () => {
    w = await createWorld();
    const r = await addRouter(w, { withCredentials: false });
    const stranger = await SealingKeys.fromKeyring(Keyring.fromBase64({ version: 1, key: key() }));
    const jobId = await submit(r.id, SECRET, stranger.current.publicKey);
    await runJobs(w);
    expect(await job(w, jobId)).toMatchObject({ status: 'failed', last_error_code: 'CREDENTIALS_UNREADABLE' });
    expect((await router(w, r.id))['credentials_status']).toBe('rejected');
    expect(w.logs.text).not.toContain(SECRET);
  });

  it('an envelope sealed for another router cannot be replayed onto this one', async () => {
    w = await createWorld();
    const a = await addRouter(w, { withCredentials: false });
    const b = await addRouter(w, { withCredentials: false });
    const envelope = await sealCredentials(w.sealing.current.publicKey, a.id, { username: 'hotzonex-api', password: SECRET });
    const [row] = await as(w.db, { kind: 'user', id: w.admin.id }, (tx) =>
      rpc<{ id: string }>(tx, 'submit_router_credentials', { p_router_id: b.id, p_sealed: envelope, p_idempotency_key: randomUUID() }),
    );
    await runJobs(w);
    expect(await job(w, row!.id)).toMatchObject({ status: 'failed', last_error_code: 'CREDENTIALS_UNREADABLE' });
  });

  it('rekey re-encrypts every credential with the new key version', async () => {
    w = await createWorld();
    const r1 = await addRouter(w, { password: 'first-password-1' });
    const r2 = await addRouter(w, { password: 'second-password-2' });
    const oldMaterial = w.keyring.keyMaterial(1).toString('base64');
    const next = Keyring.fromBase64({ version: 2, key: key() }, [{ version: 1, key: oldMaterial }]);
    expect(await rekeyAll(w.store, next)).toEqual({ rekeyed: 2, failed: 0 });
    for (const [id, pw] of [[r1.id, 'first-password-1'], [r2.id, 'second-password-2']] as const) {
      const c = await w.db.query<{ password_ciphertext: string; key_version: number }>(`select password_ciphertext, key_version from public.router_credentials where router_id = $1`, [id]);
      expect(c.rows[0]?.key_version).toBe(2);
      expect(next.decrypt(c.rows[0]!.password_ciphertext, 2, id)).toBe(pw);
    }
    expect(await rekeyAll(w.store, next)).toEqual({ rekeyed: 0, failed: 0 });
  });
});
