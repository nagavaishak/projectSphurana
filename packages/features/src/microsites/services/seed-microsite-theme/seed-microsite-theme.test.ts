import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import sharp from 'sharp';
import { type MockInstance, vi } from 'vitest';

// Stubbed with a restored `vi.spyOn`, NOT `vi.mock`: the features suite runs
// `isolate: false`, so a hoisted factory would leak into every later file.
import * as inspirationModule from '../../../image-generation/services/select-inspiration-set/select-inspiration-set.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import {
  DEFAULT_MICROSITE_BRAND,
  isDefaultBrandPalette,
  seedMicrositeTheme,
} from './seed-microsite-theme.service.js';

const ORG_ID = 'org-1';

/** Tailwind violet-600 — the value 14 orgs sit on. THE colour to not ship. */
const TAILWIND_VIOLET = '#7C3AED';

const MINT: [number, number, number] = [184, 210, 202];
const INK: [number, number, number] = [26, 42, 38];

/** A flat ground with a solid accent band — a designed post, in miniature. */
async function designedPost(
  ground: [number, number, number],
  accent: [number, number, number]
): Promise<Buffer> {
  const w = 300;
  const h = 300;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const c = y >= 200 && y < 240 ? accent : ground;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = c[0];
      raw[i + 1] = c[1];
      raw[i + 2] = c[2];
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

const dist = (hex: string, c: [number, number, number]) => {
  const v = (hex.replace('#', '').match(/../g) ?? []).map((x) =>
    Number.parseInt(x, 16)
  );
  return Math.sqrt(
    (v[0] - c[0]) ** 2 + (v[1] - c[1]) ** 2 + (v[2] - c[2]) ** 2
  );
};

const mockDb = {
  query: {
    organization: { findFirst: vi.fn() },
  },
};

const orgRow = (overrides: Record<string, unknown> = {}) => ({
  name: 'Test Salon',
  logo: 's3://assets/logo.png',
  primaryColor: null,
  secondaryColor: null,
  tagline: null,
  address: null,
  defaultBookingLink: null,
  ...overrides,
});

let mockSelectInspirationSet: MockInstance;

/** Every reference URL resolves to this image. */
function serveReference(image: Buffer) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () =>
        image.buffer.slice(
          image.byteOffset,
          image.byteOffset + image.byteLength
        ),
    }))
  );
}

function withReferences(urls: string[]) {
  mockSelectInspirationSet.mockResolvedValue({
    success: true,
    data: {
      objectKeys: urls,
      urls,
      colourway: 'light-ground',
      designFamily: null,
      consistencyScore: 1,
      candidateCount: urls.length,
      logoMatchFallback: false,
    },
  });
}

describe('seedMicrositeTheme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ENABLE_BRAND_SWATCH', '1');
    mockSelectInspirationSet = vi
      .spyOn(inspirationModule, 'selectInspirationSet')
      .mockResolvedValue({
        success: true,
        data: {
          objectKeys: [],
          urls: [],
          colourway: null,
          designFamily: null,
          consistencyScore: 0,
          candidateCount: 0,
          logoMatchFallback: true,
        },
      } as never);
    mockDb.query.organization.findFirst.mockResolvedValue(orgRow());
  });

  afterEach(() => {
    mockSelectInspirationSet.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns VALIDATION_ERROR for a missing organizationId', async () => {
    const result = await seedMicrositeTheme(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.organization.findFirst).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValue(undefined);

    const result = await seedMicrositeTheme(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('derives the brand from the org reference imagery when it exists', async () => {
    withReferences(['s3://assets/ref-1.png']);
    serveReference(await designedPost(MINT, INK));

    const result = await seedMicrositeTheme(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Ground -> surface, the readable accent -> primary.
    expect(dist(result.data.brand.surface, MINT)).toBeLessThan(12);
    expect(dist(result.data.brand.primary, INK)).toBeLessThan(24);
    expect(isDefaultBrandPalette(result.data)).toBe(false);
  });

  /**
   * THE REASON THIS SERVICE EXISTS.
   *
   * `organization.primaryColor` is Tailwind violet-600 for 14 orgs, so an org
   * that has one is NOT evidence of a brand colour. With real imagery on file,
   * violet must not reach the site — reverse the precedence and this fails.
   */
  it('does not ship a default-violet primaryColor when imagery is available', async () => {
    mockDb.query.organization.findFirst.mockResolvedValue(
      orgRow({ primaryColor: TAILWIND_VIOLET })
    );
    withReferences(['s3://assets/ref-1.png']);
    serveReference(await designedPost(MINT, INK));

    const result = await seedMicrositeTheme(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const colours = Object.values(result.data.brand).map((c) =>
      c.toLowerCase()
    );
    expect(colours).not.toContain(TAILWIND_VIOLET.toLowerCase());
    expect(dist(result.data.brand.surface, MINT)).toBeLessThan(12);
  });

  it('falls back to the org row when there is no reference imagery', async () => {
    mockDb.query.organization.findFirst.mockResolvedValue(
      orgRow({ primaryColor: '#2B8553', secondaryColor: '#B8D2CA' })
    );

    const result = await seedMicrositeTheme(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.brand.primary).toBe('#2B8553');
    expect(result.data.brand.accent).toBe('#B8D2CA');
    expect(isDefaultBrandPalette(result.data)).toBe(false);
  });

  it('falls back to the org row when the references yield no palette', async () => {
    mockDb.query.organization.findFirst.mockResolvedValue(
      orgRow({ primaryColor: '#2B8553' })
    );
    withReferences(['s3://assets/ref-1.png']);
    // Every reference fails to load — an expired CDN URL, the common case.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        arrayBuffer: async () => Buffer.alloc(0),
      }))
    );

    const result = await seedMicrositeTheme(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.brand.primary).toBe('#2B8553');
  });

  it('never reads imagery while ENABLE_BRAND_SWATCH is off', async () => {
    // Empty is what an unset flag looks like to `!process.env.X`.
    vi.stubEnv('ENABLE_BRAND_SWATCH', '');
    mockDb.query.organization.findFirst.mockResolvedValue(
      orgRow({ primaryColor: '#2B8553' })
    );
    withReferences(['s3://assets/ref-1.png']);
    serveReference(await designedPost(MINT, INK));

    const result = await seedMicrositeTheme(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(mockSelectInspirationSet).not.toHaveBeenCalled();
    expect(result.data.brand.primary).toBe('#2B8553');
  });

  it('reports engine defaults as defaults when nothing is known', async () => {
    const result = await seedMicrositeTheme(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.brand.primary).toBe(DEFAULT_MICROSITE_BRAND.primary);
    // The whole point of the flag: the caller can tell this is not a brand.
    expect(isDefaultBrandPalette(result.data)).toBe(true);
  });

  it('carries the canonical logo value, not a signed URL', async () => {
    const result = await seedMicrositeTheme(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.logo.assetUrl).toBe('s3://assets/logo.png');
    expect(result.data.typography.scale).toBe('default');
  });

  it('returns a null logo when the org has none', async () => {
    mockDb.query.organization.findFirst.mockResolvedValue(
      orgRow({ logo: null })
    );

    const result = await seedMicrositeTheme(mockDb as never, {
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.logo.assetUrl).toBeNull();
  });
});
