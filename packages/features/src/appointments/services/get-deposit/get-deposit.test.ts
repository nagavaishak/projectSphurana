import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getDeposit } from './get-deposit.service.js';

describe('getDeposit', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const mockDeposit = {
    id: 'dep_123',
    appointmentId: 'appt_123',
    organizationId: 'org_123',
    amountCents: 5000,
    currency: 'usd',
    status: 'pending',
    stripeCheckoutSessionId: 'cs_123',
    stripeConnectedAccountId: 'acct_123',
    checkoutUrl: 'https://checkout.stripe.com/cs_123',
    createdAt: new Date('2024-03-15T10:00:00Z'),
  };

  it('should return deposit when found by depositId', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      mockDeposit
    );

    const result = await getDeposit(mockDb as never, {
      depositId: 'dep_123',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('dep_123');
      expect(result.data.amountCents).toBe(5000);
    }
  });

  it('should return deposit when found by appointmentId', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      mockDeposit
    );

    const result = await getDeposit(mockDb as never, {
      appointmentId: 'appt_123',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.appointmentId).toBe('appt_123');
    }
  });

  it('should return NOT_FOUND when deposit does not exist by depositId', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getDeposit(mockDb as never, {
        depositId: 'dep_nonexistent',
        organizationId: 'org_123',
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Deposit not found');
    });
  });

  it('should return NOT_FOUND when deposit does not exist by appointmentId', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getDeposit(mockDb as never, {
        appointmentId: 'appt_nonexistent',
        organizationId: 'org_123',
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  it('should return VALIDATION_ERROR when neither depositId nor appointmentId is provided', async () => {
    await expectResult(
      getDeposit(mockDb as never, { organizationId: 'org_123' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.appointmentDeposit.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      getDeposit(mockDb as never, { depositId: 'dep_123', organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.appointmentDeposit.findFirst).not.toHaveBeenCalled();
  });

  it('should not return deposit from different organization', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getDeposit(mockDb as never, {
        depositId: 'dep_123',
        organizationId: 'different_org',
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
    });
  });

  it('should prefer depositId lookup when both are provided', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      mockDeposit
    );

    const result = await getDeposit(mockDb as never, {
      depositId: 'dep_123',
      appointmentId: 'appt_123',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    // Only one findFirst call should be made (depositId branch)
    expect(mockDb.query.appointmentDeposit.findFirst).toHaveBeenCalledTimes(1);
  });
});
