import { mockStripeConnectService } from '@borradh-workspace/integrations/stripe';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { initiateStripeConnect } from './initiate-stripe-connect.service.js';

const mockGenerateOAuthLink = vi.mocked(
  mockStripeConnectService.generateOAuthLink
);

describe('initiateStripeConnect', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockGenerateOAuthLink.mockReset();
  });

  const validInput = {
    organizationId: 'org-123',
    redirectUri: 'https://app.example.com/connect/stripe/callback',
    organizationEmail: 'business@example.com',
  };

  it('generates Stripe OAuth link successfully', async () => {
    mockGenerateOAuthLink.mockReturnValue({
      url: 'https://connect.stripe.com/oauth/authorize?client_id=xxx',
      state: 'org-123:some-uuid',
    });

    const result = await initiateStripeConnect(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toContain('stripe.com');
      expect(result.data.state).toContain('org-123');
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      initiateStripeConnect(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for invalid redirectUri', async () => {
    await expectResult(
      initiateStripeConnect(mockDb as never, {
        ...validInput,
        redirectUri: 'not-a-url',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns EXTERNAL_SERVICE_ERROR when CLIENT_ID not configured', async () => {
    mockGenerateOAuthLink.mockImplementation(() => {
      throw new Error('CLIENT_ID is not set');
    });

    await expectResult(
      initiateStripeConnect(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('returns INTERNAL_ERROR on unexpected failure', async () => {
    mockGenerateOAuthLink.mockImplementation(() => {
      throw new Error('Unexpected error');
    });

    await expectResult(
      initiateStripeConnect(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
