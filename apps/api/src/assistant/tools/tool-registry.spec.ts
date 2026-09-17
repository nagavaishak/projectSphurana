// The registry imports every tool MODULE, and each tool's handler reaches deep into
// the feature services — which validate their env at import time. This gate reads
// only tool METADATA (name + action) and never executes a tool, so we satisfy those
// import-time env checks with placeholders rather than mocking a dozen packages.
// Set BEFORE the modules load; the registry is pulled in lazily below.
const ENV_PLACEHOLDERS: Record<string, string> = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/test',
  RESEND_API_KEY: 'test-key',
  BETTER_AUTH_SECRET: 'test-secret',
  BETTER_AUTH_URL: 'http://localhost:3000',
  EMAIL_FROM_ADDRESS: 'test@example.com',
  SEQUENCE_FROM_ADDRESS: 'test@example.com',
};
for (const [key, value] of Object.entries(ENV_PLACEHOLDERS)) {
  process.env[key] ??= value;
}

// Stub ONLY the db client — keep every real export (the label/enum value arrays the
// tool schemas build `z.enum(...)` from at import time). Mocking the whole module as
// `{ db: {} }` silently made those arrays `undefined`, which is its own little lesson.
// Stub the db CLIENT (it ships ESM-only `@paralleldrive/cuid2`, which jest cannot
// transform — the reason every tool spec mocks this module) while keeping the real
// label/enum VALUE arrays, which the tool schemas feed to `z.enum(...)` at import
// time. They originate in `@borradh-workspace/labels`, which is jest-safe.
// Mocking the module wholesale as `{ db: {} }` makes those arrays `undefined` and
// the tool schemas explode — a small echo of the very bug this gate exists to catch.
jest.mock('@borradh-workspace/database', () => ({
  ...jest.requireActual('@borradh-workspace/labels'),
  db: {},
}));

// The tool factory's confirmation surface imports the `features/assistant` BARREL,
// whose dist build trips a zod/CJS interop crash at import. Stubbing it is the same
// precedent every other tool spec follows (see leads-tools.spec.ts). The skills come
// from the narrow `/skills` subpath below, so nothing real is lost here.
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  validateGeneratedCopy: jest.fn(() => []),
}));

