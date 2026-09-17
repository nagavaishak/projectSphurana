import { createLogger } from '@borradh-workspace/observability';
import { getFieldValue, isEmpty } from './parse-lead-field.js';
import type { ConditionNodeConfig, LeadData } from './types.js';

const logger = createLogger('SequenceExecutor');

/**
 * Evaluate a condition against lead data
 * Returns true if the condition is satisfied, false otherwise
 */
export function evaluateCondition(
  config: ConditionNodeConfig,
  leadData: LeadData
): boolean {
  const { field, operator, value, type, caseSensitive, treatEmptyAsNull } =
    config;

  // Get the field value from lead data
  const fieldValue = getFieldValue(field, leadData);

  // Handle empty checks first
  if (operator === 'is_empty') {
    return isEmpty(fieldValue, treatEmptyAsNull);
  }
  if (operator === 'is_not_empty') {
    return !isEmpty(fieldValue, treatEmptyAsNull);
  }

  // If field value is empty and we're doing comparisons, return false
  if (isEmpty(fieldValue, treatEmptyAsNull)) {
    return false;
  }

  // Normalize values based on type
  let normalizedFieldValue: string | number | boolean = String(fieldValue);
  let normalizedCompareValue: string | number | boolean = value;

  if (type === 'number') {
    normalizedFieldValue = Number(fieldValue);
    normalizedCompareValue = Number(value);
    if (
      Number.isNaN(normalizedFieldValue) ||
      Number.isNaN(normalizedCompareValue)
    ) {
      logger.warn('Invalid number comparison', { field, fieldValue, value });
      return false;
    }
  } else if (type === 'boolean') {
    normalizedFieldValue =
      fieldValue === true ||
      fieldValue === 'true' ||
      fieldValue === '1' ||
      fieldValue === 1;
    normalizedCompareValue = value === 'true' || value === '1';
  } else if (type === 'date') {
    // Compare dates as timestamps
    const fieldDate = new Date(fieldValue as string).getTime();
    const compareDate = new Date(value).getTime();
    if (Number.isNaN(fieldDate) || Number.isNaN(compareDate)) {
      logger.warn('Invalid date comparison', { field, fieldValue, value });
      return false;
    }
    normalizedFieldValue = fieldDate;
    normalizedCompareValue = compareDate;
  } else {
    // String type - handle case sensitivity
    if (!caseSensitive) {
      normalizedFieldValue = String(fieldValue).toLowerCase();
      normalizedCompareValue = value.toLowerCase();
    }
  }

  // Evaluate the operator
  return evaluateOperator(
    operator,
    normalizedFieldValue,
    normalizedCompareValue,
    fieldValue,
    field,
    value,
    caseSensitive
  );
}

/**
 * Evaluate a specific operator against normalized values
 */
function evaluateOperator(
  operator: string,
  normalizedFieldValue: string | number | boolean,
  normalizedCompareValue: string | number | boolean,
  rawFieldValue: unknown,
  field: string,
  rawValue: string,
  caseSensitive?: boolean
): boolean {
  switch (operator) {
    case 'equals':
      return normalizedFieldValue === normalizedCompareValue;

    case 'not_equals':
      return normalizedFieldValue !== normalizedCompareValue;

    case 'contains':
      return String(normalizedFieldValue).includes(
        String(normalizedCompareValue)
      );

    case 'not_contains':
      return !String(normalizedFieldValue).includes(
        String(normalizedCompareValue)
      );

    case 'starts_with':
      return String(normalizedFieldValue).startsWith(
        String(normalizedCompareValue)
      );

    case 'ends_with':
      return String(normalizedFieldValue).endsWith(
        String(normalizedCompareValue)
      );

    case 'greater_than':
      return normalizedFieldValue > normalizedCompareValue;

    case 'less_than':
      return normalizedFieldValue < normalizedCompareValue;

    case 'greater_or_equal':
      return normalizedFieldValue >= normalizedCompareValue;

    case 'less_or_equal':
      return normalizedFieldValue <= normalizedCompareValue;

    case 'matches_regex':
      return evaluateRegex(rawFieldValue, rawValue, field, caseSensitive);

    default:
      logger.warn('Unknown condition operator', { operator });
      return false;
  }
}

/**
 * Evaluate regex match with safety guards against ReDoS
 */
function evaluateRegex(
  fieldValue: unknown,
  pattern: string,
  field: string,
  caseSensitive?: boolean
): boolean {
  try {
    // Limit pattern length to prevent ReDoS via complex patterns
    if (pattern.length > 200) {
      logger.warn('Regex pattern too long', {
        field,
        patternLength: pattern.length,
      });
      return false;
    }
    // Reject patterns with known catastrophic backtracking constructs:
    // nested quantifiers like (a+)+, (a*)+, (a+)*, (a{1,})+
    if (/([+*}])\s*[)]\s*[+*{]/.test(pattern) || /([+*])\s*\1/.test(pattern)) {
      logger.warn('Regex pattern rejected for potential backtracking', {
        field,
        pattern,
      });
      return false;
    }
    const regex = new RegExp(pattern, caseSensitive ? '' : 'i');
    return regex.test(String(fieldValue));
  } catch {
    logger.warn('Invalid regex pattern', { field, pattern });
    return false;
  }
}
