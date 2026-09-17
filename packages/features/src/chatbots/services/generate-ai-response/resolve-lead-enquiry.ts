import {
  conversation,
  lead,
  leadForm,
  organizationService,
} from '@borradh-workspace/database';
import type {
  ConversationMetadata,
  MessagingPlatform,
} from '@borradh-workspace/database';
import { createLogger } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';

import { findExistingLead } from '../../../conversations/services/handle-incoming-message/find-existing-lead.js';
import type { DbConnection } from '../../../shared/index.js';

const logger = createLogger('ResolveLeadEnquiry');

// Keys stored alongside real form answers that aren't part of the enquiry.
const SYSTEM_FORM_KEYS = new Set([
  'form_id',
  'page_id',
  'ad_id',
  'campaign_id',
  'created_time',
  'inbox_url',
]);

// Contact keys already captured as first-class lead fields.
const CONTACT_FORM_KEYS = new Set([
  'full name',
  'full_name',
  'fullname',
  'first_name',
  'firstname',
  'last_name',
  'lastname',
  'email',
  'phone',
  'phone_number',
  'name',
  'state',
]);

export interface LeadEnquiry {
  leadId: string;
  /** Human-readable summary of the lead form the customer submitted. */
  enquiryText: string;
  /** Service the form maps to, if known (form→service mapping). */
  serviceName: string | null;
}

interface ConversationLike {
  id: string;
  organizationId: string;
  platform: MessagingPlatform;
  externalUserId: string;
  metadata: unknown;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Meta sometimes stores multi-select answers as a JSON-encoded array string.
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          return arr.map((x) => humanize(String(x))).join(', ');
        }
      } catch {
        // fall through to plain humanize
      }
    }
    return humanize(value);
  }
  if (Array.isArray(value)) {
    return value.map((x) => humanize(String(x))).join(', ');
  }
  if (value == null) return '';
  return humanize(String(value));
}

function buildEnquiryText(
  formData: Record<string, unknown> | null,
  formName: string | null
): string {
  const lines: string[] = [];
  if (formName) lines.push(`Lead form: ${formName}`);

  if (formData) {
    for (const [key, value] of Object.entries(formData)) {
      const normalizedKey = key.toLowerCase();
      if (SYSTEM_FORM_KEYS.has(normalizedKey)) continue;
      if (CONTACT_FORM_KEYS.has(normalizedKey)) continue;
      if (value == null || value === '') continue;
      const formatted = formatValue(value);
      if (!formatted) continue;
      lines.push(`- ${humanize(key)}: ${formatted}`);
    }
  }

  return lines.join('\n');
}

/**
 * Resolve what the customer originally enquired about via a Meta lead form.
 *
 * The chatbot otherwise only sees the chat message and the full service list,
 * so for a lead-form follow-up it has no idea which service the form was for.
 * This:
 *  1. Finds the originating lead (from the stored leadId, or by late-linking
 *     on phone/email once captured — the only way to reach Messenger/IG
 *     lead-form leads, which carry no PSID).
 *  2. Summarises the form answers (the question text usually names the service).
 *  3. Resolves the mapped service name via the lead form, when known.
 *
 * Returns null when there's no useful enquiry to surface.
 */
export async function resolveLeadEnquiry(
  db: DbConnection,
  conv: ConversationLike
): Promise<LeadEnquiry | null> {
  const metadata = (conv.metadata as ConversationMetadata | null) ?? null;
  const storedLeadId = metadata?.leadId ?? null;

  let leadRow = storedLeadId
    ? ((await db.query.lead.findFirst({
        where: eq(lead.id, storedLeadId),
      })) ?? null)
    : null;

  if (!leadRow) {
    // Late-link: Messenger/Instagram lead-form leads can only be matched once
    // contact info has been captured during the chat.
    leadRow = await findExistingLead(db, {
      organizationId: conv.organizationId,
      platform: conv.platform,
      senderId: conv.externalUserId,
      phone: metadata?.phone ?? null,
      email: metadata?.email ?? null,
    });

    if (leadRow && leadRow.id !== storedLeadId) {
      // Persist the link so later turns skip the lookup (best-effort).
      try {
        await db
          .update(conversation)
          .set({
            leadId: leadRow.id,
            metadata: { ...(metadata ?? {}), leadId: leadRow.id },
          })
          .where(eq(conversation.id, conv.id));
      } catch (error) {
        logger.warn('Failed to persist late lead link', {
          conversationId: conv.id,
          leadId: leadRow.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (!leadRow) return null;

  const formData = (leadRow.formData as Record<string, unknown> | null) ?? null;

  // Resolve the mapped service (and form name) via the lead form.
  let serviceName: string | null = null;
  let formName: string | null = null;
  const metaFormId =
    typeof formData?.form_id === 'string' ? formData.form_id : null;

  if (metaFormId) {
    const form = await db.query.leadForm.findFirst({
      where: and(
        eq(leadForm.organizationId, conv.organizationId),
        eq(leadForm.metaFormId, metaFormId)
      ),
      columns: { name: true, organizationServiceId: true },
    });
    formName = form?.name ?? null;

    if (form?.organizationServiceId) {
      const svc = await db.query.organizationService.findFirst({
        where: eq(organizationService.id, form.organizationServiceId),
        columns: { name: true, isActive: true },
      });
      if (svc?.isActive) serviceName = svc.name;
    }
  }

  const enquiryText = buildEnquiryText(formData, formName);
  if (!enquiryText && !serviceName) return null;

  return { leadId: leadRow.id, enquiryText, serviceName };
}
