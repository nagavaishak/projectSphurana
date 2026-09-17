import { describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import {
  CLAIRE_NUDGE_TEMPLATES,
  submitClaireNudgeTemplates,
} from './templates.js';

const WABA = 'waba-123';
const ALL_NAMES = Object.keys(CLAIRE_NUDGE_TEMPLATES);

describe('submitClaireNudgeTemplates', () => {
  it('submits every template when none exist yet', async () => {
    const listTemplates = vi.fn(async () => []);
    const createTemplate = vi.fn(async () => ({ id: 'id', status: 'PENDING' }));

    const result = await submitClaireNudgeTemplates(
      { listTemplates, createTemplate },
      WABA
    );

    expect(listTemplates).toHaveBeenCalledWith(WABA);
    expect(createTemplate).toHaveBeenCalledTimes(ALL_NAMES.length);
    expect(result.submitted.map((s) => s.name).sort()).toEqual(
      [...ALL_NAMES].sort()
    );
    expect(result.skipped).toEqual([]);
  });

  it('is idempotent — skips templates that already exist (any status)', async () => {
    const listTemplates = vi.fn(async () => [
      {
        id: 't1',
        name: 'daily_lead_recap',
        status: 'APPROVED' as const,
        category: 'MARKETING',
        language: 'en',
        components: [],
      },
    ]);
    const createTemplate = vi.fn(async () => ({ id: 'id', status: 'PENDING' }));

    const result = await submitClaireNudgeTemplates(
      { listTemplates, createTemplate },
      WABA
    );

    expect(result.skipped).toContain('daily_lead_recap');
    // Only the two missing templates are created.
    expect(createTemplate).toHaveBeenCalledTimes(ALL_NAMES.length - 1);
    expect(result.submitted.map((s) => s.name)).not.toContain(
      'daily_lead_recap'
    );
  });

  it('creates nothing when all templates already exist', async () => {
    const listTemplates = vi.fn(async () =>
      ALL_NAMES.map((name) => ({
        id: name,
        name,
        status: 'APPROVED' as const,
        category: 'MARKETING',
        language: 'en',
        components: [],
      }))
    );
    const createTemplate = vi.fn();

    const result = await submitClaireNudgeTemplates(
      { listTemplates, createTemplate },
      WABA
    );

    expect(createTemplate).not.toHaveBeenCalled();
    expect(result.skipped.sort()).toEqual([...ALL_NAMES].sort());
    expect(result.submitted).toEqual([]);
  });
});
