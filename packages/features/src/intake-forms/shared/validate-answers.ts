import type {
  IntakeAnswer,
  IntakeFormField,
} from '@borradh-workspace/database';
import { intakeNonInputFieldTypes } from '@borradh-workspace/labels';

export interface AnswerValidationError {
  fieldId: string;
  message: string;
}

const isNonInput = (type: IntakeFormField['type']): boolean =>
  (intakeNonInputFieldTypes as readonly string[]).includes(type);

const isBlank = (answer: IntakeAnswer | undefined): boolean => {
  if (answer === undefined || answer === null) return true;
  if (typeof answer === 'string') return answer.trim() === '';
  if (Array.isArray(answer)) return answer.length === 0;
  if (typeof answer === 'boolean') return answer === false; // an unticked consent box
  if (typeof answer === 'object') return !answer.dataUrl; // an unsigned signature
  return false;
};

/**
 * Validate a submission's answers against the questions AS ASKED
 * (`fieldsSnapshot`), not the live form — a submission is judged by the form
 * the patient actually saw.
 *
 * This is where "required forms" earns its name: a required question left blank
 * is an error, so a required intake form cannot be marked completed with holes
 * in it. Shape is also checked (a single_select must be a string, a multi_select
 * an array) so a malformed client payload can't smuggle a wrong-typed answer
 * into a legal record.
 *
 * Section headings hold no answer and are skipped. Answers to unknown field ids
 * are dropped by the caller, not errored — a form edited between send and submit
 * should not hard-fail a patient who filled in the version they were given.
 */
export const validateIntakeAnswers = (
  fields: IntakeFormField[],
  answers: Record<string, IntakeAnswer>
): AnswerValidationError[] => {
  const errors: AnswerValidationError[] = [];

  for (const field of fields) {
    if (isNonInput(field.type)) continue;

    const answer = answers[field.id];
    const blank = isBlank(answer);

    if (field.required && blank) {
      errors.push({ fieldId: field.id, message: `${field.label} is required` });
      continue;
    }

    // An optional field left blank is fine; only type-check what was answered.
    if (blank) continue;

    const typeError = checkShape(field, answer as IntakeAnswer);
    if (typeError) errors.push({ fieldId: field.id, message: typeError });
  }

  return errors;
};

const checkShape = (
  field: IntakeFormField,
  answer: IntakeAnswer
): string | null => {
  switch (field.type) {
    case 'multi_select':
      if (!Array.isArray(answer)) return `${field.label} must be a list`;
      if (
        field.options &&
        !answer.every((v) => field.options?.includes(v as string))
      ) {
        return `${field.label} has an invalid choice`;
      }
      return null;

    case 'single_select':
    case 'dropdown':
      if (typeof answer !== 'string') return `${field.label} must be a choice`;
      if (field.options && !field.options.includes(answer)) {
        return `${field.label} has an invalid choice`;
      }
      return null;

    case 'checkbox':
      return typeof answer === 'boolean'
        ? null
        : `${field.label} must be yes or no`;

    case 'signature':
      return typeof answer === 'object' &&
        answer !== null &&
        !Array.isArray(answer) &&
        typeof answer.dataUrl === 'string'
        ? null
        : `${field.label} must be signed`;

    case 'short_text':
    case 'long_text':
    case 'date':
      return typeof answer === 'string' ? null : `${field.label} is invalid`;

    default:
      return null;
  }
};
