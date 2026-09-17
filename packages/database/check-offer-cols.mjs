import { db } from '@borradh-workspace/database';
import { sql } from 'drizzle-orm';

try {
  const rows = await db.execute(sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'offer'
    ORDER BY ordinal_position;
  `);
  console.log('offer columns:');
  for (const r of rows) console.log('  -', r.column_name, '/', r.data_type);

  const migrationRows = await db.execute(sql`
    SELECT id, hash, created_at FROM drizzle.__drizzle_migrations
    ORDER BY created_at DESC LIMIT 5;
  `);
  console.log('\nlast 5 migration rows:');
  for (const r of migrationRows)
    console.log('  -', r.id, r.hash?.slice?.(0, 12), r.created_at);
} catch (e) {
  console.error('failed:', e.message);
}
process.exit(0);
