import { describe, expect, it } from 'vitest';
import { SealError, isSealedEnvelope, openSealedCredentials, sealCredentials, type SealingPublicKey } from '../src/sealing.js';

async function keypair(): Promise<{ pub: SealingPublicKey; priv: CryptoKey }> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { pub: { kid: 'a1b2c3d4e5f60718', jwk: { kty: 'EC', crv: 'P-256', x: jwk.x as string, y: jwk.y as string } }, priv: kp.privateKey };
}

const ROUTER = '8d3f4b3e-2f5b-4c2a-9a0e-3f7a9f7e1c11';
const creds = { username: 'hotzonex-api', password: 'Zx9KqT3mWp7Rb2NvLs8HdY4cFg6JtE5a' };

describe('credential sealing', () => {
  it('round-trips, and the envelope matches the database shape check', async () => {
    const { pub, priv } = await keypair();
    const env = await sealCredentials(pub, ROUTER, creds);
    expect(isSealedEnvelope(env)).toBe(true);
    expect(env.epk).toHaveLength(87);
    expect(env.iv).toHaveLength(16);
    expect(await openSealedCredentials(priv, pub.kid, ROUTER, env)).toEqual(creds);
  });

  it('never contains the plaintext', async () => {
    const { pub } = await keypair();
    const env = JSON.stringify(await sealCredentials(pub, ROUTER, creds));
    expect(env).not.toContain(creds.password);
    expect(env).not.toContain(creds.username);
  });

  it('is bound to the router: an envelope for router A cannot be opened as router B', async () => {
    const { pub, priv } = await keypair();
    const env = await sealCredentials(pub, ROUTER, creds);
    await expect(openSealedCredentials(priv, pub.kid, '00000000-0000-4000-8000-000000000999', env)).rejects.toBeInstanceOf(SealError);
  });

  it('rejects the wrong key, a mismatched kid, and tampering', async () => {
    const a = await keypair();
    const b = await keypair();
    const env = await sealCredentials(a.pub, ROUTER, creds);
    await expect(openSealedCredentials(b.priv, a.pub.kid, ROUTER, env)).rejects.toThrow(/could not be opened/);
    await expect(openSealedCredentials(a.priv, 'ffffffffffffffff', ROUTER, env)).rejects.toThrow(/different key/);
    const flipped = env.ct[0] === 'A' ? 'B' : 'A';
    await expect(openSealedCredentials(a.priv, a.pub.kid, ROUTER, { ...env, ct: flipped + env.ct.slice(1) })).rejects.toBeInstanceOf(SealError);
    await expect(openSealedCredentials(a.priv, a.pub.kid, ROUTER, { v: 1 })).rejects.toThrow(/malformed/);
  });

  it('uses a fresh ephemeral key and IV every time', async () => {
    const { pub } = await keypair();
    const e1 = await sealCredentials(pub, ROUTER, creds);
    const e2 = await sealCredentials(pub, ROUTER, creds);
    expect(e1.epk).not.toBe(e2.epk);
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.ct).not.toBe(e2.ct);
  });
});
