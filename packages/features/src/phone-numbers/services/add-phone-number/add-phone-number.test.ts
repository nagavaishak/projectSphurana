import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { addPhoneNumber } from './add-phone-number.service.js';

describe('addPhoneNumber', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('should add a phone number with valid input', async () => {
    const input = {
      organizationId: 'org-1',
      number: '+353891234567',
      label: 'Main Line',
      countryCode: 'IE',
    };

    const mockResult = {
      id: 'pn-1',
      organizationId: 'org-1',
      number: '+353891234567',
      label: 'Main Line',
      provider: 'manual',
      providerNumberId: null,
      status: 'active',
      supportsOutbound: true,
      countryCode: 'IE',
    };

    mockDb.returning.mockResolvedValueOnce([mockResult]);

    const result = await addPhoneNumber(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.number).toBe('+353891234567');
      expect(result.data.provider).toBe('manual');
      expect(result.data.status).toBe('active');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should add a phone number without optional fields', async () => {
    const input = {
      organizationId: 'org-1',
      number: '+353891234567',
    };

    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'pn-2',
        organizationId: 'org-1',
        number: '+353891234567',
        label: null,
        provider: 'manual',
        status: 'active',
        countryCode: null,
      },
    ]);

    const result = await addPhoneNumber(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.label).toBeNull();
      expect(result.data.countryCode).toBeNull();
    }
  });

  it('should return VALIDATION_ERROR for empty number', async () => {
    const result = await addPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
      number: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const result = await addPhoneNumber(mockDb as never, {
      organizationId: '',
      number: '+353891234567',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for invalid countryCode length', async () => {
    const result = await addPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
      number: '+353891234567',
      countryCode: 'IRL',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  // `phone_number` has no unique constraint, so a duplicate insert cannot
  // raise 23505 — any DB failure here is a genuine INTERNAL_ERROR, never
  // ALREADY_EXISTS (ENG-844).
  it('should return INTERNAL_ERROR when the insert fails', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('insert failed'));

    const result = await addPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
      number: '+353891234567',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should return INTERNAL_ERROR on unexpected DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('Connection terminated'));

    const result = await addPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
      number: '+353891234567',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
