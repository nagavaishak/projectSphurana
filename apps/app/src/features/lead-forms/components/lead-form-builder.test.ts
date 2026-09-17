/**
 * Unit tests for the lead-form builder helpers, focused on multiple-choice
 * CUSTOM questions (PRD-18). These pure helpers thread `options` from the
 * editable builder state through to the API payload and back, so a
 * multiple-choice question (e.g. the default "how soon are you hoping to get
 * this treatment done?") survives create, edit, and round-trip.
 */
import { describe, expect, it } from 'vitest';

import {
  emptyLeadFormBuilderValue,
  leadFormBuilderToInput,
  leadFormToBuilderValue,
  validateLeadFormBuilder,
} from './lead-form-builder';

describe('emptyLeadFormBuilderValue', () => {
  it('seeds the default multiple-choice treatment-timing question', () => {
    const value = emptyLeadFormBuilderValue();

    const custom = value.questions.find((q) => q.type === 'CUSTOM');
    expect(custom).toBeDefined();
    expect(custom?.label).toBe(
      'How soon are you hoping to get this treatment done?'
    );
    expect(custom?.options?.map((o) => o.value)).toEqual([
      'ASAP',
      '1 week',
      '2 weeks',
    ]);
  });

  it('keeps the standard name/email/phone fields ahead of the custom one', () => {
    const value = emptyLeadFormBuilderValue();
    expect(value.questions.map((q) => q.type)).toEqual([
      'FULL_NAME',
      'EMAIL',
      'PHONE',
      'CUSTOM',
    ]);
  });

  it('gives each seeded question a unique id', () => {
    const ids = emptyLeadFormBuilderValue().questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('leadFormBuilderToInput — multiple-choice options', () => {
  const base = emptyLeadFormBuilderValue();

  it('maps CUSTOM options through to the API question and derives option keys', () => {
    const input = leadFormBuilderToInput({
      ...base,
      name: 'Consult form',
      privacyPolicyUrl: 'https://clinic.example/privacy',
    });

    const custom = input.questions.find((q) => q.type === 'CUSTOM');
    expect(custom?.options).toEqual([
      { value: 'ASAP', key: 'asap' },
      { value: '1 week', key: '1_week' },
      { value: '2 weeks', key: '2_weeks' },
    ]);
    // The default carries an explicit key, which is preserved.
    expect(custom?.key).toBe('treatment_timing');
    expect(custom?.required).toBe(true);
  });

  it('drops blank options and keeps explicit option keys', () => {
    const input = leadFormBuilderToInput({
      ...base,
      questions: [
        {
          id: 'q1',
          type: 'CUSTOM',
          label: 'Preferred area',
          options: [
            { value: '  Lips  ' },
            { value: '', key: 'ignored' },
            { value: 'Cheeks', key: 'CHEEK_KEY' },
          ],
        },
      ],
    });

    expect(input.questions[0].options).toEqual([
      { value: 'Lips', key: 'lips' },
      { value: 'Cheeks', key: 'CHEEK_KEY' },
    ]);
  });

  it('omits options entirely for a plain (non-multiple-choice) CUSTOM question', () => {
    const input = leadFormBuilderToInput({
      ...base,
      questions: [{ id: 'q1', type: 'CUSTOM', label: 'Anything else?' }],
    });
    expect(input.questions[0]).toEqual({
      type: 'CUSTOM',
      label: 'Anything else?',
      key: 'anything_else?',
      options: undefined,
      required: true,
    });
  });

  it('omits options when every option is blank', () => {
    const input = leadFormBuilderToInput({
      ...base,
      questions: [
        {
          id: 'q1',
          type: 'CUSTOM',
          label: 'Empty choices',
          options: [{ value: '   ' }, { value: '' }],
        },
      ],
    });
    expect(input.questions[0].options).toBeUndefined();
  });

  it('never attaches options or labels to standard fields', () => {
    const input = leadFormBuilderToInput({
      ...base,
      questions: [{ id: 'q1', type: 'PHONE' }],
    });
    expect(input.questions[0]).toEqual({ type: 'PHONE', required: true });
  });
});

describe('leadFormToBuilderValue — round-trips options from the API', () => {
  it('hydrates options from an existing form so editing preserves them', () => {
    const value = leadFormToBuilderValue({
      name: 'Consult form',
      privacyPolicyUrl: 'https://clinic.example/privacy',
      questions: [
        { type: 'FULL_NAME' },
        {
          type: 'CUSTOM',
          label: 'How soon?',
          key: 'timing',
          options: [
            { value: 'ASAP', key: 'asap' },
            { value: '1 week', key: '1_week' },
          ],
        },
      ],
    });

    const custom = value.questions.find((q) => q.type === 'CUSTOM');
    expect(custom?.options).toEqual([
      { value: 'ASAP', key: 'asap' },
      { value: '1 week', key: '1_week' },
    ]);
  });

  it('leaves options undefined for questions without them', () => {
    const value = leadFormToBuilderValue({
      name: 'x',
      privacyPolicyUrl: 'https://clinic.example/privacy',
      questions: [{ type: 'EMAIL' }],
    });
    expect(value.questions[0].options).toBeUndefined();
  });

  it('survives a full default → input → builder round-trip', () => {
    const input = leadFormBuilderToInput({
      ...emptyLeadFormBuilderValue(),
      name: 'Consult form',
      privacyPolicyUrl: 'https://clinic.example/privacy',
    });
    const rehydrated = leadFormToBuilderValue({
      name: input.name,
      privacyPolicyUrl: input.privacyPolicyUrl,
      questions: input.questions,
    });
    const custom = rehydrated.questions.find((q) => q.type === 'CUSTOM');
    expect(custom?.options?.map((o) => o.value)).toEqual([
      'ASAP',
      '1 week',
      '2 weeks',
    ]);
  });
});

describe('validateLeadFormBuilder — multiple-choice rules', () => {
  const ready = (): ReturnType<typeof emptyLeadFormBuilderValue> => ({
    ...emptyLeadFormBuilderValue(),
    name: 'Consult form',
    privacyPolicyUrl: 'https://clinic.example/privacy',
  });

  it('accepts the default form (3 valid options)', () => {
    expect(validateLeadFormBuilder(ready()).firstInvalidStep).toBe(-1);
  });

  it('flags a multiple-choice question with fewer than 2 non-empty options', () => {
    const value = ready();
    const result = validateLeadFormBuilder({
      ...value,
      questions: [
        {
          id: 'q1',
          type: 'CUSTOM',
          label: 'Pick one',
          options: [{ value: 'Only' }],
        },
      ],
    });
    expect(result.firstInvalidStep).toBe(0);
    expect(result.errors.question_q1).toMatch(/at least 2 answer options/i);
  });

  it('counts blank options as missing when validating', () => {
    const value = ready();
    const result = validateLeadFormBuilder({
      ...value,
      questions: [
        {
          id: 'q1',
          type: 'CUSTOM',
          label: 'Pick one',
          options: [{ value: 'A' }, { value: '   ' }],
        },
      ],
    });
    expect(result.errors.question_q1).toMatch(/at least 2 answer options/i);
  });

  it('still requires a label on a custom question before checking options', () => {
    const value = ready();
    const result = validateLeadFormBuilder({
      ...value,
      questions: [
        { id: 'q1', type: 'CUSTOM', label: '', options: [{ value: 'A' }] },
      ],
    });
    expect(result.errors.question_q1).toMatch(/need a label/i);
  });
});
