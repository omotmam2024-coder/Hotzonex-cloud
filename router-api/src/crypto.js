import crypto from 'node:crypto';

const key = Buffer.from(process.env.ROUTER_SECRET_KEY ?? '', 'base64');
if (key.length !== 32) {
  throw new Error('ROUTER_SECRET_KEY must be 32 bytes, base64-encoded (npm run genkey)');
}

// Output format: base64(iv).base64(tag).base64(ciphertext)
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}

export function decrypt(blob) {
  const [iv, tag, ct] = String(blob).split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
