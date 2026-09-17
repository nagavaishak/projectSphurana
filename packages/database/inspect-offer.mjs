import { sql } from 'drizzle-orm';
import { db } from './src/index.ts';
const cols = await db.execute(sql`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'offer'
  ORDER BY ordinal_position;
`);
console.log('=== offer columns ===');
for (const r of cols)
  console.log(
    `  ${r.column_name.padEnd(28)} ${r.data_type.padEnd(28)} null=${r.is_nullable} default=${r.column_default ?? '-'}`
  );

const enums = await db.execute(sql`
  SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) as labels
  FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname LIKE 'offer%' OR t.typname LIKE 'discount%'
  GROUP BY t.typname;
`);
console.log('\n=== enums ===');
for (const r of enums) console.log(`  ${r.typname}: ${r.labels}`);

const indexes = await db.execute(sql`
  SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'offer';
`);
console.log('\n=== indexes ===');
for (const r of indexes) console.log(`  ${r.indexname}: ${r.indexdef}`);

const constraints = await db.execute(sql`
  SELECT con.conname, pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'offer';
`);
console.log('\n=== constraints ===');
for (const r of constraints)
  console.log(`  ${r.conname}: ${r.pg_get_constraintdef}`);

const tables = await db.execute(sql`
  SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%offer%' ORDER BY table_name;
`);
console.log('\n=== offer-related tables ===');
for (const r of tables) console.log('  -', r.table_name);
process.exit(0);
