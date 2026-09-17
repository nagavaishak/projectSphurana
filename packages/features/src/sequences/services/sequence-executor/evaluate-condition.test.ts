import { describe, expect, it } from '@borradh-workspace/testing';
import { evaluateCondition } from './evaluate-condition.js';
import type { ConditionNodeConfig, LeadData } from './types.js';

// Suppress logger warnings in tests

const baseLead: LeadData = {
  id: 'lead-1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  phone: '+15551234567',
  status: 'qualified',
  lastCall: {
    id: 'call-1',
    status: 'completed',
    sentiment: 'positive',
    callbackRequested: false,
    appointmentBooked: true,
    duration: 120000,
    summary: 'Interested in Botox',
    createdAt: new Date('2025-01-15T10:00:00Z'),
  },
};

function makeConfig(
  overrides: Partial<ConditionNodeConfig>
): ConditionNodeConfig {
  return {
    field: 'status',
    operator: 'equals',
    value: 'qualified',
    ...overrides,
  };
}

describe('evaluateCondition', () => {
  describe('string operators', () => {
    it('equals (case insensitive by default)', () => {
      expect(
        evaluateCondition(
          makeConfig({ field: 'firstName', value: 'john' }),
          baseLead
        )
      ).toBe(true);
    });

    it('equals (case sensitive)', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'firstName',
            value: 'john',
            caseSensitive: true,
          }),
          baseLead
        )
      ).toBe(false);
      expect(
        evaluateCondition(
          makeConfig({
            field: 'firstName',
            value: 'John',
            caseSensitive: true,
          }),
          baseLead
        )
      ).toBe(true);
    });

    it('not_equals', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'status',
            operator: 'not_equals',
            value: 'new',
          }),
          baseLead
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          makeConfig({
            field: 'status',
            operator: 'not_equals',
            value: 'qualified',
          }),
          baseLead
        )
      ).toBe(false);
    });

    it('contains', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'email',
            operator: 'contains',
            value: 'example',
          }),
          baseLead
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          makeConfig({
            field: 'email',
            operator: 'contains',
            value: 'gmail',
          }),
          baseLead
        )
      ).toBe(false);
    });

    it('not_contains', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'email',
            operator: 'not_contains',
            value: 'gmail',
          }),
          baseLead
        )
      ).toBe(true);
    });

    it('starts_with', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'email',
            operator: 'starts_with',
            value: 'john',
          }),
          baseLead
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          makeConfig({
            field: 'email',
            operator: 'starts_with',
            value: 'jane',
          }),
          baseLead
        )
      ).toBe(false);
    });

    it('ends_with', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'email',
            operator: 'ends_with',
            value: '.com',
          }),
          baseLead
        )
      ).toBe(true);
    });
  });

  describe('numeric operators', () => {
    const leadWithScore: LeadData = { ...baseLead, score: 75 };

    it('greater_than', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'score',
            operator: 'greater_than',
            value: '50',
            type: 'number',
          }),
          leadWithScore
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          makeConfig({
            field: 'score',
            operator: 'greater_than',
            value: '100',
            type: 'number',
          }),
          leadWithScore
        )
      ).toBe(false);
    });

    it('less_than', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'score',
            operator: 'less_than',
            value: '100',
            type: 'number',
          }),
          leadWithScore
        )
      ).toBe(true);
    });

    it('greater_or_equal', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'score',
            operator: 'greater_or_equal',
            value: '75',
            type: 'number',
          }),
          leadWithScore
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          makeConfig({
            field: 'score',
            operator: 'greater_or_equal',
            value: '76',
            type: 'number',
          }),
          leadWithScore
        )
      ).toBe(false);
    });

    it('less_or_equal', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'score',
            operator: 'less_or_equal',
            value: '75',
            type: 'number',
          }),
          leadWithScore
        )
      ).toBe(true);
    });

    it('returns false for NaN comparison', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'firstName',
            operator: 'greater_than',
            value: '50',
            type: 'number',
          }),
          baseLead
        )
      ).toBe(false);
    });

    it('returns false for NaN compare value', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'score',
            operator: 'greater_than',
            value: 'abc',
            type: 'number',
          }),
          leadWithScore
        )
      ).toBe(false);
    });
  });

  describe('boolean operators', () => {
    it('evaluates boolean true values', () => {
      const lead: LeadData = {
        ...baseLead,
        lastCall: { ...baseLead.lastCall, appointmentBooked: true },
      };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'lastCall.appointmentBooked',
            operator: 'equals',
            value: 'true',
            type: 'boolean',
          }),
          lead
        )
      ).toBe(true);
    });

    it('evaluates boolean false values', () => {
      const lead: LeadData = {
        ...baseLead,
        lastCall: { ...baseLead.lastCall, callbackRequested: false },
      };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'lastCall.callbackRequested',
            operator: 'equals',
            value: 'false',
            type: 'boolean',
          }),
          lead
        )
      ).toBe(true);
    });

    it('coerces string "1" to true', () => {
      const lead: LeadData = { ...baseLead, flag: '1' };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'flag',
            operator: 'equals',
            value: 'true',
            type: 'boolean',
          }),
          lead
        )
      ).toBe(true);
    });

    it('coerces string "true" to true', () => {
      const lead: LeadData = { ...baseLead, flag: 'true' };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'flag',
            operator: 'equals',
            value: '1',
            type: 'boolean',
          }),
          lead
        )
      ).toBe(true);
    });
  });

  describe('date operators', () => {
    it('compares dates with greater_than', () => {
      const lead: LeadData = { ...baseLead, createdAt: '2025-06-01T00:00:00Z' };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'createdAt',
            operator: 'greater_than',
            value: '2025-01-01T00:00:00Z',
            type: 'date',
          }),
          lead
        )
      ).toBe(true);
    });

    it('compares dates with less_than', () => {
      const lead: LeadData = { ...baseLead, createdAt: '2025-01-01T00:00:00Z' };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'createdAt',
            operator: 'less_than',
            value: '2025-06-01T00:00:00Z',
            type: 'date',
          }),
          lead
        )
      ).toBe(true);
    });

    it('returns false for invalid dates', () => {
      const lead: LeadData = { ...baseLead, createdAt: 'not-a-date' };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'createdAt',
            operator: 'greater_than',
            value: '2025-01-01',
            type: 'date',
          }),
          lead
        )
      ).toBe(false);
    });

    it('returns false for invalid compare date', () => {
      const lead: LeadData = { ...baseLead, createdAt: '2025-06-01T00:00:00Z' };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'createdAt',
            operator: 'greater_than',
            value: 'not-a-date',
            type: 'date',
          }),
          lead
        )
      ).toBe(false);
    });
  });

  describe('empty operators', () => {
    it('is_empty returns true for null', () => {
      const lead: LeadData = { id: 'lead-2', firstName: null };
      expect(
        evaluateCondition(
          makeConfig({ field: 'firstName', operator: 'is_empty', value: '' }),
          lead
        )
      ).toBe(true);
    });

    it('is_empty returns true for undefined', () => {
      const lead: LeadData = { id: 'lead-3' };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'missingField',
            operator: 'is_empty',
            value: '',
          }),
          lead
        )
      ).toBe(true);
    });

    it('is_empty returns true for empty string (treatEmptyAsNull default)', () => {
      const lead: LeadData = { id: 'lead-4', firstName: '' };
      expect(
        evaluateCondition(
          makeConfig({ field: 'firstName', operator: 'is_empty', value: '' }),
          lead
        )
      ).toBe(true);
    });

    it('is_empty returns false for empty string when treatEmptyAsNull is false', () => {
      const lead: LeadData = { id: 'lead-5', firstName: '' };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'firstName',
            operator: 'is_empty',
            value: '',
            treatEmptyAsNull: false,
          }),
          lead
        )
      ).toBe(false);
    });

    it('is_not_empty returns true for non-empty value', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'firstName',
            operator: 'is_not_empty',
            value: '',
          }),
          baseLead
        )
      ).toBe(true);
    });

    it('is_not_empty returns false for null value', () => {
      const lead: LeadData = { id: 'lead-6', firstName: null };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'firstName',
            operator: 'is_not_empty',
            value: '',
          }),
          lead
        )
      ).toBe(false);
    });
  });

  describe('regex operator', () => {
    it('matches valid regex', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'email',
            operator: 'matches_regex',
            value: '^[a-z]+@',
          }),
          baseLead
        )
      ).toBe(true);
    });

    it('returns false for non-matching regex', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'email',
            operator: 'matches_regex',
            value: '^[0-9]+$',
          }),
          baseLead
        )
      ).toBe(false);
    });

    it('returns false for invalid regex pattern', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'email',
            operator: 'matches_regex',
            value: '[invalid',
          }),
          baseLead
        )
      ).toBe(false);
    });

    it('returns false for regex pattern that is too long', () => {
      const longPattern = 'a'.repeat(201);
      expect(
        evaluateCondition(
          makeConfig({
            field: 'email',
            operator: 'matches_regex',
            value: longPattern,
          }),
          baseLead
        )
      ).toBe(false);
    });

    it('rejects patterns with catastrophic backtracking', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'email',
            operator: 'matches_regex',
            value: '(a+)+',
          }),
          baseLead
        )
      ).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns false when field value is empty for comparison operators', () => {
      const lead: LeadData = { id: 'lead-7', firstName: null };
      expect(
        evaluateCondition(
          makeConfig({ field: 'firstName', operator: 'equals', value: 'John' }),
          lead
        )
      ).toBe(false);
    });

    it('returns false for unknown operator', () => {
      expect(
        evaluateCondition(
          // biome-ignore lint/suspicious/noExplicitAny: testing unknown operator
          makeConfig({ operator: 'unknown_op' as any, value: 'test' }),
          baseLead
        )
      ).toBe(false);
    });

    it('evaluates lastCall fields correctly', () => {
      expect(
        evaluateCondition(
          makeConfig({
            field: 'lastCall.sentiment',
            operator: 'equals',
            value: 'positive',
          }),
          baseLead
        )
      ).toBe(true);
    });

    it('returns false when lastCall is null and checking lastCall field', () => {
      const lead: LeadData = { id: 'lead-8', lastCall: null };
      expect(
        evaluateCondition(
          makeConfig({
            field: 'lastCall.sentiment',
            operator: 'equals',
            value: 'positive',
          }),
          lead
        )
      ).toBe(false);
    });
  });
});
