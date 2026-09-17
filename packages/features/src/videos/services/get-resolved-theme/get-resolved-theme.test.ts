import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectSuccess,
  it,
} from '@borradh-workspace/testing';
import { engineDefaultTheme } from '@borradh-workspace/video-templates';
import { ErrorCodes } from '../../../shared/index.js';
import { getResolvedTheme } from './get-resolved-theme.service.js';

const ORG_ID = 'org-test-1';

const baseOrgRow = {
  name: 'Acme Clinic',
  logo: null,
  primaryColor: '#0033CC',
  secondaryColor: '#FF7700',
  tagline: 'Skin you love',
  address: '1 Test St',
  defaultBookingLink: 'https://acme.example/book',
};

describe('getResolvedTheme', () => {
  let db: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    db = createMockDatabase();
  });

  it('derives the theme from the organization row on top of engine defaults', async () => {
    db.query.organization.findFirst.mockResolvedValueOnce(baseOrgRow);

    const result = await getResolvedTheme(db as never, {
      organizationId: ORG_ID,
    });

    const data = expectSuccess(result);
    // engine defaults survive for unset fields
    expect(data.typeStyles.display.fontRef).toBe(
      engineDefaultTheme.typeStyles.display.fontRef
    );
    expect(data.identity.ctaText).toBe(engineDefaultTheme.identity.ctaText);
    // org row drove primary/secondary colour + identity
    expect(data.colors.primary).toBe('#0033CC');
    expect(data.colors.secondary).toBe('#FF7700');
    expect(data.identity.businessName).toBe('Acme Clinic');
    expect(data.identity.tagline).toBe('Skin you love');
    expect(data.identity.bookingUrl).toBe('https://acme.example/book');
    expect(data.logo.light).toBeNull();
  });

  it('ignores malformed org colours and falls back to engine defaults', async () => {
    db.query.organization.findFirst.mockResolvedValueOnce({
      ...baseOrgRow,
      primaryColor: 'not-a-hex',
      secondaryColor: null,
    });

    const result = await getResolvedTheme(db as never, {
      organizationId: ORG_ID,
    });

    const data = expectSuccess(result);
    expect(data.colors.primary).toBe(engineDefaultTheme.colors.primary);
  });

  it('per-video themeOverrides take precedence over the org-derived theme', async () => {
    db.query.organization.findFirst.mockResolvedValueOnce(baseOrgRow);

    const result = await getResolvedTheme(db as never, {
      organizationId: ORG_ID,
      themeOverrides: {
        colors: { primary: '#112233', onPrimary: '#FFFFFF' },
        identity: { ctaText: 'Get started' },
      },
    });

    const data = expectSuccess(result);
    expect(data.colors.primary).toBe('#112233');
    expect(data.identity.ctaText).toBe('Get started');
    // unspecified fields fall through to the org-derived theme
    expect(data.identity.businessName).toBe('Acme Clinic');
  });

  it('flags low primary/onPrimary contrast as VALIDATION_ERROR', async () => {
    db.query.organization.findFirst.mockResolvedValueOnce(baseOrgRow);

    // light grey primary on white onPrimary — contrast far below the minimum
    const result = await getResolvedTheme(db as never, {
      organizationId: ORG_ID,
      themeOverrides: {
        colors: { primary: '#CCCCCC', onPrimary: '#FFFFFF' },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toMatch(/contrast/i);
    }
  });

  it('returns NOT_FOUND when no organization row exists', async () => {
    db.query.organization.findFirst.mockResolvedValueOnce(null);

    const result = await getResolvedTheme(db as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR on invalid input', async () => {
    const result = await getResolvedTheme(db as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
