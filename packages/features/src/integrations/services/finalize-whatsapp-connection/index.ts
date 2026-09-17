export {
  finalizeWhatsAppConnection,
  type FinalizeWhatsAppConnectionResult,
  type FinalizeWhatsAppConnectionResultData,
} from './finalize-whatsapp-connection.service.js';
export {
  finalizeWhatsAppConnectionSchema,
  type FinalizeWhatsAppConnectionInput,
} from './finalize-whatsapp-connection.schema.js';
// Exported for the backfill that gives clinics who connected WhatsApp BEFORE
// the outbound sequence shipped the same templates a new connection gets.
export { ensureFirstTouchTemplate } from './ensure-first-touch-template.js';
