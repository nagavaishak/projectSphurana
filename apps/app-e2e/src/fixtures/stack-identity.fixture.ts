import fs from 'node:fs';
import path from 'node:path';

/**
 * Which stack are we talking to?
 *
 * With ~90 worktrees sharing one machine, `API_URL=http://localhost:3000`
 * names a PORT, not a branch. If another worktree owns that port, the suite
 * runs green-or-red against someone else's api and database, and every failure
 * reads as an application bug: sign-ups say "already exists" (their database
 * has the user), seeded orgs are invisible (we seeded ours), a migration under
 * test "didn't apply" (it applied — to a database nobody is querying).
 *
 * `local-stack up` stamps EXPECT_DB_NAME / EXPECT_WORKTREE into
 * apps/app-e2e/.env.test, and `GET /health/identity` reports what the api
 * actually has. One comparison, before the first spec, turns a lost afternoon
 * into one line of output.
 *
 * Both stamps are absent on staging / preview / CI, where the check is skipped:
 * there is no per-worktree namespace to assert there.
 */
export interface StackIdentity {
  sha: string;
  version: string;
  database: string | null;
  redisDb: number | null;
  apiUrl: string | null;
  webUrl: string | null;
  cwd: string;
  pid: number;
}

export const fetchStackIdentity = async (
  apiUrl: string
): Promise<StackIdentity | null> => {
  try {
    const res = await fetch(`${apiUrl}/health/identity`);
    return res.ok ? ((await res.json()) as StackIdentity) : null;
  } catch {
    return null;
  }
};

/**
 * Throws with the mismatch NAMED. Returns the identity when it checks out, or
 * null when there is nothing to check (no stamps ⇒ not a local-stack run).
 */
