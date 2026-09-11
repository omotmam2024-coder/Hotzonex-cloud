import { beforeAll } from 'vitest';
import { createTestDb } from '@hotzonex/db/testing';

// Apply every migration once per test file, outside any single test's time budget.
// Tests then get cheap clones of this template (see supabase/tests/harness.ts).
beforeAll(async () => {
  const db = await createTestDb();
  await db.close();
}, 180_000);
