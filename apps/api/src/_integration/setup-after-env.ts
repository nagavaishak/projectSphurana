/**
 * Per-worker setup, run by jest `setupFiles` (BEFORE the test framework and
 * before any test module is imported).
 *
 * Two jobs, in order:
 *  1. Load the repo-root `.env` so all the eager `createEnv()` calls in the
 *     env package (storage S3 buckets, auth secret, Meta creds, etc.) pass
 *     validation when the controllers' transitive imports load. Without this,
 *     importing a controller that reaches into @borradh-workspace/features →
 *     storage → storageEnv throws "Invalid environment variables" at import.
 *  2. Override DATABASE_URL with the testcontainer URL written by
 *     global-setup.ts (the real DB the tests run against). This MUST win over
 *     whatever DATABASE_URL is in .env, and it THROWS rather than falling
 *     back — see the note at the check. Falling back means seeding a real dev
 *     database while reporting green.
 *
 * Must be a `setupFiles` entry (not setupFilesAfterEach) so it runs before the
 * test file's top-level imports pull in the db / env modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// 1a. Load the committed dummy env first. This provides valid placeholder
//     values for every REQUIRED env var so the suite runs in CI where there is
//     no repo-root .env. Loaded with override:false (the default) so a local
//     dev .env can still win below.
const dummyEnv = path.resolve(__dirname, '../../.env.integration');
if (fs.existsSync(dummyEnv)) {
  dotenv.config({ path: dummyEnv });
}

// 1b. Load repo-root .env so local runs use real dev values (override the
//     dummies). Set INT_SKIP_ROOT_ENV=1 to skip this and reproduce the CI
//     "dummies only" environment locally.
if (!process.env.INT_SKIP_ROOT_ENV) {
  const repoRootEnv = path.resolve(__dirname, '../../../../.env');
  if (fs.existsSync(repoRootEnv)) {
    dotenv.config({ path: repoRootEnv, override: true });
  }
}

// 2. Override DATABASE_URL + REDIS_URL with the testcontainer URLs written by
//    global-setup.ts (must win over whatever .env / .env.integration set).
//
// MISSING FILE IS FATAL, and this is the whole point of the guard.
//
// Step 1b above has just loaded the repo-root `.env`, whose DATABASE_URL is a
// REAL local dev database. If the handoff file is absent and we simply fall
// through, the suite silently applies migrations to that database and seeds
// hundreds of fixture orgs into it — while reporting green, because nothing
// failed. That is not hypothetical: on 2026-08-25 it put 348 `Org org_<uuid>`
// orgs, 453 users and ~245 leads into the local `borradh` DB.
//
// The file goes missing whenever two integration runs overlap: the path is
// process-global and `global-teardown.ts` deletes it, so run A's teardown can
// remove it while run B is still spawning workers. Failing loudly turns a
// silent wrong-database write into an obvious "don't run two of these at once".
const urlFile = path.resolve(__dirname, '.int-db-url');
if (!fs.existsSync(urlFile)) {
  throw new Error(
    `[int-setup] ${path.basename(urlFile)} is missing, so DATABASE_URL would fall back to the repo-root .env — a REAL database. Refusing to run.
Most likely cause: another integration run is in progress (or just finished and deleted the file). This suite's containers are shared process-globally, so only one run may be in flight at a time.`
  );
}
process.env.DATABASE_URL = fs.readFileSync(urlFile, 'utf-8').trim();

// Redis is the same story, and a leaked run would enqueue jobs the local dev
// worker then picks up and actually processes.
const redisUrlFile = path.resolve(__dirname, '.int-redis-url');
if (!fs.existsSync(redisUrlFile)) {
  throw new Error(
    `[int-setup] ${path.basename(redisUrlFile)} is missing, so REDIS_URL would fall back to the repo-root .env — a REAL Redis. Refusing to run.`
  );
}
process.env.REDIS_URL = fs.readFileSync(redisUrlFile, 'utf-8').trim();

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

// 3. Force provider dry-run.
//
// The suite exercises real send paths (campaigns, Claire's first touch)
// against a real DB, and those end in a Twilio call. Without this the SMS
// client either throws on missing credentials — so every send silently
// "fails" and the assertions pass vacuously — or, where credentials happen to
// be present, sends a REAL text message. Neither belongs in a test run, so it
// is pinned here rather than left to whoever remembers the env var on the
// command line.
process.env.CAMPAIGNS_DRY_RUN = 'true';

// 4. The marketing origin, without which customer-facing links cannot be built.
//
// Booking, the customer portal and microsites are served by the MARKETING app,
// so every link into them is composed from MARKETING_URL — deliberately a hard
// error when unset, because the alternative is a plausible-looking URL on a
// host that serves none of those routes (ENG-770). A public booking submit
// mints a manage-booking link, so without this the whole endpoint 500s and the
// suite fails on an env gap rather than on the behaviour under test.
//
// A distinct host from WEB_URL on purpose: sharing one would let a builder
// reach for the wrong variable and still pass.
process.env.MARKETING_URL =
  process.env.MARKETING_URL ?? 'https://marketing.int-test.local';

// 5. Pin the platform-admin allow-list.
//
// `GlobalAdminGuard` and Better Auth's `admin()` plugin both read
// ADMIN_USER_IDS, and the plugin captures it at import — so it cannot be set
// from inside a test. Fixed here, AFTER the dotenv loads above, so a developer
// .env carrying real production admin ids can never leak into the suite.
// `auth-harness.ts` re-reads it rather than duplicating the literal.
process.env.ADMIN_USER_IDS = 'int_platform_admin_0000000000000';
