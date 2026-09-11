// Regenerates packages/shared/src/database.types.ts with the Supabase CLI from
// the running local stack (`supabase start`). Without Docker, use
// `pnpm db:types:offline`, which introspects the same migrations via PGlite.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'packages', 'shared', 'src', 'database.types.ts');

const result = spawnSync('supabase', ['gen', 'types', 'typescript', '--local', '--schema', 'public'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  console.error(result.stderr || result.error?.message || 'supabase gen types failed');
  console.error('\nIs the local stack running? Start it with `pnpm db:migrate` (needs Docker),');
  console.error('or run `pnpm db:types:offline` to generate types without Docker.');
  process.exit(1);
}

writeFileSync(
  out,
  `/* eslint-disable */\n// GENERATED FILE — do not edit by hand. Regenerate with \`pnpm db:types\`.\n\n${result.stdout}`,
);
console.log(`wrote ${out}`);
