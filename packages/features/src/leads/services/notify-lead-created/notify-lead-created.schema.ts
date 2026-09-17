import { leadSourceValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const notifyLeadCreatedSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  leadId: z.string().min(1, 'Lead ID is required'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().nullish(),
  source: z.enum(leadSourceValues),
  /** The service the lead enquired about, when known. */
  serviceName: z.string().nullish(),
  /** The lead's owner. Drives "mine"-scoped preferences; usually unset. */
  assignedToId: z.string().nullish(),
  /**
   * Set when the lead came in through a conversation. Lets a near-simultaneous
   * `chatbot_handoff` suppress itself so one arriving lead pings once.
   */
  conversationId: z.string().nullish(),
});

export type NotifyLeadCreatedInput = z.infer<typeof notifyLeadCreatedSchema>;
