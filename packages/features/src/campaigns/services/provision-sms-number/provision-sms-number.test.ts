import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import type { SmsNumberProvider } from '../_shared/sms-number-provider.js';
import { provisionSmsNumber } from './provision-sms-number.service.js';

const ORG = 'org_1';
const NUMBER = '+353871234567';

function makeProvider(
  overrides: Partial<SmsNumberProvider> = {}
): SmsNumberProvider {
  return {
    listAvailableNumbers: vi.fn().mockResolvedValue([]),
    listOwnedNumbers: vi.fn().mockResolvedValue([]),
    provisionNumber: vi
      .fn()
      .mockResolvedValue({ sid: 'PN123', phoneNumber: NUMBER }),
    ...overrides,
  };
}

describe('provisionSmsNumber', () => {
  const mockDb = createMockDatabase();
  const db = mockDb as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const input = { organizationId: ORG, phoneNumber: NUMBER, country: 'IE' };

  it('buys the number and inserts an active org_sms_number', async () => {
    mockDb.query.orgSmsNumber.findFirst.mockResolvedValue(null); // no existing
    const row = {
      id: 'sms_1',
      organizationId: ORG,
      phoneNumber: NUMBER,
      status: 'active',
    };
    mockDb.returning.mockResolvedValueOnce([row]);
    const provider = makeProvider();

    const result = await provisionSmsNumber(db, input, provider);

    expect(provider.provisionNumber).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: NUMBER })
    );
    expect(mockDb.insert).toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('active');
  });

  it('attaches an already-owned number without buying', async () => {
    mockDb.query.orgSmsNumber.findFirst.mockResolvedValue(null);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'sms_1', phoneNumber: NUMBER, status: 'active' },
    ]);
    const provider = makeProvider({
      listOwnedNumbers: vi
        .fn()
        .mockResolvedValue([{ sid: 'PNowned', phoneNumber: NUMBER }]),
    });

    const result = await provisionSmsNumber(db, input, provider);

    expect(provider.provisionNumber).not.toHaveBeenCalled(); // no purchase
    expect(mockDb.insert).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('refuses to double-buy when an active number already exists', async () => {
    mockDb.query.orgSmsNumber.findFirst.mockResolvedValue({
      id: 'sms_1',
      status: 'active',
    });
    const provider = makeProvider();

    const result = await provisionSmsNumber(db, input, provider);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
    expect(provider.provisionNumber).not.toHaveBeenCalled();
  });

  it('overwrites a prior failed/released row instead of inserting', async () => {
    mockDb.query.orgSmsNumber.findFirst.mockResolvedValue({
      id: 'sms_old',
      status: 'failed',
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'sms_old', status: 'active', phoneNumber: NUMBER },
    ]);
    const provider = makeProvider();

    const result = await provisionSmsNumber(db, input, provider);

    expect(provider.provisionNumber).toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('returns INTERNAL_ERROR and does not write when the buy fails', async () => {
    mockDb.query.orgSmsNumber.findFirst.mockResolvedValue(null);
    const provider = makeProvider({
      provisionNumber: vi.fn().mockRejectedValue(new Error('Twilio 402')),
    });

    const result = await provisionSmsNumber(db, input, provider);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects an invalid phone number before calling Twilio', async () => {
    const provider = makeProvider();
    const result = await provisionSmsNumber(
      db,
      { organizationId: ORG, phoneNumber: 'not-a-number', country: 'IE' },
      provider
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(provider.provisionNumber).not.toHaveBeenCalled();
  });
});
