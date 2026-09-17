/**
 * WhatsApp pairing (WS-3). Light sub-barrel grouping the four pairing services
 * + status read so callers can `import { ... } from
 * '@borradh-workspace/features/assistant'` (these are re-exported from the
 * assistant package barrel). Lifecycle: start → pending row + code; verify →
 * stamp sender E.164 + active; resolve → active lookup by phone (webhook hot
 * path); revoke → null the phone so the number can re-pair.
 */
export {
  startWhatsappLink,
  startWhatsappLinkSchema,
  type StartWhatsappLinkInput,
  type StartWhatsappLinkOutput,
} from '../services/start-whatsapp-link/index.js';
export {
  verifyWhatsappLink,
  verifyWhatsappLinkSchema,
  type VerifyWhatsappLinkInput,
  type VerifyWhatsappLinkOutput,
} from '../services/verify-whatsapp-link/index.js';
export {
  resolveOwnerByPhone,
  type ResolvedOwner,
} from '../services/resolve-owner-by-phone/index.js';
export {
  revokeWhatsappLink,
  revokeWhatsappLinkSchema,
  type RevokeWhatsappLinkInput,
} from '../services/revoke-whatsapp-link/index.js';
export {
  getWhatsappLinkStatus,
  getWhatsappLinkStatusSchema,
  type GetWhatsappLinkStatusInput,
  type WhatsappLinkStatus,
} from '../services/get-whatsapp-link-status/index.js';
