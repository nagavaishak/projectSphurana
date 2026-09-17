import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import {
  generateLocationSlug,
  slugifyLocationName,
} from './generate-location-slug.js';

describe('slugifyLocationName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyLocationName('Dublin City Centre')).toBe(
      'dublin-city-centre'
    );
  });

  it('strips accents rather than passing them through', () => {
    // The slug ends up in URLs that get pasted through clients which
    // percent-encode non-ASCII — `d%C3%BAn-laoghaire` is not a readable URL.
    expect(slugifyLocationName('Dún Laoghaire')).toBe('dun-laoghaire');
  });

  it('collapses punctuation and trims stray hyphens', () => {
    expect(slugifyLocationName('Dublin — City Centre!')).toBe(
      'dublin-city-centre'
    );
    expect(slugifyLocationName('  --Main Street--  ')).toBe('main-street');
  });

  it('returns empty for a name with nothing sluggable', () => {
    // The caller substitutes `branch`; this function does not guess.
    expect(slugifyLocationName('✨')).toBe('');
  });

  it('caps length so the URL stays sane', () => {
    expect(slugifyLocationName('a'.repeat(200))).toHaveLength(60);
  });
});

describe('generateLocationSlug', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('uses the plain slug when the org has not taken it', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);

    await expect(
      generateLocationSlug(mockDb as never, {
        organizationId: 'org-1',
        name: 'Dublin',
      })
    ).resolves.toBe('dublin');
  });

  it('suffixes only within the SAME org', async () => {
    // The whole reason the unique constraint was re-grained: another tenant's
    // "Dublin" is invisible here, so this org still gets the clean slug.
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { slug: 'cork' },
    ] as never);

    await expect(
      generateLocationSlug(mockDb as never, {
        organizationId: 'org-1',
        name: 'Dublin',
      })
    ).resolves.toBe('dublin');
  });

  it('starts suffixing at -2 so the first branch stays un-suffixed', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { slug: 'dublin' },
    ] as never);

    await expect(
      generateLocationSlug(mockDb as never, {
        organizationId: 'org-1',
        name: 'Dublin',
      })
    ).resolves.toBe('dublin-2');
  });

  it('skips past every taken suffix', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { slug: 'dublin' },
      { slug: 'dublin-2' },
      { slug: 'dublin-3' },
    ] as never);

    await expect(
      generateLocationSlug(mockDb as never, {
        organizationId: 'org-1',
        name: 'Dublin',
      })
    ).resolves.toBe('dublin-4');
  });

  it('falls back to `branch` for a name with nothing sluggable', async () => {
    // A null slug is what forces the URL back to a raw cuid, so the column must
    // always be fillable — even for an emoji-only or non-Latin name.
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);

    await expect(
      generateLocationSlug(mockDb as never, {
        organizationId: 'org-1',
        name: '✨',
      })
    ).resolves.toBe('branch');
  });

  it('ignores existing NULL slugs when checking what is taken', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { slug: null },
      { slug: null },
    ] as never);

    await expect(
      generateLocationSlug(mockDb as never, {
        organizationId: 'org-1',
        name: 'Dublin',
      })
    ).resolves.toBe('dublin');
  });
});
