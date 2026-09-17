/**
 * Wiring test for API-6T. `public-return-url.spec.ts` proves the sanitiser is
 * correct; this proves the controller actually applies it, which is the half
 * that can silently regress (deleting the call leaves every unit test green).
 *
 * The account-link path cannot be covered by `payments-infra.int-spec.ts` —
 * that suite deliberately stops short of anything reaching real Stripe.
 */
// Mock the features barrel before importing the controller: it reaches
// ESM-only packages swc-jest can't transform. `virtual: true` because
// features' dist may be absent while a sibling window is mid-build.
jest.mock(
  '@borradh-workspace/features/integrations',
  () => ({
    createAccountLink: jest.fn(),
    createAccountSession: jest.fn(),
    getStripeConnectStatus: jest.fn(),
    refreshStripeAccount: jest.fn(),
  }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/features/shared',
  () => ({ ErrorCodes: { VALIDATION_ERROR: 'VALIDATION_ERROR' } }),
  { virtual: true }
);
jest.mock('@borradh-workspace/database', () => ({ db: {} }), { virtual: true });
jest.mock('../../common', () => ({
  ActiveOrganization: () => () => undefined,
  AuthGuard: class {},
  CurrentUser: () => () => undefined,
}));

const WEB_ORIGIN = 'https://app.borradh.test';
jest.mock('../../common/oauth/index.js', () => ({
  webOrigin: () => WEB_ORIGIN,
}));

import { createAccountLink } from '@borradh-workspace/features/integrations';
import { IntegrationsStripeController } from './stripe.controller.js';

const mockedCreateAccountLink = createAccountLink as jest.Mock;

describe('IntegrationsStripeController.accountLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateAccountLink.mockResolvedValue({
      success: true,
      data: { url: 'https://connect.stripe.com/setup/x', expiresAt: 1 },
    });
  });

  const call = (returnUrl: string, refreshUrl: string) =>
    new IntegrationsStripeController().accountLink(
      { returnUrl, refreshUrl } as never,
      'org-1',
      { id: 'user-1', email: 'o@example.com' }
    );

  it("rebases a stale native bundle's localhost origin before calling Stripe", async () => {
    // Verbatim shape an Android WebView on an old build posts.
    await call(
      'https://localhost/settings/payments?stripe=return',
      'capacitor://localhost/settings/payments?stripe=refresh'
    );

    expect(mockedCreateAccountLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        returnUrl: `${WEB_ORIGIN}/settings/payments?stripe=return`,
        refreshUrl: `${WEB_ORIGIN}/settings/payments?stripe=refresh`,
      })
    );
  });

  it('leaves a reachable origin exactly as the client sent it', async () => {
    const ret = 'https://app.borradh.io/settings/payments?stripe=return';
    const ref = 'https://app.borradh.io/settings/payments?stripe=refresh';

    await call(ret, ref);

    expect(mockedCreateAccountLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ returnUrl: ret, refreshUrl: ref })
    );
  });
});
