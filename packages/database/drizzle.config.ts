import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './dist/schema/index.js',
  out: './drizzle',
  // Never let drizzle-kit manage (create/alter/DROP) database roles. The RLS
  // roles (app_authenticated, app_public, app_system) are provisioned by the
  // hand-written roles migration and referenced in schema via
  // pgRole('…').existing(). Without this, drizzle-kit would try to drop roles
  // it doesn't see declared. See docs/rls/rls-implementation-plan.md §2.
  entities: { roles: false },
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: DATABASE_URL is required for drizzle-kit
    url: process.env.DATABASE_URL!,
  },
});
