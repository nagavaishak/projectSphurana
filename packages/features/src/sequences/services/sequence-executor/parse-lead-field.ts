import type { LastCallData, LeadData } from './types.js';

/**
 * Get a value from lead data using dot notation path
 * E.g., "lead.firstName" -> leadData.firstName
 *       "lead.status" -> leadData.status
 *       "lastCall.sentiment" -> leadData.lastCall.sentiment
 *       "lastCall.appointmentBooked" -> leadData.lastCall.appointmentBooked
 */
export function getFieldValue(fieldPath: string, leadData: LeadData): unknown {
  // Handle lastCall.* paths
  if (fieldPath.startsWith('lastCall.')) {
    const callField = fieldPath.replace('lastCall.', '');
    if (!leadData.lastCall) {
      return undefined;
    }
    return leadData.lastCall[callField as keyof LastCallData];
  }

  // Remove "lead." prefix if present
  const cleanPath = fieldPath.replace(/^lead\./, '');

  // Handle nested paths like "metadata.custom"
  const parts = cleanPath.split('.');
  let value: unknown = leadData;

  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'object') {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Check if a value is empty (null, undefined, or empty string)
 */
export function isEmpty(value: unknown, treatEmptyAsNull = true): boolean {
  if (value === null || value === undefined) return true;
  if (treatEmptyAsNull && value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}