export const assertStackIdentity = async (): Promise<StackIdentity | null> => {
  const expectedDb = process.env.EXPECT_DB_NAME;
  const expectedWorktree = process.env.EXPECT_WORKTREE;
  if (!expectedDb) return null;

  const apiUrl = process.env.API_URL || 'http://localhost:3000';
  const identity = await fetchStackIdentity(apiUrl);

  if (!identity) {
    throw new Error(
      [
        `[preflight] nothing usable answered ${apiUrl}/health/identity.`,
        `  Expected this worktree's api (db ${expectedDb}).`,
        '  Start it with: node scripts/local-stack.mjs up',
      ].join('\n')
    );
  }

  if (identity.database !== expectedDb) {
    throw new Error(
      [
        `[preflight] ${apiUrl} is the WRONG STACK.`,
        `  expected db ${expectedDb}`,
        `  got      db ${identity.database}`,
        `  that api was started from ${identity.cwd}`,
        expectedWorktree
          ? `  this suite belongs to    ${expectedWorktree}`
          : '',
        '',
        '  Another worktree owns this port. Run `node scripts/local-stack.mjs down`',
        '  there, then `node scripts/local-stack.mjs up` here.',
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  return identity;
};

/**
 * And the OTHER half of the same question: is the SPA on BASE_URL ours, and is
 * it pointed at OUR api?
 *
 * `/api/runtime-config` is what the browser itself reads to decide where to
 * send requests, so asserting on it checks the value the app will really use —
 * not the one we believe we exported. This is the check that catches a stale
 * apps/app/.env (vite's loadEnv lets the FILE win over process.env, so a stale
 * API_URL there silently outranks whatever started the server) and a vite that
 * landed on a neighbouring port while every config still said 5173.
 */
export const assertAppServerIsOurs = async (): Promise<void> => {
  if (!process.env.EXPECT_DB_NAME) return;
  const baseUrl = process.env.BASE_URL || 'http://localhost:5173';
  const apiUrl = process.env.API_URL || 'http://localhost:3000';

  let config: { apiUrl?: string; appUrl?: string } | null = null;
  let broken: string | null = null;
  try {
    const res = await fetch(`${baseUrl}/api/runtime-config`);
    if (res.ok)
      config = (await res.json()) as { apiUrl?: string; appUrl?: string };
    // An answer that is an ERROR is a misconfigured stack, not an absent one,
    // and its body names the missing variable. Reporting it as "no app served"
    // would send the reader looking for a dead server instead.
    else broken = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
  } catch {
    config = null;
  }

  if (broken) {
    throw new Error(
      [
        `[preflight] the app on ${baseUrl} cannot build its runtime config.`,
        `  ${broken}`,
        '  Re-seed the env with: node scripts/local-stack.mjs env --force',
      ].join('\n')
    );
  }

  if (!config) {
    throw new Error(
      [
        `[preflight] no app served ${baseUrl}/api/runtime-config.`,
        "  Start this worktree's stack with: node scripts/local-stack.mjs up",
      ].join('\n')
    );
  }

  const mismatches = [
    config.apiUrl !== apiUrl
      ? `  the app calls api ${config.apiUrl} — this suite talks to ${apiUrl}`
      : '',
    config.appUrl !== baseUrl
      ? `  the app believes it is served at ${config.appUrl} — we loaded it from ${baseUrl}`
      : '',
  ].filter(Boolean);

  if (mismatches.length) {
    throw new Error(
      [
        `[preflight] the app on ${baseUrl} is NOT this stack's:`,
        ...mismatches,
        '',
        '  Usually a stale apps/app/.env (vite loads env FILES over process.env)',
        '  or another worktree holding the port. `node scripts/local-stack.mjs up`',
        '  regenerates apps/app/.env.local, which outranks it.',
      ].join('\n')
    );
  }
};

/**
 * A stored session outlives the stack that minted it. `.auth/bare-user.json`
 * against a rebuilt (or simply different) database is a cookie for a session
 * row that no longer exists — 401 on every request, in 40 specs at once, with
 * nothing in the output naming the cause.
 *
 * So each auth file gets a sidecar recording WHICH stack minted it. A run whose
 * identity differs deletes the pair rather than handing out a dead token.
 * (Sidecar, not a field inside the file: Playwright parses storageState itself
 * and unknown keys are not part of its contract.)
 */
const stampPath = (authFile: string) =>
  path.join(
    path.dirname(authFile),
    `${path.basename(authFile, '.json')}.stack.json`
  );

export const writeAuthStamp = (authFile: string, identity: StackIdentity) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(
    stampPath(authFile),
    JSON.stringify(
      {
        database: identity.database,
        apiUrl: process.env.API_URL ?? null,
        baseUrl: process.env.BASE_URL ?? null,
        mintedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
};

/** Stamp the auth file the current run just produced, if we can identify the stack. */
export const stampAuthFile = async (authFile: string) => {
  const apiUrl = process.env.API_URL || 'http://localhost:3000';
  const identity = await fetchStackIdentity(apiUrl);
  if (identity) writeAuthStamp(authFile, identity);
};

/**
 * Drop auth files minted against a different stack. Called from globalSetup, so
 * it lands before any project reads storageState — including under
 * PW_SKIP_DEPS, where the setup projects that would re-mint the file don't run
 * and Playwright's own "storageState file not found" is the honest next error.
 */
export const invalidateStaleAuthState = (
  identity: StackIdentity,
  authFiles: string[]
) => {
  for (const authFile of authFiles) {
    if (!fs.existsSync(authFile)) continue;
    const stamp = stampPath(authFile);
    const recorded = fs.existsSync(stamp)
      ? (JSON.parse(fs.readFileSync(stamp, 'utf8')) as {
          database?: string | null;
          apiUrl?: string | null;
        })
      : null;

    const matches =
      recorded?.database === identity.database &&
      recorded?.apiUrl === (process.env.API_URL ?? null);
    if (matches) continue;

    console.log(
      `[preflight] discarding ${authFile} — minted against ${
        recorded?.database ?? 'an unrecorded stack'
      }, this run is ${identity.database}`
    );
    fs.rmSync(authFile, { force: true });
    fs.rmSync(stamp, { force: true });
  }
};
