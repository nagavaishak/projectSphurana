import type { ConversationMetadata } from '@borradh-workspace/database';
import { describe, expect, it } from 'vitest';
import { buildConversationContext } from './conversation-context-builder.js';

describe('buildConversationContext', () => {
  it('returns empty string for null metadata', () => {
    expect(buildConversationContext(null)).toBe('');
  });

  it('returns empty string for undefined metadata', () => {
    expect(buildConversationContext(undefined)).toBe('');
  });

  it('returns empty string when metadata has no relevant fields', () => {
    const metadata = {} as ConversationMetadata;
    expect(buildConversationContext(metadata)).toBe('');
  });

  it('includes conversation stage', () => {
    const metadata = { stage: 'qualified' } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('Current stage: qualified');
  });

  it('extracts first name only from full name', () => {
    const metadata = { name: 'Sarah Jane Smith' } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('Customer first name: Sarah');
    expect(result).toContain('ONLY THIS FIRST NAME');
    expect(result).not.toContain('Jane');
    expect(result).not.toContain('Smith');
  });

  it('includes phone number', () => {
    const metadata = { phone: '+353871234567' } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('Customer phone: +353871234567');
  });

  it('includes treatments discussed', () => {
    const metadata = {
      treatmentsDiscussed: ['Botox', 'Lip Filler'],
    } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('Treatments discussed: Botox, Lip Filler');
  });

  it('skips empty treatments array', () => {
    const metadata = { treatmentsDiscussed: [] } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toBe('');
  });

  it('includes health concerns', () => {
    const metadata = {
      healthConcerns: ['pregnancy'],
    } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('Health concerns noted: pregnancy');
  });

  it('notes when booking link was already sent', () => {
    const metadata = { bookingLinkSent: true } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('Booking link was already sent');
    expect(result).toContain('Do not resend');
  });

  it('notes booking interest', () => {
    const metadata = { bookingInterest: true } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('expressed interest in booking');
  });

  it('warns when contact details asked twice', () => {
    const metadata = { contactDetailAsks: 2 } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('already asked twice');
  });

  it('does not warn when contact details asked only once', () => {
    const metadata = { contactDetailAsks: 1 } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toBe('');
  });

  it('includes follow-up stage', () => {
    const metadata = { followUpStage: 2 } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('Follow-up stage: 2 of 3');
  });

  it('notes dormant conversation', () => {
    const metadata = { dormant: true } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('Conversation is dormant');
  });

  it('includes ad title context', () => {
    const metadata = { adTitle: 'Summer Botox Sale' } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('Summer Botox Sale');
    expect(result).toContain(
      'when they ask about pricing, cost, or details without specifying a treatment, ASSUME they mean Summer Botox Sale'
    );
  });

  it('wraps output in Conversation Memory header', () => {
    const metadata = { stage: 'first_contact' } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toMatch(/^[\s\S]*--- Conversation Memory ---/);
  });

  it('includes returning sender context when provided', () => {
    const metadata = { stage: 'first_contact' } as ConversationMetadata;
    const result = buildConversationContext(metadata, {
      totalMessages: 15,
      firstContactDate: new Date('2026-02-01'),
      daysSinceFirstContact: 46,
    });
    expect(result).toContain('Returning sender');
    expect(result).toContain('15 previous messages');
    expect(result).toContain('46 days');
  });

  it('does not include returning sender when not provided', () => {
    const metadata = { stage: 'first_contact' } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).not.toContain('Returning sender');
  });

  it('does not include returning sender when totalMessages is 0', () => {
    const metadata = { stage: 'first_contact' } as ConversationMetadata;
    const result = buildConversationContext(metadata, {
      totalMessages: 0,
      firstContactDate: new Date(),
      daysSinceFirstContact: 0,
    });
    expect(result).not.toContain('Returning sender');
  });

  it('combines multiple fields', () => {
    const metadata = {
      stage: 'qualified',
      name: 'Emma Wilson',
      bookingInterest: true,
      treatmentsDiscussed: ['Botox'],
    } as ConversationMetadata;
    const result = buildConversationContext(metadata);
    expect(result).toContain('Current stage: qualified');
    expect(result).toContain('Customer first name: Emma');
    expect(result).toContain('expressed interest in booking');
    expect(result).toContain('Treatments discussed: Botox');
  });
});
