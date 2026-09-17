/**
 * Guards the default lead-form question set (PRD-18). Beyond the standard
 * name/email/phone fields, every new lead form must include the multiple-choice
 * "how soon are you hoping to get this treatment done?" question so clinics can
 * prioritise hot leads straight from the form submission.
 *
 * Imported via `@borradh-workspace/features/shared` to also exercise the
 * labels → features/shared re-export chain that api-client and the app rely on.
 */
import { describe, expect, it } from '@borradh-workspace/testing';
import {
  type LeadFormDefaultQuestion,
  defaultLeadFormQuestions,
  leadFormFieldTypeValues,
} from '../shared/index.js';

describe('defaultLeadFormQuestions', () => {
  it('leads with the standard name, email and phone fields', () => {
    expect(defaultLeadFormQuestions.slice(0, 3).map((q) => q.type)).toEqual([
      'FULL_NAME',
      'EMAIL',
      'PHONE',
    ]);
  });

  it('includes the multiple-choice treatment-timing question with ASAP / 1 week / 2 weeks', () => {
    const timing = defaultLeadFormQuestions.find((q) => q.type === 'CUSTOM') as
      | LeadFormDefaultQuestion
      | undefined;

    expect(timing).toBeDefined();
    expect(timing?.label).toBe(
      'How soon are you hoping to get this treatment done?'
    );
    expect(timing?.options?.map((o) => o.value)).toEqual([
      'ASAP',
      '1 week',
      '2 weeks',
    ]);
  });

  it('gives the timing question a stable key and option keys', () => {
    const timing = defaultLeadFormQuestions.find((q) => q.type === 'CUSTOM');
    expect(timing?.key).toBe('treatment_timing');
    expect(timing?.options).toEqual([
      { value: 'ASAP', key: 'asap' },
      { value: '1 week', key: '1_week' },
      { value: '2 weeks', key: '2_weeks' },
    ]);
  });

  it('only uses known field types, and only CUSTOM questions carry a label/options', () => {
    for (const q of defaultLeadFormQuestions) {
      expect(leadFormFieldTypeValues).toContain(q.type);
      if (q.type !== 'CUSTOM') {
        // Meta rejects a label on standard fields.
        expect(q.label).toBeUndefined();
        expect(q.options).toBeUndefined();
      }
    }
  });
});
