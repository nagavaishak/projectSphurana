import { normalizeLeadFormQuestion } from './_shared.js';

describe('normalizeLeadFormQuestion', () => {
  it('passes a bare standard type straight through (no label)', () => {
    expect(normalizeLeadFormQuestion('PHONE')).toEqual({ type: 'PHONE' });
    expect(normalizeLeadFormQuestion('EMAIL')).toEqual({ type: 'EMAIL' });
  });

  it('drops a label on a standard type — Meta rejects it there', () => {
    expect(
      normalizeLeadFormQuestion({ type: 'FULL_NAME', label: 'Your name' })
    ).toEqual({ type: 'FULL_NAME' });
  });

  // The bug this fixes (ENG-545 follow-up): a CUSTOM question must carry its
  // text as `label` + a derived `key`, or Meta rejects the whole update with
  // "requires a specific label for custom questions".
  it('carries a CUSTOM question label and derives a key', () => {
    expect(
      normalizeLeadFormQuestion({
        type: 'CUSTOM',
        label: 'Which stylist would you prefer?',
      })
    ).toEqual({
      type: 'CUSTOM',
      label: 'Which stylist would you prefer?',
      key: 'which_stylist_would_you_prefer',
    });
  });

  it('maps CUSTOM multiple-choice options to value/key pairs', () => {
    expect(
      normalizeLeadFormQuestion({
        type: 'CUSTOM',
        label: 'Preferred time?',
        options: ['ASAP', 'Next week'],
      })
    ).toEqual({
      type: 'CUSTOM',
      label: 'Preferred time?',
      key: 'preferred_time',
      options: [
        { value: 'ASAP', key: 'asap' },
        { value: 'Next week', key: 'next_week' },
      ],
    });
  });

  it('never sends an empty label for a CUSTOM question with none given', () => {
    // Falls back to the generic CUSTOM label so Meta never gets an empty one.
    expect(normalizeLeadFormQuestion({ type: 'CUSTOM' })).toEqual({
      type: 'CUSTOM',
      label: 'Custom Question',
      key: 'custom_question',
    });
  });
});
