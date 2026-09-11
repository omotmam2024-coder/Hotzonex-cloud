/**
 * Boundary checks that must hold for every commit:
 *  - the Supabase service-role key (or any reference to it) never appears in
 *    the web app's source or its built output;
 *  - the browser never selects from the credential tables;
 *  - MikroTik command strings live only in packages/mikrotik.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = join(import.meta.dirname, '..');
const REPO = join(WEB, '..', '..');

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.test(name)) out.push(p);
  }
  return out;
}

describe('web app security boundary', () => {
  const sources = [...walk(join(WEB, 'src'), /\.(ts|tsx|css|html)$/), join(WEB, 'index.html'), join(WEB, 'vite.config.ts')];

  it('has no reference to the service-role key in source', () => {
    for (const f of sources) {
      expect(readFileSync(f, 'utf8'), relative(REPO, f)).not.toMatch(/service[_-]?role/i);
    }
  });

  it('has no reference to the service-role key in the built bundle (if built)', () => {
    const files = walk(join(WEB, 'dist'), /\.(js|html|webmanifest|json)$/);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, relative(REPO, f)).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
      // A JWT whose payload says role=service_role starts with this base64 fragment.
      expect(text, relative(REPO, f)).not.toMatch(/InNlcnZpY2Vfcm9sZS/);
    }
  });

  it('never queries the credential tables from the browser', () => {
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      expect(text, relative(REPO, f)).not.toMatch(/from\(['"]router_credential/);
      expect(text, relative(REPO, f)).not.toMatch(/password_ciphertext/);
    }
  });

  it('only exposes VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the browser', () => {
    const example = readFileSync(join(WEB, '.env.example'), 'utf8');
    const keys = [...example.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);
    expect(keys).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']);
  });
});

describe('architecture boundary', () => {
  it('RouterOS command strings appear only in packages/mikrotik', () => {
    const offenders: string[] = [];
    const dirs = ['apps/web/src', 'apps/connector/src', 'packages/shared/src', 'supabase/migrations'];
    const pattern = /['"`]\/(ip\/hotspot|system\/resource|interface\/print|user\/group|ip\/service|interface\/wireguard)/;
    for (const d of dirs) {
      for (const f of walk(join(REPO, d), /\.(ts|tsx|sql)$/)) {
        if (pattern.test(readFileSync(f, 'utf8'))) offenders.push(relative(REPO, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});
