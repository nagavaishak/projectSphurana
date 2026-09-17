import { describe, expect, it } from '@borradh-workspace/testing';
import { interpolateMessage } from './interpolate-message.js';
import type { LeadData } from './types.js';

const baseLead: LeadData = {
  id: 'lead-1',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  phone: '+15551234567',
  name: 'John Doe',
  status: 'new',
  interestedService: 'Botox',
};

describe('interpolateMessage', () => {
  it('replaces simple variables', () => {
    const result = interpolateMessage(
      'Hello {{firstName}}, your email is {{email}}.',
      baseLead
    );
    expect(result).toBe('Hello John, your email is john@example.com.');
  });

  it('replaces multiple occurrences of the same variable', () => {
    const result = interpolateMessage(
      '{{firstName}} here, {{firstName}} there',
      baseLead
    );
    expect(result).toBe('John here, John there');
  });

  it('replaces missing variables with empty string', () => {
    const lead: LeadData = { id: 'lead-2' };
    const result = interpolateMessage('Hi {{firstName}} {{lastName}}!', lead);
    expect(result).toBe('Hi  !');
  });

  it('replaces null values with empty string', () => {
    const lead: LeadData = { id: 'lead-3', firstName: null };
    const result = interpolateMessage('Hi {{firstName}}!', lead);
    expect(result).toBe('Hi !');
  });

  it('handles templates with no variables', () => {
    const result = interpolateMessage('No variables here', baseLead);
    expect(result).toBe('No variables here');
  });

  it('handles empty template', () => {
    const result = interpolateMessage('', baseLead);
    expect(result).toBe('');
  });

  it('converts numeric values to string', () => {
    const lead: LeadData = { id: 'lead-4', score: 42 };
    const result = interpolateMessage('Score: {{score}}', lead);
    expect(result).toBe('Score: 42');
  });

  it('converts boolean values to string', () => {
    const lead: LeadData = { id: 'lead-5', consentEmail: true };
    const result = interpolateMessage('Consent: {{consentEmail}}', lead);
    expect(result).toBe('Consent: true');
  });

  it('replaces custom lead fields', () => {
    const result = interpolateMessage(
      'Interested in: {{interestedService}}',
      baseLead
    );
    expect(result).toBe('Interested in: Botox');
  });

  it('does not replace non-word characters in variable names', () => {
    const result = interpolateMessage('{{first-name}}', baseLead);
    expect(result).toBe('{{first-name}}');
  });

  it('handles adjacent variables', () => {
    const result = interpolateMessage('{{firstName}}{{lastName}}', baseLead);
    expect(result).toBe('JohnDoe');
  });
});
