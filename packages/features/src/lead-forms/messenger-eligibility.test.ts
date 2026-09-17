/**
 * Guards Messenger auto-start eligibility (ENG-641 / ENG-643).
 *
 * Since ENG-641 every lead form we create asks Meta to open a Messenger thread
 * the moment someone submits — the lead taps nothing. Meta only permits that
 * when every field on the form is one it allows. One field outside that set
 * and the whole thing reverts to the tap-required button, which almost nobody
 * presses.
 *
 * Imported via `@borradh-workspace/features/shared` to also exercise the
 * labels → features/shared re-export chain the API adapter relies on.
 */
import { describe, expect, it } from '@borradh-workspace/testing';
import {
  defaultLeadFormQuestions,
  fromMetaQuestionType,
  isMessengerEligible,
  leadFormFieldTypeValues,
  messengerDisqualifyingQuestionTypes,
  messengerEligibleQuestionTypes,
  toMetaQuestionType,
} from '../shared/index.js';

/**
 * Meta's `questions[].type` enum is its own vocabulary. Sending a type it does
 * not recognise fails the WHOLE form with `(#100) Param questions[n][type]
 * must be one of {...}`, so one wrong value makes a form permanently
 * unsyncable. `DATE_OF_BIRTH` did exactly that — Meta calls it `DOB`.
 */
describe('Meta question-type mapping', () => {
  it('sends date of birth as Meta’s DOB', () => {
    expect(toMetaQuestionType('DATE_OF_BIRTH')).toBe('DOB');
  });

  it('reads Meta’s DOB back as ours', () => {
    expect(fromMetaQuestionType('DOB')).toBe('DATE_OF_BIRTH');
  });

  it('round-trips every field type we expose', () => {
    for (const type of leadFormFieldTypeValues) {
      expect(fromMetaQuestionType(toMetaQuestionType(type))).toBe(type);
    }
  });

  it('passes through every type Meta already agrees with', () => {
    // Verified against the enum Meta returned in the #100 rejection: only
    // DATE_OF_BIRTH differs; the rest of our list matches verbatim.
    for (const type of leadFormFieldTypeValues) {
      if (type === 'DATE_OF_BIRTH') continue;
      expect(toMetaQuestionType(type)).toBe(type);
    }
  });

  it('leaves unknown types untouched rather than dropping them', () => {
    expect(toMetaQuestionType('POST_CODE')).toBe('POST_CODE');
    expect(fromMetaQuestionType('POST_CODE')).toBe('POST_CODE');
  });
});

describe('Messenger auto-start eligibility', () => {
  it('accepts exactly the field types Meta permits', () => {
    // Drift here silently costs every new form its auto-start, so the list is
    // pinned — changing it has to be a deliberate edit to this test too.
    expect([...messengerEligibleQuestionTypes].sort()).toEqual([
      'CUSTOM',
      'EMAIL',
      'FIRST_NAME',
      'FULL_NAME',
      'LAST_NAME',
      'PHONE',
    ]);
  });

  it('keeps auto-start on for the questions we ship by default', () => {
    // The whole point of ENG-641: a form built with our defaults reaches leads
    // without them tapping anything.
    expect(isMessengerEligible(defaultLeadFormQuestions)).toBe(true);
  });

  it('turns off as soon as any other field type is added', () => {
    for (const type of messengerDisqualifyingQuestionTypes) {
      expect(isMessengerEligible([{ type: 'EMAIL' }, { type }])).toBe(false);
    }
  });

  it('partitions every known field type into eligible or disqualifying', () => {
    // A newly added field type must land on one side or the other — never be
    // quietly absent from both.
    expect(
      messengerDisqualifyingQuestionTypes.length +
        messengerEligibleQuestionTypes.length
    ).toBe(leadFormFieldTypeValues.length);

    const eligible = new Set<string>(messengerEligibleQuestionTypes);
    for (const type of messengerDisqualifyingQuestionTypes) {
      expect(eligible.has(type)).toBe(false);
    }
  });

  it('names the fields owners most often ask Claire to add', () => {
    // `manage-lead-forms` invites these by name, so they are the ones the
    // trade-off warning exists for.
    expect(messengerDisqualifyingQuestionTypes).toEqual(
      expect.arrayContaining(['CITY', 'DATE_OF_BIRTH', 'GENDER', 'ZIP'])
    );
  });

  it('treats an empty question set as eligible', () => {
    expect(isMessengerEligible([])).toBe(true);
  });
});
