import type { LeadData } from './types.js';

/**
 * Check if the lead has consent for the given step type.
 * Returns the skipped reason string if consent is missing, or null if consent is granted.
 */
export function checkConsentForStep(
  stepType: string,
  leadData: LeadData
): string | null {
  switch (stepType) {
    case 'email':
      return leadData.consentEmail ? null : 'no_consent';
    case 'sms':
    case 'whatsapp':
      return leadData.consentSms ? null : 'no_consent';
    case 'voice_call':
      return leadData.consentVoice ? null : 'no_consent';
    default:
      return null; // Non-contact steps (wait, condition, webhook) don't require consent
  }
}
