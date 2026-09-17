/**
 * Programmatic database migration script
 * Run with: node packages/database/dist/migrate.js
 *
 * This script is used in production to run migrations without needing drizzle-kit CLI.
 * Migrations are generated locally with `pnpm db:generate` and committed to the repo.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseEnv } from '@borradh-workspace/env/database';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { validateMigrations } from './validate-migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  console.log('Starting database migrations...');

  // Create a dedicated connection for migrations
  const migrationClient = postgres(databaseEnv.DATABASE_URL, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    // In production (dist folder), migrations are at ../drizzle
    // In development (src folder), migrations are at ../drizzle
    const migrationsFolder = path.resolve(__dirname, '../drizzle');

    console.log(`Running migrations from: ${migrationsFolder}`);

    // Preflight: validate the migration folder before handing it to drizzle.
    // drizzle's own errors for missing SQL files happen mid-deploy and are
    // obscure ("No file <tag>.sql found..."). This runs the same checks the
    // CI job runs so a bad migration folder fails fast with a clear list of
    // problems instead of halfway through deploying.
    const { errors: validationErrors, warnings } =
      validateMigrations(migrationsFolder);

    if (warnings.length > 0) {
      console.warn(`Migration warnings (${warnings.length}):`);
      for (const w of warnings) console.warn(`  • ${w}`);
    }

    if (validationErrors.length > 0) {
      console.error(
        `Migration folder validation failed (${validationErrors.length} fatal error${validationErrors.length === 1 ? '' : 's'}):`
      );
      for (const e of validationErrors) console.error(`  • ${e}`);
      process.exit(1);
    }

    await migrate(db, { migrationsFolder });

    console.log('Migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    // Close the connection
    await migrationClient.end();
  }

  process.exit(0);
}

runMigrations();
