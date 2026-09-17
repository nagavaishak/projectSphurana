import type { SampleRecipient } from '../../api/types';

/**
 * Generic sample recipient used when no real segment data is available yet, so
 * the composer preview always shows a plausible, personalized message.
 */
export const GENERIC_SAMPLE_RECIPIENT: SampleRecipient = {
  leadId: 'sample',
  firstName: 'Sarah',
  email: 'sarah@example.com',
  phone: null,
  whatsapp: null,
};

/** The merge fields that can appear as `{{field|fallback}}` tokens in copy. */
const MERGE_FIELDS = ['firstName', 'email', 'phone', 'whatsapp'] as const;
type MergeField = (typeof MERGE_FIELDS)[number];

function isMergeField(field: string): field is MergeField {
  return (MERGE_FIELDS as readonly string[]).includes(field);
}

/**
 * Replace named merge tokens — `{{firstName}}` or `{{firstName|there}}` — with
 * the recipient's value, or the token's `|fallback` when the field is missing.
 *
 * Positional WhatsApp params (`{{1}}`, `{{2}}`) are intentionally NOT touched
 * here — they are filled by `fillWhatsappTemplate`. When `recipient` is
 * undefined a generic sample ("Sarah") is used so the preview is never blank.
 */
export function mergeResolve(
  text: string,
  recipient: SampleRecipient | undefined
): string {
  const source = recipient ?? GENERIC_SAMPLE_RECIPIENT;
  return text.replace(
    /\{\{\s*([a-zA-Z]\w*)\s*(?:\|\s*([^}]*?))?\s*\}\}/g,
    (_match, field: string, fallback: string | undefined) => {
      const value = isMergeField(field) ? source[field] : null;
      if (typeof value === 'string' && value.length > 0) return value;
      return fallback ?? '';
    }
  );
}
