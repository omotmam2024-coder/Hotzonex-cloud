/**
 * DEV ONLY — change the simulated condition of a mock-served router.
 *
 *   pnpm --filter @hotzonex/connector mock:router <router-id|tunnel-ip> <condition>
 *   pnpm --filter @hotzonex/connector mock:router list
 *
 * Conditions: online | offline | timeout | auth_failed | api_disabled | permission_denied | malformed
 * Affects routers served by the mock provider (every router with
 * MIKROTIK_PROVIDER=mock, and DEMO routers always). Real routers are untouched.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MOCK_CONDITIONS, MockStateFile, type MockCondition } from '../routers/mock-state.js';

const file = resolve(process.env['MOCK_STATE_FILE'] ?? '.mock-state.json');
const [target, condition] = process.argv.slice(2);

if (!target || target === 'list') {
  let content = '{ "routers": {} }';
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    // no overrides yet
  }
  process.stdout.write(`${file}\n${content}\n`);
  process.exit(0);
}

if (!condition || !(MOCK_CONDITIONS as readonly string[]).includes(condition)) {
  process.stderr.write(`Usage: mock:router <router-id|tunnel-ip> <${MOCK_CONDITIONS.join('|')}>\n`);
  process.exit(2);
}

new MockStateFile(file).set(target, condition as MockCondition);
process.stdout.write(`Mock router ${target} is now "${condition}". The next health poll or job will see it.\n`);