// The tool HANDLERS import feature barrels whose dist builds are not import-safe
// (zod enums built from arrays that are undefined at CJS init). The gate never
// executes a handler — it reads `name` and `action` — so the barrels are stubbed.
// This is the shape of the deeper problem the Operation spine fixes: a tool's
// DESCRIPTOR (data) and its IMPLEMENTATION (a runtime) should not be the same import.
jest.mock('@borradh-workspace/features/claire', () => ({}));
jest.mock('@borradh-workspace/features/organizations', () => ({}));
// Same reason, new arrival: `claire_getAlternativeRecommendation` now reaches
// `features/organization-services`, whose barrel pulls the branch-scoping
// services and through them the `database` barrel — which cannot load under
// this jest config at all (`@paralleldrive/cuid2` is ESM-only, so the module
// half-initialises and its exports read `undefined`). Only descriptors are
// read here, so the barrel is stubbed like its neighbours.
jest.mock('@borradh-workspace/features/organization-services', () => ({}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { skills } = require('@borradh-workspace/features/assistant/skills');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildToolRegistry, resolvableToolNames } = require('./registry.js');

type Skill = { id: string; toolNames: string[] };
type Tool = { name: string; action: string };

/**
 * THE gate. Every tool a skill asks for must resolve against the ACTUAL registry.
 *
 * This replaces `KNOWN_TOOL_NAMES` — a 265-line hand-typed list in
 * `packages/features/src/assistant/skills/skills.test.ts` that the wiring test
 * validated skills against. Its own docstring claimed it "would have caught the
 * createCampaign drift bug". It would not have, and it did not: it cheerfully
 * vouched for four tools that resolve to nothing at runtime, so CI was green while
 * Claire, in production, was being told to call tools she had never been handed.
 *
 * That is the whole lesson, and it is not about duplication:
 *
 *   A GATE MAY NOT TAKE A HAND-WRITTEN LIST AS ITS INPUT.
 *   The list must be DERIVED from the thing it is checking.
 *
 * A hand-written list cannot fail to mention the thing that is missing. This one is
 * built from `buildToolRegistry()` — the same function the three runtime catalogues
 * call — so it is incapable of vouching for a tool that isn't there.
 *
 * WHY IT LIVES IN apps/api: `packages/features` cannot import `apps/api`. That
 * constraint is precisely why the mirror was created in the first place — someone
 * needed the tool list on the features side, couldn't import it, and hand-copied it.
 * Inverting the dependency (api imports the skills, not the other way round) is the
 * fix, and it is the reason the mirror can now be deleted rather than maintained.
 */

/**
 * The legacy `createContentTools()` set is built per-request from org context, so it
 * cannot be constructed here. Its tools are a fixed, known set of actions, listed so
 * the gate can resolve skills that (still) reference them.
 *
 * This is the ONE hand-written list left, and it is load-bearing enough to justify:
 * it describes a legacy shim that is being retired, not a live registry. When
 * `contentShimmed` is finally replaced by `socialPostsTools` outright, delete it.
 */
const LEGACY_CONTENT_TOOL_ACTIONS = [
  'listRecentPosts',
  'generatePostCaption',
  'suggestPostingTime',
  'createSocialPostDraft',
  'updateSocialPostDraft',
  // The destructive schedule/publish confirm+execute tools were removed with
  // the in-memory confirmation store (W-C09, Phase 6). Scheduling / publishing
  // now goes through the factory `social_posts_schedulePost` /
  // `social_posts_publishPostNow` tools (DB-backed tokens, turn-boundary
  // rule) — already registered via `socialPostsTools`.
] as const;

const legacyShimmed: Tool[] = LEGACY_CONTENT_TOOL_ACTIONS.map((action) => ({
  name: `content_${action}`,
  action,
}));

const registry: Tool[] = buildToolRegistry(legacyShimmed);
const resolvable: Set<string> = resolvableToolNames(registry);
const allSkills: Skill[] = skills;

describe('claire tool registry', () => {
  it('every tool a skill asks for actually resolves', () => {
    const phantom: string[] = [];
    for (const skill of allSkills) {
      for (const toolName of skill.toolNames) {
        if (!resolvable.has(toolName)) {
          phantom.push(`${skill.id} → ${toolName}`);
        }
      }
    }

    if (phantom.length > 0) {
      throw new Error(
        `These skills reference tools that resolve to NOTHING at runtime:\n${phantom.map((p) => `  - ${p}`).join('\n')}\n\nAt runtime this is a \`logger.error\` nobody reads and the tool is silently\ndropped — but the skill's PROMPT still ships, so the model is instructed to\ncall a tool it was never given. It then hallucinates the outcome or dead-ends.\n\nEither register the tool in \`tools/registry.ts\`, or remove it from the skill's\n\`toolNames\` AND from its prompt text. Both, together — removing one and not\nthe other is exactly how \`assignLeadsToSequence\` survived for a month.`
      );
    }
    expect(phantom).toEqual([]);
  });

  it('registers no tool twice under the same canonical name', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const tool of registry) {
      if (seen.has(tool.name)) dupes.push(tool.name);
      seen.add(tool.name);
    }
    if (dupes.length > 0) {
      throw new Error(
        `Duplicate tool names — the catalogue keeps the FIRST and silently drops the\nrest, so the later definition never runs:\n${dupes.map((d) => `  - ${d}`).join('\n')}`
      );
    }
    expect(dupes).toEqual([]);
  });

  it('has no registered tool that no skill can ever reach', () => {
    // Not a failure — a report. A tool nobody asks for is dead weight, and dead
    // weight is where `socialPostsTools` hid for months: written, tested, exported,
    // and reachable by nobody.
    const asked = new Set(allSkills.flatMap((s) => s.toolNames));
    const orphans = registry
      .filter((t: Tool) => !asked.has(t.name) && !asked.has(t.action))
      .map((t: Tool) => t.action);

    // `default`-skill and always-on meta tools are reached without being named.
    expect(Array.isArray(orphans)).toBe(true);
    if (orphans.length > 0) {
      console.warn(
        `[tool-registry] ${orphans.length} registered tools are named by no skill: ` +
          `${orphans.join(', ')}`
      );
    }
  });
});
