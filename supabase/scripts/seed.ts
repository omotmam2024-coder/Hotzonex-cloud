/**
 * `pnpm db:seed` — idempotent.
 *   1. Applies supabase/seed.sql (tenant, the three Hotzonex locations, DEMO routers).
 *   2. Creates or updates the SUPER_ADMIN login admin@hotzonex.com with
 *      SEED_ADMIN_PASSWORD (required — there is no default password).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { passwordSchema } from '@hotzonex/shared/schemas';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_EMAIL = 'admin@hotzonex.com';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✖ ${name} is not set. Add it to supabase/.env (see supabase/.env.example).`);
    process.exit(1);
  }
  return v;
}

const supabaseUrl = required('SUPABASE_URL');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
// Optional: with a direct connection the script applies seed.sql itself. Without one
// (e.g. a hosted project where seed.sql was run in the SQL editor), it only
// provisions the admin login, through the API.
const dbUrl = process.env['SUPABASE_DB_URL'];
const password = required('SEED_ADMIN_PASSWORD');
const pw = passwordSchema.safeParse(password);
if (!pw.success) {
  console.error(`✖ SEED_ADMIN_PASSWORD is too weak: ${pw.error.issues.map((i) => i.message).join(' ')}`);
  process.exit(1);
}

const client = dbUrl ? new pg.Client({ connectionString: dbUrl }) : null;
if (client) {
  try {
    await client.connect();
  } catch (error) {
    console.error(`✖ Cannot connect to the database at ${(dbUrl as string).replace(/:[^:@/]+@/, ':****@')}: ${(error as Error).message}`);
    console.error('  Run `pnpm db:migrate` first, or unset SUPABASE_DB_URL if seed.sql is already applied.');
    process.exit(1);
  }
}

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

try {
  if (client) {
    await client.query(readFileSync(join(here, '..', 'seed.sql'), 'utf8'));
    console.log('✔ Seed data applied (tenant, 3 locations, 3 DEMO routers).');
  } else {
    const { data, error } = await admin.from('tenants').select('id').eq('id', TENANT_ID).maybeSingle();
    if (error) throw new Error(`checking the seed tenant failed: ${error.message}`, { cause: error });
    if (!data) throw new Error('the seed tenant is missing: run supabase/seed.sql first (SQL editor), or set SUPABASE_DB_URL');
    console.log('✔ Seed data already present (SUPABASE_DB_URL not set, so seed.sql was not re-run).');
  }

  let userId: string | null = null;
  for (let page = 1; page < 50 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listing users failed: ${error.message}`, { cause: error });
    userId = data.users.find((u) => u.email?.toLowerCase() === ADMIN_EMAIL)?.id ?? null;
    if (data.users.length < 200) break;
  }

  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      app_metadata: { provisioned_by: 'hotzonex-seed' },
    });
    if (error) throw new Error(`updating ${ADMIN_EMAIL} failed: ${error.message}`, { cause: error });
    console.log(`✔ ${ADMIN_EMAIL} exists — password reset to SEED_ADMIN_PASSWORD.`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password,
      email_confirm: true,
      app_metadata: { provisioned_by: 'hotzonex-seed' },
      user_metadata: { full_name: 'Hotzonex Administrator' },
    });
    if (error || !data.user) throw new Error(`creating ${ADMIN_EMAIL} failed: ${error?.message ?? 'no user returned'}`, { cause: error });
    userId = data.user.id;
    console.log(`✔ Created ${ADMIN_EMAIL}.`);
  }

  // Service role: bypasses RLS, and has full grants on profiles.
  const { error: profileError } = await admin.from('profiles').upsert(
    { id: userId, tenant_id: TENANT_ID, email: ADMIN_EMAIL, full_name: 'Hotzonex Administrator', role: 'SUPER_ADMIN', status: 'active' },
    { onConflict: 'id' },
  );
  if (profileError) throw new Error(`creating the admin profile failed: ${profileError.message}`, { cause: profileError });
  console.log('✔ SUPER_ADMIN profile ready. Sign in with admin@hotzonex.com and SEED_ADMIN_PASSWORD.');
} catch (error) {
  console.error(`✖ Seeding failed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await client?.end();
}
