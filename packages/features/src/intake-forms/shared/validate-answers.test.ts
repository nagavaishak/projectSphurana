import type { IntakeFormField } from '@borradh-workspace/database';
import { describe, expect, it } from '@borradh-workspace/testing';
import { validateIntakeAnswers } from './validate-answers.js';

const field = (
  over: Partial<IntakeFormField> &
    Pick<IntakeFormField, 'id' | 'type' | 'label'>
): IntakeFormField => over;

describe('validateIntakeAnswers', () => {
  it('passes when every required field is answered', () => {
    const fields = [
      field({ id: 'a', type: 'short_text', label: 'Name', required: true }),
      field({ id: 'b', type: 'long_text', label: 'Notes' }),
    ];
    expect(validateIntakeAnswers(fields, { a: 'Sarah' })).toEqual([]);
  });

  it('flags a required field left blank', () => {
    const fields = [
      field({ id: 'a', type: 'short_text', label: 'Name', required: true }),
    ];
    const errors = validateIntakeAnswers(fields, {});
    expect(errors).toHaveLength(1);
    expect(errors[0].fieldId).toBe('a');
  });

  it('treats whitespace as blank for a required text field', () => {
    const fields = [
      field({ id: 'a', type: 'short_text', label: 'Name', required: true }),
    ];
    expect(validateIntakeAnswers(fields, { a: '   ' })).toHaveLength(1);
  });

  it('treats an unticked required consent box as blank — the whole point of a consent form', () => {
    const fields = [
      field({ id: 'c', type: 'checkbox', label: 'I consent', required: true }),
    ];
    expect(validateIntakeAnswers(fields, { c: false })).toHaveLength(1);
    expect(validateIntakeAnswers(fields, { c: true })).toEqual([]);
  });

  it('treats an unsigned required signature as blank', () => {
    const fields = [
      field({ id: 's', type: 'signature', label: 'Signature', required: true }),
    ];
    expect(
      validateIntakeAnswers(fields, { s: { dataUrl: '', signedAt: '' } })
    ).toHaveLength(1);
    expect(
      validateIntakeAnswers(fields, {
        s: { dataUrl: 'data:image/png;base64,AAA', signedAt: 'now' },
      })
    ).toEqual([]);
  });

  it('never requires a section heading', () => {
    const fields = [
      field({ id: 'h', type: 'section', label: 'Please read', required: true }),
    ];
    expect(validateIntakeAnswers(fields, {})).toEqual([]);
  });

  it('type-checks an answered optional field', () => {
    const fields = [
      field({
        id: 'm',
        type: 'multi_select',
        label: 'Pick',
        options: ['x', 'y'],
      }),
    ];
    // A string where a list is expected is a malformed payload.
    expect(validateIntakeAnswers(fields, { m: 'x' as never })).toHaveLength(1);
    expect(validateIntakeAnswers(fields, { m: ['x'] })).toEqual([]);
  });

  it('rejects a choice outside the allowed options', () => {
    const fields = [
      field({ id: 'd', type: 'dropdown', label: 'Pick', options: ['a', 'b'] }),
    ];
    expect(validateIntakeAnswers(fields, { d: 'z' })).toHaveLength(1);
    expect(validateIntakeAnswers(fields, { d: 'a' })).toEqual([]);
  });

  it('ignores an optional field left blank', () => {
    const fields = [field({ id: 'a', type: 'short_text', label: 'Notes' })];
    expect(validateIntakeAnswers(fields, {})).toEqual([]);
  });
});
