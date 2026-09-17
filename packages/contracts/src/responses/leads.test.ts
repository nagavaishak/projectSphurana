import { describe, expect, it } from 'vitest';
import { leadHistoryResponseSchema } from './leads.js';

/**
 * ENG-843 — the `ResponseContractInterceptor` validates
 * `JSON.parse(JSON.stringify(result))`, which preserves `null` but drops
 * `undefined`. The service returns raw DB `null` for `description` /
 * `performedById` / `performedByName` on system-generated lead activities
 * (no `?? undefined` fallback) and for `errorMessage` on sequence
 * executions — so the fixture below must survive the SAME round-trip the
 * interceptor performs, not just a direct `.parse()` of a JS object.
 */
const roundTrip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

describe('leadHistoryResponseSchema', () => {
  it('accepts a system-generated activity with null actor fields after a JSON round-trip', () => {
    const fixture = {
      items: [
        {
          id: 'activity_1',
          type: 'activity',
          timestamp: '2024-01-01T10:00:00.000Z',
          activity: {
            id: 'activity_1',
            leadId: 'lead_1',
            type: 'status_changed',
            // Raw DB `null` — no actor performed this (system-generated).
            description: null,
            performedById: null,
            performedByName: null,
            createdAt: '2024-01-01T10:00:00.000Z',
          },
        },
      ],
      total: 1,
    };

    const result = leadHistoryResponseSchema.safeParse(roundTrip(fixture));

    expect(result.success).toBe(true);
  });

  it('accepts a synthesized activity that omits the actor fields entirely', () => {
    const fixture = {
      items: [
        {
          id: 'synthetic-lead-created-lead_1',
          type: 'activity',
          timestamp: '2024-01-01T09:00:00.000Z',
          activity: {
            id: 'synthetic-lead-created-lead_1',
            leadId: 'lead_1',
            type: 'lead_created',
            description: 'Came in via Website',
            createdAt: '2024-01-01T09:00:00.000Z',
          },
        },
      ],
      total: 1,
    };

    const result = leadHistoryResponseSchema.safeParse(roundTrip(fixture));

    expect(result.success).toBe(true);
  });

  it('accepts a failed sequence execution with a null errorMessage after a JSON round-trip', () => {
    const fixture = {
      items: [
        {
          id: 'exec_1',
          type: 'execution',
          timestamp: '2024-01-01T11:00:00.000Z',
          execution: {
            id: 'exec_1',
            leadId: 'lead_1',
            sequenceId: 'sequence_1',
            stepId: 'step_1',
            status: 'failed',
            // Raw DB `null` — `list-lead-history.service.ts` passes
            // `exec.errorMessage` through with no `?? undefined` fallback.
            errorMessage: null,
            createdAt: '2024-01-01T11:00:00.000Z',
          },
        },
      ],
      total: 1,
    };

    const result = leadHistoryResponseSchema.safeParse(roundTrip(fixture));

    expect(result.success).toBe(true);
  });
});
