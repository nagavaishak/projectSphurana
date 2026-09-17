// Unit test for TestingService.provisionOrg's sign-up handling — the fix for the
// tabs-suite "User not found" mass failure.
//
// ROOT CAUSE (PR #633 regression). provisionOrg used to treat ANY sign-up
// failure as "email already exists, reconcile it" and proceed to forceVerifyUser
// (UPDATE user WHERE email). When sign-up fails for a reason OTHER than a
// duplicate — e.g. an E2E email whose local-part exceeds the 64-char limit that
// #639's validator DETERMINISTICALLY rejects — forceVerifyUser finds no row and
// returns the misleading `User not found: <email>`, reddening the whole suite.
// The fix distinguishes the two: a duplicate takes the reconcile path; any other
// failure surfaces the REAL sign-up error LOUDLY, before ever reaching
// forceVerifyUser. (An earlier revision of this PR retried, on the theory the
// failure was transient — it is not; it is deterministic, so the retry is gone.)
//
// testing.service.ts has a deep transitive import graph swc-jest can't transform,
// so we stub every heavy module at module-init (same idiom as
// testing.service.create-org.spec.ts) and drive provisionOrg by mocking `signUp`
// + spying on the service's own downstream helpers.

const mockConn = {
  select: jest.fn(() => mockConn),
  from: jest.fn(() => mockConn),
  where: jest.fn(() => mockConn),
  limit: jest.fn(() => Promise.resolve([])),
  insert: jest.fn(() => mockConn),
  values: jest.fn(() => mockConn),
  update: jest.fn(() => mockConn),
  set: jest.fn(() => mockConn),
  returning: jest.fn(() => Promise.resolve([])),
  onConflictDoNothing: jest.fn(() => Promise.resolve(undefined)),
  onConflictDoUpdate: jest.fn(() => Promise.resolve(undefined)),
};

jest.mock(
  '@borradh-workspace/database',
  () => ({
    db: {},
    withSystemScope: (fn: (conn: unknown) => unknown) => fn(mockConn),
    eq: jest.fn(() => 'eq-cond'),
    and: jest.fn(() => 'and-cond'),
    desc: jest.fn(() => 'desc'),
    inArray: jest.fn(() => 'in-array'),
    like: jest.fn(() => 'like'),
    lt: jest.fn(() => 'lt'),
    sql: jest.fn(() => 'sql'),
    runWithRlsContext: (_ctx: unknown, fn: () => unknown) => fn(),
  }),
  { virtual: true }
);

