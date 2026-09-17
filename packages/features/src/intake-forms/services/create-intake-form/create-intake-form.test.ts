import { drizzleUniqueViolation } from '@borradh-workspace/database';
import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { createIntakeForm } from './create-intake-form.service.js';

describe('createIntakeForm', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  const valid = {
    organizationId: 'org-1',
    name: 'Medical history',
    fields: [{ id: 'a', type: 'short_text' as const, label: 'Name' }],
  };

  it('creates a form', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'f1', ...valid }]);
    const result = await createIntakeForm(mockDb as never, valid);
    expect(result.success).toBe(true);
  });

  it('rejects a choice field with no options', async () => {
    const result = await createIntakeForm(mockDb as never, {
      organizationId: 'org-1',
      name: 'Bad',
      fields: [{ id: 'd', type: 'dropdown', label: 'Pick' }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // `form` has no (org, kind, name) unique index, so the 409 the API has always
  // returned is now a pre-check in the service rather than a caught constraint
  // violation — see the note in create-intake-form.service.ts.
  it('maps a duplicate name to ALREADY_EXISTS', async () => {
    // The real drizzle-wrapped shape: the constraint is on `.cause`, not on
    // `error.message`. Faking it the other way is how this 409 sat broken.
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('uq_form_org_kind_name')
    );
    const result = await createIntakeForm(mockDb as never, valid);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
    // The insert IS attempted — the DATABASE rejects it. An earlier pass
    // bailed before the insert on a pre-check SELECT, which two concurrent
    // creates both pass; asserting the insert happened is what pins that shut.
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
