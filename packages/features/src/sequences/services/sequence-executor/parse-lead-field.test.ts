import { describe, expect, it } from '@borradh-workspace/testing';
import { getFieldValue, isEmpty } from './parse-lead-field.js';
import type { LeadData } from './types.js';

const baseLead: LeadData = {
  id: 'lead-1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  phone: '+15551234567',
  status: 'new',
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

describe('getFieldValue', () => {
  it('gets top-level field', () => {
    expect(getFieldValue('firstName', baseLead)).toBe('John');
  });

  it('strips "lead." prefix', () => {
    expect(getFieldValue('lead.firstName', baseLead)).toBe('John');
  });

  it('gets lastCall fields via dot notation', () => {
    expect(getFieldValue('lastCall.status', baseLead)).toBe('completed');
    expect(getFieldValue('lastCall.sentiment', baseLead)).toBe('positive');
    expect(getFieldValue('lastCall.appointmentBooked', baseLead)).toBe(true);
    expect(getFieldValue('lastCall.duration', baseLead)).toBe(120000);
  });

  it('returns undefined for lastCall fields when lastCall is null', () => {
    const lead: LeadData = { id: 'lead-2', lastCall: null };
    expect(getFieldValue('lastCall.status', lead)).toBeUndefined();
  });

  it('returns undefined for lastCall fields when lastCall is missing', () => {
    const lead: LeadData = { id: 'lead-3' };
    expect(getFieldValue('lastCall.status', lead)).toBeUndefined();
  });

  it('handles nested object paths', () => {
    const lead: LeadData = {
      id: 'lead-4',
      metadata: { custom: { tag: 'vip' } },
    };
    expect(getFieldValue('metadata.custom.tag', lead)).toBe('vip');
  });

  it('returns undefined for missing nested paths', () => {
    expect(getFieldValue('metadata.custom.tag', baseLead)).toBeUndefined();
  });

  it('returns undefined for null intermediate values', () => {
    const lead: LeadData = { id: 'lead-5', metadata: null };
    expect(getFieldValue('metadata.key', lead)).toBeUndefined();
  });

  it('returns undefined for non-object intermediate values', () => {
    const lead: LeadData = { id: 'lead-6', firstName: 'John' };
    expect(getFieldValue('firstName.nested', lead)).toBeUndefined();
  });

  it('gets "lead." prefix with nested path', () => {
    expect(getFieldValue('lead.status', baseLead)).toBe('new');
  });
});

describe('isEmpty', () => {
  it('returns true for null', () => {
    expect(isEmpty(null)).toBe(true);
  });

  it('returns true for undefined', () => {
    expect(isEmpty(undefined)).toBe(true);
  });

  it('returns true for empty string when treatEmptyAsNull is true', () => {
    expect(isEmpty('', true)).toBe(true);
  });

  it('returns false for empty string when treatEmptyAsNull is false', () => {
    expect(isEmpty('', false)).toBe(false);
  });

  it('returns true for empty array', () => {
    expect(isEmpty([])).toBe(true);
  });

  it('returns false for non-empty string', () => {
    expect(isEmpty('hello')).toBe(false);
  });

  it('returns false for zero', () => {
    expect(isEmpty(0)).toBe(false);
  });

  it('returns false for false', () => {
    expect(isEmpty(false)).toBe(false);
  });

  it('returns false for non-empty array', () => {
    expect(isEmpty([1, 2])).toBe(false);
  });

  it('defaults treatEmptyAsNull to true', () => {
    expect(isEmpty('')).toBe(true);
  });
});
