import { createECDH, createHash, hkdfSync } from 'node:crypto';
import { SealError, openSealedCredentials, type CredentialPlaintext, type SealingPublicKey } from '@hotzonex/shared/sealing';
import type { Keyring } from './keyring.js';

/**
 * The P-256 key browsers seal router credentials to. It is derived
 * deterministically from ENCRYPTION_KEY (per key version), so every connector
 * instance with the same key agrees on it, it survives restarts, and it
 * rotates with ENCRYPTION_KEY_VERSION — no extra secret to manage.
 */
export interface SealingKey {
  kid: string;
  keyVersion: number;
  publicKey: SealingPublicKey;
  privateKey: CryptoKey;
}

function deriveScalar(material: Buffer, version: number): { priv: Buffer; pub: Buffer } {
  // A random 32-byte string is a valid P-256 scalar with overwhelming probability; retry on the rare miss.
  for (let counter = 0; counter < 16; counter++) {
    const priv = Buffer.from(hkdfSync('sha256', material, 'hotzonex', `hotzonex/sealing-key/v1|${version}|${counter}`, 32));
    try {
      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(priv);
      return { priv, pub: ecdh.getPublicKey(null, 'uncompressed') };
    } catch {
      // try next counter
    }
  }
  throw new Error('could not derive a sealing key');
}

export async function deriveSealingKey(keyring: Keyring, version: number): Promise<SealingKey> {
  const { priv, pub } = deriveScalar(keyring.keyMaterial(version), version);
  const x = pub.subarray(1, 33).toString('base64url');
  const y = pub.subarray(33, 65).toString('base64url');
  const kid = createHash('sha256').update(pub).digest('hex').slice(0, 32);
  const privateKey = await globalThis.crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d: priv.toString('base64url'), ext: false },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  return { kid, keyVersion: version, publicKey: { kid, jwk: { kty: 'EC', crv: 'P-256', x, y } }, privateKey };
}

/** All sealing keys the connector can open (current + retired), indexed by kid. */
export class SealingKeys {
  private constructor(
    private readonly byKid: Map<string, SealingKey>,
    readonly current: SealingKey,
  ) {}

  static async fromKeyring(keyring: Keyring): Promise<SealingKeys> {
    const map = new Map<string, SealingKey>();
    for (const v of keyring.versions()) {
      const k = await deriveSealingKey(keyring, v);
      map.set(k.kid, k);
    }
    const current = [...map.values()].find((k) => k.keyVersion === keyring.currentVersion);
    if (!current) throw new Error('no sealing key for the current key version');
    return new SealingKeys(map, current);
  }

  async open(routerId: string, envelope: unknown): Promise<CredentialPlaintext> {
    const kid = (envelope as { kid?: unknown } | null)?.kid;
    const key = typeof kid === 'string' ? this.byKid.get(kid) : undefined;
    if (!key) throw new SealError('envelope was sealed to a key this connector does not hold');
    return openSealedCredentials(key.privateKey, key.kid, routerId, envelope);
  }
}
