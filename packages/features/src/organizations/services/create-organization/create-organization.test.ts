import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE module, not the `create-default-sequence/index.js` barrel —
// barrel re-exports are live getters and `vi.spyOn` cannot redefine them.
import * as createDefaultSequenceModule from '../../../sequences/services/create-default-sequence/create-default-sequence.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { createOrganization } from './create-organization.service.js';

// A restored `vi.spyOn`, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module silently MISSES
// whenever some earlier file already imported the real module, and its bare
// factory poisons that module for every later file.
let mockCreateDefaultSequence: MockInstance;

describe('createOrganization', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Reset returning mock properly (mockClear doesn't clear mockResolvedValueOnce queue)
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
    mockCreateDefaultSequence = vi
      .spyOn(createDefaultSequenceModule, 'createDefaultSequence')
      .mockResolvedValue({ success: true, data: {} } as never);
  });

  afterEach(() => {
    mockCreateDefaultSequence.mockRestore();
  });

  const validInput = {
    name: 'My Salon',
    businessType: 'salon' as const,
    createdByUserId: 'user_123',
  };

  const existingUser = {
    id: 'user_123',
    email: 'test@example.com',
    name: 'Test User',
    createdAt: new Date(),
  };

  it('should create organization with valid input', async () => {
    const mockOrg = {
      id: 'org_123',
      name: validInput.name,
      slug: 'my-salon',
      logo: null,
      businessType: validInput.businessType,
      websiteUrl: null,
      facebookPageUrl: null,
      brandVoice: [],
      targetAudienceDescription: null,
      credibilityLine: null,
      primaryColor: null,
      secondaryColor: null,
      contentStyleTemplate: 'clean_minimal',
      outroStyle: 'tagline',
      businessHours: null,
      depositEnabled: false,
      depositAmount: null,
      createdAt: new Date(),
    };

    // Mock: user exists
    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    // Mock: slug doesn't exist
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);
    // Mock: insert org returns created org (member insert doesn't call .returning())
    mockDb.returning.mockResolvedValueOnce([mockOrg]);

    const result = await createOrganization(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe(validInput.name);
      expect(result.data.businessType).toBe(validInput.businessType);
      expect(result.data.slug).toBe('my-salon');
    }
    expect(mockCreateDefaultSequence).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when user does not exist', async () => {
    mockDb.query.user.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createOrganization(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toContain(validInput.createdByUserId);
    });
  });

  it('should return VALIDATION_ERROR for missing name', async () => {
    const invalidInput = {
      ...validInput,
      name: '',
    };

    await expectResult(
      createOrganization(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing businessType', async () => {
    const invalidInput = {
      ...validInput,
      businessType: undefined,
    };

    await expectResult(
      createOrganization(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid businessType', async () => {
    const invalidInput = {
      ...validInput,
      businessType: 'invalid_type',
    };

    await expectResult(
      createOrganization(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid websiteUrl', async () => {
    const invalidInput = {
      ...validInput,
      websiteUrl: 'not-a-url',
    };

    await expectResult(
      createOrganization(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should generate unique slug when slug already exists', async () => {
    const existingOrg = { id: 'existing_org', slug: 'my-salon' };
    const mockOrg = {
      id: 'org_123',
      name: validInput.name,
      slug: 'my-salon-abcd1234',
      logo: null,
      businessType: validInput.businessType,
      websiteUrl: null,
      facebookPageUrl: null,
      brandVoice: [],
      targetAudienceDescription: null,
      credibilityLine: null,
      primaryColor: null,
      secondaryColor: null,
      contentStyleTemplate: 'clean_minimal',
      outroStyle: 'tagline',
      businessHours: null,
      depositEnabled: false,
      depositAmount: null,
      createdAt: new Date(),
    };

    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    // Only org insert calls .returning() - member insert does not
    mockDb.returning.mockResolvedValueOnce([mockOrg]);

    const result = await createOrganization(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).not.toBe('my-salon');
      expect(result.data.slug).toContain('my-salon-');
    }
  });

  it('should create organization with optional brand settings', async () => {
    const inputWithBrand = {
      ...validInput,
      primaryColor: '#FF5733',
      secondaryColor: '#33FF57',
      contentStyleTemplate: 'bold_energetic' as const,
    };

    const mockOrg = {
      id: 'org_123',
      name: inputWithBrand.name,
      slug: 'my-salon',
      logo: null,
      businessType: inputWithBrand.businessType,
      websiteUrl: null,
      facebookPageUrl: null,
      brandVoice: [],
      targetAudienceDescription: null,
      credibilityLine: null,
      primaryColor: inputWithBrand.primaryColor,
      secondaryColor: inputWithBrand.secondaryColor,
      contentStyleTemplate: inputWithBrand.contentStyleTemplate,
      outroStyle: 'tagline',
      businessHours: null,
      depositEnabled: false,
      depositAmount: null,
      createdAt: new Date(),
    };

    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);
    // Only org insert calls .returning() - member insert does not
    mockDb.returning.mockResolvedValueOnce([mockOrg]);

    const result = await createOrganization(mockDb as never, inputWithBrand);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryColor).toBe('#FF5733');
      expect(result.data.contentStyleTemplate).toBe('bold_energetic');
    }
  });

  it('should create organization with onboarding v2 fields', async () => {
    const inputWithV2Fields = {
      ...validInput,
      websiteUrl: 'https://mysalon.com',
      facebookPageUrl: 'https://facebook.com/mysalon',
      brandVoice: ['friendly', 'professional'],
      targetAudienceDescription: 'Young professionals aged 25-40',
      credibilityLine: '10+ years of experience',
    };

    const mockOrg = {
      id: 'org_123',
      name: inputWithV2Fields.name,
      slug: 'my-salon',
      logo: null,
      businessType: inputWithV2Fields.businessType,
      websiteUrl: inputWithV2Fields.websiteUrl,
      facebookPageUrl: inputWithV2Fields.facebookPageUrl,
      brandVoice: inputWithV2Fields.brandVoice,
      targetAudienceDescription: inputWithV2Fields.targetAudienceDescription,
      credibilityLine: inputWithV2Fields.credibilityLine,
      primaryColor: null,
      secondaryColor: null,
      contentStyleTemplate: 'clean_minimal',
      outroStyle: 'tagline',
      businessHours: null,
      depositEnabled: false,
      depositAmount: null,
      createdAt: new Date(),
    };

    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockOrg]);

    const result = await createOrganization(mockDb as never, inputWithV2Fields);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.websiteUrl).toBe('https://mysalon.com');
      expect(result.data.facebookPageUrl).toBe('https://facebook.com/mysalon');
      expect(result.data.brandVoice).toEqual(['friendly', 'professional']);
      expect(result.data.targetAudienceDescription).toBe(
        'Young professionals aged 25-40'
      );
      expect(result.data.credibilityLine).toBe('10+ years of experience');
    }
  });

  it('should return VALIDATION_ERROR for invalid hex color', async () => {
    const invalidInput = {
      ...validInput,
      primaryColor: 'not-a-hex-color',
    };

    await expectResult(
      createOrganization(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.user.findFirst.mockResolvedValueOnce(existingUser);
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    const result = await createOrganization(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
