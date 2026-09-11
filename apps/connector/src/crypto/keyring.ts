import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption of router passwords at rest.
 *
 * Ciphertext format: "v<version>.<iv>.<ciphertext>.<tag>" (base64url parts).
 * The router id is bound as AAD, so a ciphertext copied onto another router
 * row will not decrypt. Keys are versioned for rotation: new writes use the
 * current version; older versions stay available for decryption until
 * `pnpm --filter @hotzonex/connector rekey` has re-encrypted every row.
 */
export class KeyringError extends Error {
  override readonly name = 'KeyringError';
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

export class Keyring {
  private readonly keys = new Map<number, Buffer>();

  constructor(
    readonly currentVersion: number,
    keys: Array<{ version: number; key: Buffer }>,
  ) {
    for (const { version, key } of keys) {
      if (key.length !== 32) throw new KeyringError(`key version ${version} is not 32 bytes`);
      if (this.keys.has(version)) throw new KeyringError(`key version ${version} is defined twice`);
      this.keys.set(version, Buffer.from(key));
    }
    if (!this.keys.has(currentVersion)) throw new KeyringError(`current key version ${currentVersion} has no key`);
  }

  static fromBase64(current: { version: number; key: string }, retired: Array<{ version: number; key: string }> = []): Keyring {
    return new Keyring(current.version, [current, ...retired].map((k) => ({ version: k.version, key: Buffer.from(k.key, 'base64') })));
  }

  versions(): number[] {
    return [...this.keys.keys()].sort((a, b) => a - b);
  }

  /** Raw key material, for deriving the per-version sealing key. Never log or persist. */
  keyMaterial(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) throw new KeyringError(`no key for version ${version}`);
    return key;
  }

  encrypt(plaintext: string, aad: string): { ciphertext: string; keyVersion: number } {
    const key = this.keyMaterial(this.currentVersion);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: `v${this.currentVersion}.${iv.toString('base64url')}.${ct.toString('base64url')}.${tag.toString('base64url')}`,
      keyVersion: this.currentVersion,
    };
  }

  decrypt(ciphertext: string, keyVersion: number, aad: string): string {
    const match = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]+)$/.exec(ciphertext);
    if (!match) throw new KeyringError('ciphertext is not in the expected format');
    const embedded = Number(match[1]);
    if (embedded !== keyVersion) throw new KeyringError('ciphertext key version does not match its record');
    const key = this.keys.get(keyVersion);
    if (!key) throw new KeyringError(`no key for version ${keyVersion}; add it to ENCRYPTION_KEYS_RETIRED`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(match[2] as string, 'base64url'), { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(match[4] as string, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(match[3] as string, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new KeyringError('ciphertext failed authentication (wrong key, wrong router, or tampered)');
    }
  }
}
