/**
 * Meta-Provided "555" Free WhatsApp Business Phone Numbers.
 *
 * These are synthetic US `+1-555-*` numbers Meta issues to eligible
 * businesses in the WhatsApp Manager "Use a display name only" flow.
 * They work for general Cloud API messaging (inbox, templates, chatbots)
 * but are **ineligible for click-to-WhatsApp ads** — Meta rejects them
 * from `promoted_object.whatsapp_phone_number` during ad set creation.
 *
 * Meta does not expose a typed "is_free_number" flag on the phone number
 * node, so detection is a prefix match on the E.164 string. Third-party
 * platforms (360Dialog, Twilio, WATI) all detect the same way.
 */
export const isMetaFreeWhatsAppNumber = (
  displayPhoneNumber: string | null | undefined
): boolean => {
  if (!displayPhoneNumber) return false;
  const digits = displayPhoneNumber.replace(/[^0-9]/g, '');
  return digits.startsWith('1555');
};
