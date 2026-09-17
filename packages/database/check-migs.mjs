import { sql } from 'drizzle-orm';
import { db } from './src/index.ts';
try {
  const rows = await db.execute(sql`
    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY id ASC;
  `);
  console.log('count:', rows.length);
  for (const r of rows) {
    const d = new Date(Number(r.created_at));
    console.log(
      `  id=${r.id}  hash=${r.hash?.slice?.(0, 12)}  created=${d.toISOString()}`
    );
  }
} catch (e) {
  console.error(e.message);
}
process.exit(0);
