import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  type CdnDeps,
  generateCdnSignedCookies,
} from './generate-signed-cookies.service.js';

describe('generateCdnSignedCookies', () => {
  const mockCookies = {
    'CloudFront-Policy': 'policy-value',
    'CloudFront-Signature': 'sig-value',
    'CloudFront-Key-Pair-Id': 'key-pair-id',
  };

  const createMockCdnDeps = (overrides: Partial<CdnDeps> = {}): CdnDeps => ({
    isCdnEnabled: vi.fn().mockReturnValue(true),
    getCdnUrl: vi.fn().mockReturnValue('https://cdn.example.com'),
    generateSignedCookies: vi.fn().mockReturnValue(mockCookies),
    ...overrides,
  });

  let cdnDeps: CdnDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    cdnDeps = createMockCdnDeps();
  });

  const validInput = { organizationId: 'org_123' };

  it('should generate signed cookies in production', async () => {
    await expectResult(
      generateCdnSignedCookies(cdnDeps, validInput, true)
    ).toSucceedWith((data) => {
      expect(data.cookies).toEqual(mockCookies);
      expect(data.cdnUrl).toBe('https://cdn.example.com');
      expect(data.expiresIn).toBe(3600);
      expect(data.organizationId).toBe('org_123');
      expect(data.isProduction).toBe(true);
      expect(data.domain).toBe('.example.com');
    });
  });

  it('should return undefined domain in non-production', async () => {
    await expectResult(
      generateCdnSignedCookies(cdnDeps, validInput, false)
    ).toSucceedWith((data) => {
      expect(data.domain).toBeUndefined();
      expect(data.isProduction).toBe(false);
    });
  });

  it('should extract correct cookie domain for multi-level CDN URL', async () => {
    cdnDeps = createMockCdnDeps({
      getCdnUrl: vi.fn().mockReturnValue('https://cdn.app.borradh.io'),
    });

    await expectResult(
      generateCdnSignedCookies(cdnDeps, validInput, true)
    ).toSucceedWith((data) => {
      expect(data.domain).toBe('.borradh.io');
    });
  });

  it('should return NOT_CONFIGURED when CDN is not enabled', async () => {
    cdnDeps = createMockCdnDeps({
      isCdnEnabled: vi.fn().mockReturnValue(false),
    });

    await expectResult(
      generateCdnSignedCookies(cdnDeps, validInput, true)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_CONFIGURED);
      expect(error.message).toContain('CDN is not enabled');
    });
  });

  it('should return INTERNAL_ERROR when CDN URL is not configured', async () => {
    cdnDeps = createMockCdnDeps({
      getCdnUrl: vi.fn().mockReturnValue(undefined),
    });

    await expectResult(
      generateCdnSignedCookies(cdnDeps, validInput, true)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      generateCdnSignedCookies(cdnDeps, {} as never, true)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      generateCdnSignedCookies(cdnDeps, { organizationId: '' }, true)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR when generateSignedCookies throws', async () => {
    cdnDeps = createMockCdnDeps({
      generateSignedCookies: vi.fn().mockImplementation(() => {
        throw new Error('CloudFront signing failed');
      }),
    });

    await expectResult(
      generateCdnSignedCookies(cdnDeps, validInput, true)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
