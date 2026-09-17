// Unit test for TestingService.createOrg — the pure-API org provisioner behind
// the `/testing/create-org` endpoint + `createEmptyVerifiedOrg` SeedHelper.
//
// testing.service.ts has a deep transitive import graph (auth/server → email →
// ESM-only @t3-oss/env-core, the features barrels → cuid2, redis, etc.) that
// swc-jest can't transform. We stub every heavy module at module-init (same
// idiom as testing.controller.spec.ts / memories.controller.spec.ts), but keep
// `zod` and `@borradh-workspace/labels` real so the createOrgSchema validation
// runs for real, and provide a working `withSystemScope` + chainable mock db so
// createOrg's inserts execute against the mock.

// A chainable mock connection. Each terminal (`.limit`, `.returning`,
// `.onConflictDoNothing`) resolves to whatever the test queued via the
// per-method mocks below.
const userSelectLimit = jest.fn();
const orgInsertReturning = jest.fn();
// Shared terminal for BOTH `.onConflictDoNothing()` inserts createOrg makes —
// the owner `member` row and the primary `organization_location` row. Assert on
// `mockConn.values` when you need to tell the two apart.
const memberInsertOnConflict = jest.fn();

// createOrg runs TWO `.limit(1)` selects — the owning-user existence check and
// `ensurePrimaryLocation`'s "does this org already have a branch" probe. They
// share a terminal, so the mock routes on the table passed to `.from()`;
// without that the location probe reads the user row, concludes a branch
// already exists, and silently skips the insert under test.
const locationSelectLimit = jest.fn();
// Routed on a MARKER PROPERTY rather than object identity: jest hoists the
// `jest.mock` factories above every top-level `const`, so a shared table object
// declared here is still in its temporal dead zone when the schema factory runs.
let selectedTable: unknown;
const isLocationTable = (table: unknown) =>
  (table as { __table?: string } | null)?.__table === 'organization_location';

const mockConn = {
  select: jest.fn(() => mockConn),
  from: jest.fn((table: unknown) => {
    selectedTable = table;
    return mockConn;
  }),
  where: jest.fn(() => mockConn),
  limit: (...args: unknown[]) =>
    isLocationTable(selectedTable)
      ? locationSelectLimit(...args)
      : userSelectLimit(...args),
  insert: jest.fn(() => mockConn),
  values: jest.fn(() => mockConn),
  returning: (...args: unknown[]) => orgInsertReturning(...args),
  onConflictDoNothing: (...args: unknown[]) => memberInsertOnConflict(...args),
};

jest.mock(
  '@borradh-workspace/database',
  () => ({
    db: {},
    // Run the callback with the mock connection — mirrors the real
    // withSystemScope({ db }) signature createOrg uses.
    withSystemScope: (fn: (conn: unknown) => unknown) => fn(mockConn),
    eq: jest.fn(() => 'eq-cond'),
    desc: jest.fn(() => 'desc'),
    inArray: jest.fn(() => 'in-array'),
    like: jest.fn(() => 'like'),
    runWithRlsContext: (_ctx: unknown, fn: () => unknown) => fn(),
  }),
  { virtual: true }
);

// Schema tables are only referenced as column-holders; plain objects suffice.
jest.mock(
  '@borradh-workspace/database/schema',
  () => ({
    asset: {},
    contentBatch: {},
    contentItem: {},
    conversation: {},
    conversationMessage: {},
    graphic: {},
    member: {},
    metaAdsIntegration: {},
    metaAdsPage: {},
    organization: { id: 'organization.id' },
    organizationLocation: { __table: 'organization_location' },
    subscriptions: {},
    user: { id: 'user.id', email: 'user.email' },
    verification: {},
    video: {},
    whatsappAccount: {},
  }),
  { virtual: true }
);

jest.mock('@borradh-workspace/env/api', () => ({ apiEnv: {} }));

jest.mock('@borradh-workspace/auth/server', () => ({ auth: { api: {} } }), {
  virtual: true,
});

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock('@borradh-workspace/redis', () => ({ getRedis: jest.fn() }), {
  virtual: true,
});

jest.mock(
  '@borradh-workspace/integrations',
  () => ({
    encryptCredentials: jest.fn(),
  }),
  { virtual: true }
);

