/**
 * Credential sealing: the browser encrypts router credentials to the
 * connector's public key so plaintext never reaches the database, the API,
 * logs, or browser storage.
 *
 *   ephemeral ECDH P-256  →  shared secret
 *   HKDF-SHA256(secret, salt = ephemeral public key, info = v1|kid|router)  →  AES-256-GCM key
 *   AES-GCM(plaintext, aad = router id)
 *
 * Binding the router id into both HKDF info and AAD means an envelope sealed
 * for router A cannot be replayed as credentials for router B.
 * Pure WebCrypto: runs unchanged in browsers and Node ≥ 20.
 */

export interface SealingPublicKeyJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface SealingPublicKey {
  /** Key id (hex) published by the connector alongside the key. */
  kid: string;
  jwk: SealingPublicKeyJwk;
}

export interface SealedEnvelope {
  v: 1;
  kid: string;
  /** Ephemeral public key, uncompressed point, base64url (no padding). */
  epk: string;
  iv: string;
  ct: string;
}

export interface CredentialPlaintext {
  username: string;
  password: string;
}

export class SealError extends Error {
  override readonly name = 'SealError';
}

const INFO_PREFIX = 'hotzonex/credential-seal/v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new SealError('WebCrypto is unavailable. Use a current browser over HTTPS (or localhost).');
  return s;
}

/** ArrayBuffer-backed copy, as WebCrypto's BufferSource typing requires. */
function bytes(data: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const src = typeof data === 'string' ? encoder.encode(data) : data;
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
}

export function toBase64Url(data: ArrayBuffer | Uint8Array): string {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new SealError('invalid base64url');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveAesKey(sharedSecret: ArrayBuffer, epkRaw: Uint8Array, kid: string, routerId: string, usage: KeyUsage): Promise<CryptoKey> {
  const s = subtle();
  const hkdf = await s.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  return s.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: bytes(epkRaw), info: bytes(`${INFO_PREFIX}|${kid}|${routerId}`) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

export async function sealCredentials(
  recipient: SealingPublicKey,
  routerId: string,
  plaintext: CredentialPlaintext,
): Promise<SealedEnvelope> {
  if (!/^[0-9a-f]{16,64}$/.test(recipient.kid)) throw new SealError('invalid key id');
  if (!plaintext.username || !plaintext.password) throw new SealError('username and password are required');
  const s = subtle();
  const publicKey = await s.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: recipient.jwk.x, y: recipient.jwk.y, ext: true },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ephemeral = (await s.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const shared = await s.deriveBits({ name: 'ECDH', public: publicKey }, ephemeral.privateKey, 256);
  const epkRaw = new Uint8Array(await s.exportKey('raw', ephemeral.publicKey));
  const key = await deriveAesKey(shared, epkRaw, recipient.kid, routerId, 'encrypt');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ct = await s.encrypt(
    { name: 'AES-GCM', iv, additionalData: bytes(routerId) },
    key,
    bytes(JSON.stringify({ u: plaintext.username, p: plaintext.password })),
  );
  return { v: 1, kid: recipient.kid, epk: toBase64Url(epkRaw), iv: toBase64Url(iv), ct: toBase64Url(ct) };
}

export function isSealedEnvelope(value: unknown): value is SealedEnvelope {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    (e['v'] === 1 || e['v'] === '1') &&
    typeof e['kid'] === 'string' && /^[0-9a-f]{16,64}$/.test(e['kid']) &&
    typeof e['epk'] === 'string' && /^[A-Za-z0-9_-]{87}$/.test(e['epk']) &&
    typeof e['iv'] === 'string' && /^[A-Za-z0-9_-]{16}$/.test(e['iv']) &&
    typeof e['ct'] === 'string' && /^[A-Za-z0-9_-]{24,2048}$/.test(e['ct'])
  );
}

/** Connector side. `privateKey` must be an ECDH P-256 key with deriveBits usage. */
export async function openSealedCredentials(
  privateKey: CryptoKey,
  kid: string,
  routerId: string,
  envelope: unknown,
): Promise<CredentialPlaintext> {
  if (!isSealedEnvelope(envelope)) throw new SealError('malformed envelope');
  if (envelope.kid !== kid) throw new SealError('envelope was sealed to a different key');
  const s = subtle();
  try {
    const epkRaw = fromBase64Url(envelope.epk);
    const ephemeral = await s.importKey('raw', epkRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = await s.deriveBits({ name: 'ECDH', public: ephemeral }, privateKey, 256);
    const key = await deriveAesKey(shared, epkRaw, kid, routerId, 'decrypt');
    const pt = await s.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(envelope.iv), additionalData: bytes(routerId) },
      key,
      fromBase64Url(envelope.ct),
    );
    const parsed = JSON.parse(decoder.decode(pt)) as { u?: unknown; p?: unknown };
    if (typeof parsed.u !== 'string' || typeof parsed.p !== 'string' || !parsed.u || !parsed.p) {
      throw new SealError('envelope content is incomplete');
    }
    return { username: parsed.u, password: parsed.p };
  } catch (error) {
    if (error instanceof SealError) throw error;
    // Wrong key, wrong router, or tampered ciphertext all look the same by design.
    throw new SealError('envelope could not be opened');
  }
}