jest.mock(
  '@borradh-workspace/database/schema',
  () => ({
    appointment: {},
    asset: {},
    contentBatch: {},
    contentItem: {},
    conversation: {},
    conversationMessage: {},
    graphic: {},
    member: {
      organizationId: 'member.organizationId',
      userId: 'member.userId',
    },
    metaAdsIntegration: {},
    metaAdsPage: {},
    organization: { id: 'organization.id' },
    // `ensurePrimaryLocation` selects and inserts against this; without it the
    // column reads are `undefined.x` and provisionOrg's try/catch turns the
    // TypeError into a bare `success: false`.
    organizationLocation: {
      id: 'organization_location.id',
      organizationId: 'organization_location.organization_id',
    },
    stripeConnectIntegration: {},
    subscriptions: { organizationId: 'subscriptions.organizationId' },
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
  () => ({ encryptCredentials: jest.fn(), GRAPH_API_BASE: 'https://graph' }),
  { virtual: true }
);

jest.mock('@borradh-workspace/labels', () => ({
  businessTypeValues: ['salon', 'spa', 'barbershop'],
}));

// The two feature helpers provisionOrg actually calls. `signUp` is what we drive
// per test; `signIn` is reached via createSession, which we spy over anyway.
const signUpMock = jest.fn();
jest.mock(
  '@borradh-workspace/features/auth',
  () => ({
    signIn: jest.fn(),
    signUp: (...args: unknown[]) => signUpMock(...args),
  }),
  { virtual: true }
);

// ErrorCodes is a plain string-enum record; keep it real-shaped so the service's
// `error.code === ErrorCodes.ALREADY_EXISTS` check works.
jest.mock(
  '@borradh-workspace/features/shared',
  () => ({
    ErrorCodes: {
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      NOT_FOUND: 'NOT_FOUND',
      ALREADY_EXISTS: 'ALREADY_EXISTS',
      UNAUTHORIZED: 'UNAUTHORIZED',
      FORBIDDEN: 'FORBIDDEN',
      CONFLICT: 'CONFLICT',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
  }),
  { virtual: true }
);

jest.mock(
  '@borradh-workspace/features/appointments',
  () => ({
    buildManageBookingUrl: jest.fn(),
    createAppointment: jest.fn(),
    issueManageToken: jest.fn(),
  }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/features/assistant',
  () => ({ createConversation: jest.fn(), resolveOwnerByPhone: jest.fn() }),
  { virtual: true }
);
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

jest.mock('../assistant/index.js', () => ({ runHeadlessTurn: jest.fn() }));
jest.mock('../chatbot-worker/claire-whatsapp-turn.process.js', () => ({
  processClaireWhatsappTurn: jest.fn(),
}));

import { TestingService } from './testing.service.js';

// A FeatureError-shaped failure Result the mocked signUp returns.
const signUpErr = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});
const signUpOk = () => ({
  success: true as const,
  data: {
    user: {
      id: 'u1',
      email: 'e2e.test.x@example.com',
      name: 'X',
      emailVerified: false,
    },
    session: { token: 'signup-tok' },
  },
});

const INPUT = {
  email: 'e2e.test.x@example.com',
  password: 'Password123!',
  name: 'X',
  orgName: 'X Org',
};

describe('TestingService.provisionOrg — sign-up error classification', () => {
  let service: TestingService;
  let forceVerifyUser: jest.SpyInstance;
  let createSession: jest.SpyInstance;
  let getOrganizationByEmail: jest.SpyInstance;
  let forceCreateSubscription: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TestingService();

    // Make every downstream step succeed so the test isolates the sign-up branch.
    forceVerifyUser = jest
      .spyOn(service, 'forceVerifyUser')
      .mockResolvedValue({ success: true, message: 'ok' });
    createSession = jest.spyOn(service, 'createSession').mockResolvedValue({
      success: true,
      token: 'session-tok',
      user: { id: 'u1', email: INPUT.email, name: 'X' },
      message: 'ok',
    });
    getOrganizationByEmail = jest
      .spyOn(service, 'getOrganizationByEmail')
      .mockResolvedValue({
        success: true,
        organizationId: 'org-1',
        userId: 'u1',
        message: 'ok',
      });
    forceCreateSubscription = jest
      .spyOn(service, 'forceCreateSubscription')
      .mockResolvedValue({ success: true, message: 'ok' });
  });

  it('provisions on a successful sign-up (no "User not found")', async () => {
    signUpMock.mockResolvedValue(signUpOk());

    const result = await service.provisionOrg(INPUT);

    expect(signUpMock).toHaveBeenCalledTimes(1); // one call, no retry
    expect(result.success).toBe(true);
    expect(result.data?.organizationId).toBe('org-1');
    expect(result.message).not.toMatch(/user not found/i);
    // Reached the downstream verify flow.
    expect(forceVerifyUser).toHaveBeenCalledWith(INPUT.email);
  });

  it('reconciles a duplicate (ALREADY_EXISTS) via forceVerifyUser, no error', async () => {
    signUpMock.mockResolvedValue(
      signUpErr('ALREADY_EXISTS', 'User with this email already exists')
    );

    const result = await service.provisionOrg(INPUT);

    expect(signUpMock).toHaveBeenCalledTimes(1); // one call, no retry
    expect(result.success).toBe(true);
    // Reconcile proceeds through the existing downstream flow.
    expect(forceVerifyUser).toHaveBeenCalledWith(INPUT.email);
    expect(createSession).toHaveBeenCalled();
  });

  it('surfaces a non-duplicate sign-up failure LOUDLY — no forceVerifyUser', async () => {
    // The real cause: #639's validator rejects the over-long E2E email. This is
    // deterministic, NOT transient — a single failing call, surfaced immediately.
    const realError = 'Please use a valid, non-disposable email address.';
    signUpMock.mockResolvedValue(signUpErr('VALIDATION_ERROR', realError));

    const result = await service.provisionOrg(INPUT);

    expect(signUpMock).toHaveBeenCalledTimes(1); // no retry
    expect(result.success).toBe(false);
    expect(result.message).toBe(
      `provisionOrg: sign-up failed for ${INPUT.email}: ${realError}`
    );
    expect(result.message).toContain(realError); // the underlying cause
    expect(result.message).not.toMatch(/user not found/i);
    // Crucially, it never reached the step that produced the bogus "User not
    // found" — it surfaced the real sign-up error instead.
    expect(forceVerifyUser).not.toHaveBeenCalled();
    expect(getOrganizationByEmail).not.toHaveBeenCalled();
    expect(forceCreateSubscription).not.toHaveBeenCalled();
  });
});
