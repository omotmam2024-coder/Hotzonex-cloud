// `pnpm db:migrate`
//   * SUPABASE_DB_URL set  → push migrations to that database (e.g. a hosted Supabase project).
//   * otherwise            → start the local Supabase stack (Docker) if needed and apply pending migrations.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const envFile = join(here, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const isWin = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', shell: isWin });
  return r;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const remote = process.env.SUPABASE_DB_URL && !/127\.0\.0\.1|localhost/.test(process.env.SUPABASE_DB_URL);

if (remote) {
  console.log('Applying migrations to the database in SUPABASE_DB_URL …');
  const r = run('supabase', ['db', 'push', '--db-url', process.env.SUPABASE_DB_URL]);
  if (r.status !== 0) fail('supabase db push failed (see output above).');
  console.log('\n✔ Migrations applied.');
  process.exit(0);
}

const docker = run('docker', ['info'], { capture: true });
if (docker.status !== 0) {
  fail(
    [
      'Docker is not running, and the local Supabase stack needs it.',
      '',
      '  • Install / start Docker Desktop, then run `pnpm db:migrate` again, or',
      '  • point at a hosted Supabase project: set SUPABASE_DB_URL in supabase/.env',
      '    (Project Settings → Database → Connection string) and run `pnpm db:migrate`.',
    ].join('\n'),
  );
}

const status = run('supabase', ['status', '-o', 'env'], { capture: true });
if (status.status !== 0) {
  console.log('Starting the local Supabase stack (first run downloads images) …');
  const start = run('supabase', ['start']);
  if (start.status !== 0) fail('supabase start failed (see output above).');
}

console.log('Applying pending migrations …');
const up = run('supabase', ['migration', 'up', '--local']);
if (up.status !== 0) fail('supabase migration up failed (see output above).');

const env = run('supabase', ['status', '-o', 'env'], { capture: true });
const vars = Object.fromEntries(
  (env.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
console.log('\n✔ Local database is up to date.\n');
console.log('Copy these into your .env files (see each .env.example):\n');
console.log(`  apps/web/.env.local     VITE_SUPABASE_URL=${vars.API_URL ?? 'http://127.0.0.1:54321'}`);
console.log(`                          VITE_SUPABASE_ANON_KEY=${vars.ANON_KEY ?? vars.PUBLISHABLE_KEY ?? '<anon key>'}`);
console.log(`  apps/connector/.env     SUPABASE_URL=${vars.API_URL ?? 'http://127.0.0.1:54321'}`);
console.log('                          SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from `supabase status`>');
console.log('  supabase/.env           same SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, plus SEED_ADMIN_PASSWORD\n');
