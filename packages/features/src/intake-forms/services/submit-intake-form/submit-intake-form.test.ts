import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { hashIntakeToken } from '../../shared/intake-token.js';
import { submitIntakeForm } from './submit-intake-form.service.js';

const RAW = 'raw-intake-token';
const org = { id: 'org-1', slug: 'glow', deletedAt: null };

const submission = (over?: {
  status?: string;
  fields?: unknown[];
}) => ({
  id: 'sub-1',
  organizationId: 'org-1',
  formId: 'form-1',
  leadId: 'lead-1',
  appointmentId: 'appt-1',
  status: over?.status ?? 'pending',
  tokenHash: hashIntakeToken(RAW),
  fieldsSnapshot: over?.fields ?? [
    { id: 'name', type: 'short_text', label: 'Name', required: true },
    { id: 'consent', type: 'checkbox', label: 'I consent', required: true },
  ],
  answers: {},
});

describe('submitIntakeForm', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  const seed = (over?: { status?: string; fields?: unknown[] }) => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.formSubmission.findFirst.mockResolvedValueOnce(
      submission(over)
    );
  };

  const input = (answers: Record<string, unknown>) => ({
    organizationSlug: 'glow',
    token: RAW,
    answers,
  });

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  it('saves a fully-answered form and marks it completed', async () => {
    seed();
    mockDb.returning.mockResolvedValueOnce([{ id: 'sub-1' }]);

    const result = await submitIntakeForm(
      mockDb as never,
      input({ name: 'Sarah', consent: true })
    );

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('REJECTS a submit that leaves a required field blank — the gate', async () => {
    seed();

    const result = await submitIntakeForm(
      mockDb as never,
      input({ name: 'Sarah' })
    ); // no consent

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    // Must not have written a half-complete "completed" record.
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('drops answers to questions that were never asked', async () => {
    seed();
    mockDb.returning.mockResolvedValueOnce([{ id: 'sub-1' }]);

    await submitIntakeForm(
      mockDb as never,
      input({ name: 'Sarah', consent: true, injected: 'evil' })
    );

    const setArg = mockDb.set.mock.calls[0]?.[0] as {
      answers: Record<string, unknown>;
    };
    expect(setArg.answers).toHaveProperty('name');
    expect(setArg.answers).not.toHaveProperty('injected');
  });

  it('returns CONFLICT for an already-completed form rather than overwriting a signed record', async () => {
    seed({ status: 'completed' });

    const result = await submitIntakeForm(
      mockDb as never,
      input({ name: 'Sarah', consent: true })
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a dead token', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.formSubmission.findFirst.mockResolvedValueOnce(undefined);

    const result = await submitIntakeForm(
      mockDb as never,
      input({ name: 'Sarah' })
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('treats a lost concurrent write as CONFLICT (status guard matched nothing)', async () => {
    seed();
    mockDb.returning.mockResolvedValueOnce([]); // another submit won the race

    const result = await submitIntakeForm(
      mockDb as never,
      input({ name: 'Sarah', consent: true })
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
  });
});
