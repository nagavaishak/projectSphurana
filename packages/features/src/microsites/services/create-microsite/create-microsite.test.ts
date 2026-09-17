import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  type MockDb,
  createMockDb,
  uniqueViolation,
} from '../shared/mock-db.test-utils.js';
import {
  ORG_ID,
  SITE_ID,
  THEME,
  micrositeRow,
} from '../shared/test-fixtures.test-utils.js';
import {
  DEFAULT_MICROSITE_PAGES,
  createMicrosite,
} from './create-microsite.service.js';

let db: MockDb;

const input = { organizationId: ORG_ID, slug: 'acme-salon', theme: THEME };

describe('createMicrosite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.query.microsite.findFirst.mockResolvedValue(undefined);
    db.insertReturning.mockResolvedValue([micrositeRow()]);
  });

  it('creates the microsite and its default page set', async () => {
    const result = await createMicrosite(db as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe(SITE_ID);
    expect(result.data.created).toBe(true);
    expect(result.data.status).toBe('draft');

    // Two inserts: the microsite, then the pages — in one transaction.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    const pageValues = db.values.mock.calls[1]?.[0] as {
      path: string;
      isSystem: boolean;
      organizationId: string;
      blocks: unknown[];
    }[];
    expect(pageValues.map((p) => p.path)).toEqual(
      DEFAULT_MICROSITE_PAGES.map((p) => p.path)
    );
    // Empty by design — composing blocks is provisioning's job.
    expect(pageValues.every((p) => p.blocks.length === 0)).toBe(true);
    // Denormalized org id is what `orgRlsPolicy` reads on the page row.
    expect(pageValues.every((p) => p.organizationId === ORG_ID)).toBe(true);
    // The home page cannot be deleted.
    expect(pageValues.find((p) => p.path === '/')?.isSystem).toBe(true);
  });

  /**
   * IDEMPOTENCY. Provisioning runs in a BullMQ job and BullMQ retries — a
   * second call must return the live site untouched, NOT reset it.
   */
  it('returns the existing microsite without writing anything', async () => {
    const existing = micrositeRow({
      slug: 'already-live',
      status: 'published',
      publishedRevisionId: 'rev-9',
    });
    db.query.microsite.findFirst.mockResolvedValue(existing);

    const result = await createMicrosite(db as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.created).toBe(false);
    // The retry must not renumber the slug of a site that is already live.
    expect(result.data.slug).toBe('already-live');
    expect(result.data.publishedRevisionId).toBe('rev-9');
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns the winner when two retries race the insert', async () => {
    db.query.microsite.findFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(micrositeRow({ slug: 'winner' }));
    db.transaction.mockRejectedValueOnce(
      uniqueViolation('microsite_organization_id_unique')
    );

    const result = await createMicrosite(db as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(false);
      expect(result.data.slug).toBe('winner');
    }
  });

  it('returns ALREADY_EXISTS when another org holds the slug', async () => {
    db.transaction.mockRejectedValueOnce(
      uniqueViolation('microsite_slug_unique')
    );

    const result = await createMicrosite(db as never, input);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on an unexpected db failure', async () => {
    db.transaction.mockRejectedValueOnce(new Error('DB failed'));

    const result = await createMicrosite(db as never, input);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });

  it.each([
    ['empty', ''],
    ['a leading dash', '-acme'],
    ['a double dash', 'acme--salon'],
    ['an underscore', 'acme_salon'],
    ['a dot', 'acme.salon'],
    ['a reserved label', 'www'],
    ['another reserved label', 'portal'],
  ])('rejects a slug with %s', async (_label, slug) => {
    const result = await createMicrosite(db as never, { ...input, slug });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('normalises case and surrounding whitespace on the slug', async () => {
    await createMicrosite(db as never, { ...input, slug: '  Acme-Salon  ' });

    const inserted = db.values.mock.calls[0]?.[0] as { slug: string };
    expect(inserted.slug).toBe('acme-salon');
  });

  it('returns VALIDATION_ERROR for a missing organizationId', async () => {
    const result = await createMicrosite(db as never, {
      ...input,
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(db.query.microsite.findFirst).not.toHaveBeenCalled();
  });
});
