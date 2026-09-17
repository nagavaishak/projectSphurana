/**
 * Lead-specific error codes
 */
export const LeadErrorCodes = {
  LEAD_NOT_FOUND: 'LEAD_NOT_FOUND',
  LEAD_ALREADY_EXISTS: 'LEAD_ALREADY_EXISTS',
  INVALID_LEAD_STATUS: 'INVALID_LEAD_STATUS',
  INVALID_LEAD_SOURCE: 'INVALID_LEAD_SOURCE',
  SEQUENCE_NOT_FOUND: 'SEQUENCE_NOT_FOUND',
  SEQUENCE_ALREADY_ASSIGNED: 'SEQUENCE_ALREADY_ASSIGNED',
} as const;

export type LeadErrorCode =
  (typeof LeadErrorCodes)[keyof typeof LeadErrorCodes];