// Feature barrels the service imports at module-init. We never call them in the
// createOrg path, so empty stubs are enough.
jest.mock(
  '@borradh-workspace/features/appointments',
  () => ({ createAppointment: jest.fn() }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/features/assistant',
  () => ({ createConversation: jest.fn() }),
  { virtual: true }
);
jest.mock('@borradh-workspace/features/auth', () => ({ signIn: jest.fn() }), {
  virtual: true,
});
jest.mock(
  '@borradh-workspace/features/content-batches',
  () => ({ generateMonthlyBatch: jest.fn() }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/features/conversations',
  () => ({ handleIncomingMessage: jest.fn() }),
  { virtual: true }
);

// runHeadlessTurn lives behind the assistant barrel (→ heavy deps). Stub it.
jest.mock('../assistant/index.js', () => ({ runHeadlessTurn: jest.fn() }));

// processClaireWhatsappTurn drags in the whole Claire turn pipeline (claire
// tools → classify-business schema → database enums). Not used by createOrg.
jest.mock('../chatbot-worker/claire-whatsapp-turn.process.js', () => ({
  processClaireWhatsappTurn: jest.fn(),
}));

import { TestingService } from './testing.service.js';

describe('TestingService.createOrg', () => {
  let service: TestingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TestingService();
    // Default: the owning user exists.
    userSelectLimit.mockResolvedValue([{ id: 'user-123' }]);
    orgInsertReturning.mockResolvedValue([{ id: 'org-abc' }]);
    memberInsertOnConflict.mockResolvedValue(undefined);
    // Default: the org has no branch yet, so ensurePrimaryLocation inserts one.
    locationSelectLimit.mockResolvedValue([]);
  });

  it('creates a verified org and returns its id for valid input', async () => {
    const result = await service.createOrg({
      userId: 'user-123',
      name: 'E2E Connected Org',
      businessType: 'salon',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      organizationId: 'org-abc',
      userId: 'user-123',
    });
    // Org row, then the owner member and the primary location (both of which
    // terminate in `.onConflictDoNothing()`).
    expect(orgInsertReturning).toHaveBeenCalledTimes(1);
    expect(memberInsertOnConflict).toHaveBeenCalledTimes(2);
  });

  it('does not add a second location when the org already has one', async () => {
    locationSelectLimit.mockResolvedValue([{ id: 'loc-existing' }]);

    await service.createOrg({ userId: 'user-123', name: 'E2E Org' });

    const locationRow = mockConn.values.mock.calls
      .map(([row]) => row as Record<string, unknown>)
      .find((row) => row && 'addressLine1' in row);

    expect(locationRow).toBeUndefined();
    // Org + member only.
    expect(memberInsertOnConflict).toHaveBeenCalledTimes(1);
  });

  // A seeded org with no location is not a thin org, it is an unusable one:
  // every branch-scoped surface lives under `/dashboard/l/:branch/…`, so with
  // no branch to resolve the calendar, sales, catalog, clients, marketing and
  // team surfaces render nothing at all. A real org cannot reach that state —
  // the onboarding wizard's locations step will not advance without one — and a
  // seeded org never runs the wizard, so createOrg has to supply it.
  it('seeds a primary location so branch-scoped routes can resolve', async () => {
    await service.createOrg({ userId: 'user-123', name: 'E2E Org' });

    const locationRow = mockConn.values.mock.calls
      .map(([row]) => row as Record<string, unknown>)
      .find((row) => row && 'addressLine1' in row);

    expect(locationRow).toBeDefined();
    expect(locationRow).toMatchObject({
      organizationId: 'org-abc',
      isPrimary: true,
      // GEOCODED, not just present. A campaign takes its radius centre from
      // the branch, and `resolveCampaignLocation` refuses a branch it cannot
      // place on a map — so a seeded branch without coordinates silently makes
      // every ads e2e fail with "we could not place … on the map". Pinned here
      // because that failure surfaces three lanes away from its cause.
      latitude: 53.3498,
      longitude: -6.2603,
      // `branchHandle()` prefers the slug over the id, so a fixed slug is what
      // gives seeded orgs a stable `/dashboard/l/main/…` instead of a per-run
      // cuid. Slugs are unique PER ORG, so every seeded org can use this one.
      slug: 'main',
    });
  });

  it('defaults businessType when omitted', async () => {
    const result = await service.createOrg({
      userId: 'user-123',
      name: 'No Business Type Org',
    });

    expect(result.success).toBe(true);
    expect(result.data?.organizationId).toBe('org-abc');
  });

  it('returns a validation error for an empty name (no DB write)', async () => {
    const result = await service.createOrg({
      userId: 'user-123',
      name: '',
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invalid input/i);
    expect(result.message).toMatch(/name is required/i);
    expect(orgInsertReturning).not.toHaveBeenCalled();
    expect(memberInsertOnConflict).not.toHaveBeenCalled();
  });

  it('returns a validation error for a missing userId (no DB write)', async () => {
    const result = await service.createOrg({
      userId: '',
      name: 'Some Org',
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invalid input/i);
    expect(result.message).toMatch(/userId is required/i);
    expect(orgInsertReturning).not.toHaveBeenCalled();
  });

  it('returns a validation error for an invalid businessType (no DB write)', async () => {
    const result = await service.createOrg({
      userId: 'user-123',
      name: 'Bad Type Org',
      businessType: 'not-a-real-business-type',
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invalid input/i);
    expect(orgInsertReturning).not.toHaveBeenCalled();
  });

  it('fails clearly when the owning user does not exist', async () => {
    userSelectLimit.mockResolvedValue([]); // user lookup returns nothing

    const result = await service.createOrg({
      userId: 'ghost-user',
      name: 'Orphan Org',
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/user not found/i);
    expect(orgInsertReturning).not.toHaveBeenCalled();
  });
});
