/**
 * Extract lead fields from Meta field_data format.
 *
 * Hardened against malformed payloads: Meta (or a replayed/partial webhook)
 * can omit `field_data` entirely or send a field without a `values` array.
 * Neither must crash the caller — a crash here silently drops the lead and
 * triggers Meta retry-storms (see ENG-367 / API-55).
 */
export function extractLeadFields(
  fieldData: { name: string; values?: string[] }[] | null | undefined
): {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  fullName?: string;
  formData: Record<string, unknown>;
} {
  const result: Record<string, string | undefined> = {};
  const formData: Record<string, unknown> = {};

  for (const field of Array.isArray(fieldData) ? fieldData : []) {
    if (!field || typeof field.name !== 'string') continue;
    const values = field.values ?? [];
    const value = values[0] ?? '';
    const name = field.name.toLowerCase();

    // Map standard Meta fields to our lead fields
    switch (name) {
      case 'full_name':
      case 'fullname':
        result.fullName = value;
        break;
      case 'first_name':
      case 'firstname':
        result.firstName = value;
        break;
      case 'last_name':
      case 'lastname':
        result.lastName = value;
        break;
      case 'email':
        result.email = value;
        break;
      case 'phone_number':
      case 'phone':
        result.phone = value;
        break;
      default:
        // Store all other fields in formData
        formData[field.name] = values.length === 1 ? value : values;
    }
  }

  // If we have full_name but not first/last, split it
  if (result.fullName && !result.firstName) {
    const parts = result.fullName.trim().split(/\s+/);
    result.firstName = parts[0];
    const lastNamePart = parts.slice(1).join(' ');
    result.lastName = lastNamePart || undefined;
  }

  return {
    firstName: result.firstName,
    lastName: result.lastName,
    email: result.email,
    phone: result.phone,
    fullName: result.fullName,
    formData,
  };
}
