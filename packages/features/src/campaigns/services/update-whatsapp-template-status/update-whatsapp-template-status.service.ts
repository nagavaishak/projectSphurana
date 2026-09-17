import {
  type WhatsappTemplate,
  whatsappAccount,
  whatsappTemplate,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateWhatsappTemplateStatusInput,
  updateWhatsappTemplateStatusSchema,
} from './update-whatsapp-template-status.schema.js';

/**
 * Reconcile a WhatsApp template's local approval status from a Meta
 * `message_template_status_update` webhook, so the composer's template picker
 * and launch pre-flight reflect approval/rejection WITHOUT a manual refresh.
 *
 * Runs system-scoped (the caller is the unauthenticated webhook dispatcher):
 * the org is resolved from the WABA id, then the cached `whatsapp_template`
 * row is updated by `metaTemplateId` (preferred) or `name`+`languageCode`.
 *
 * Idempotent and lenient: an unknown Meta event, an unlinked WABA, or a
 * template we've never cached all resolve to `{ updated: 0 }` rather than an
 * error — a webhook must not 500 and trigger Meta's retry storm.
 */

/** Meta template status events → our whatsapp_template status enum. */
const EVENT_STATUS_MAP: Record<string, WhatsappTemplate['status']> = {
  APPROVED: 'approved',
  REINSTATED: 'approved',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  FLAGGED: 'paused',
  DISABLED: 'disabled',
  PENDING_DELETION: 'disabled',
  DELETED: 'disabled',
  PENDING: 'pending',
  PENDING_REVIEW: 'pending',
};

const toLocalStatus = (event: string): WhatsappTemplate['status'] | undefined =>
  EVENT_STATUS_MAP[event.trim().toUpperCase()];

export interface UpdateWhatsappTemplateStatusData {
  /** How many cached template rows were updated (0, or 1 in practice). */
  updated: number;
  /** The mapped local status, or null when the event was unrecognised. */
  status: WhatsappTemplate['status'] | null;
}

const updateWhatsappTemplateStatusImpl = async (
  db: DbConnection,
  input: UpdateWhatsappTemplateStatusInput
): Promise<Result<UpdateWhatsappTemplateStatusData>> => {
  const parsed = updateWhatsappTemplateStatusSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { wabaId, metaTemplateId, name, languageCode, event } = parsed.data;

  const status = toLocalStatus(event);
  // Unknown event (e.g. a category/quality signal we don't model) — nothing to
  // do, but not an error.
  if (!status) return ok({ updated: 0, status: null });

  // No usable identifier — can't target a row.
  if (!metaTemplateId && !(name && languageCode)) {
    return ok({ updated: 0, status });
  }

  // Resolve the org that owns this WABA. An unlinked WABA (webhook for an
  // account we don't track) is a no-op, not a failure.
  const account = await db.query.whatsappAccount.findFirst({
    where: eq(whatsappAccount.wabaId, wabaId),
    columns: { organizationId: true },
  });
  if (!account) return ok({ updated: 0, status });

  const now = new Date();

  // Prefer matching on the stable Meta template id.
  if (metaTemplateId) {
    const byId = await db
      .update(whatsappTemplate)
      .set({ status, syncedAt: now })
      .where(
        and(
          eq(whatsappTemplate.organizationId, account.organizationId),
          eq(whatsappTemplate.metaTemplateId, metaTemplateId)
        )
      )
      .returning({ id: whatsappTemplate.id });
    if (byId.length > 0) return ok({ updated: byId.length, status });
  }

  // Fall back to name+language (e.g. a template registered before its metaId
  // was cached). Backfill the metaTemplateId when we have it.
  if (name && languageCode) {
    const byName = await db
      .update(whatsappTemplate)
      .set({
        status,
        syncedAt: now,
        ...(metaTemplateId ? { metaTemplateId } : {}),
      })
      .where(
        and(
          eq(whatsappTemplate.organizationId, account.organizationId),
          eq(whatsappTemplate.name, name),
          eq(whatsappTemplate.languageCode, languageCode)
        )
      )
      .returning({ id: whatsappTemplate.id });
    return ok({ updated: byName.length, status });
  }

  return ok({ updated: 0, status });
};

export const updateWhatsappTemplateStatus = (
  db: DbConnection,
  input: UpdateWhatsappTemplateStatusInput
) =>
  trackedResult(
    'campaigns.updateWhatsappTemplateStatus',
    () => updateWhatsappTemplateStatusImpl(db, input),
    {
      properties: {
        wabaId: input.wabaId,
        metaTemplateId: input.metaTemplateId,
        event: input.event,
      },
    }
  );

export type UpdateWhatsappTemplateStatusResult = Awaited<
  ReturnType<typeof updateWhatsappTemplateStatus>
>;
