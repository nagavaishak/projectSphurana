import {
  and,
  appointment,
  asset,
  assistantConversation,
  conversation,
  eq,
  graphic,
  inArray,
  instagramIntegration,
  isNull,
  lead,
  leadForm,
  metaAdsIntegration,
  offer,
  offerLocation,
  offerService,
  organizationIntegration,
  organizationLocation,
  organizationService,
  practitioner,
  sequence,
  socialPost,
  video,
} from '@borradh-workspace/database';
import type { AnyColumn } from 'drizzle-orm';
import type { DbConnection } from './types.js';

export function notDeleted<T extends { deletedAt: AnyColumn }>(table: T) {
  return isNull(table.deletedAt);
}

export async function softDeleteOrgChildren(
  db: DbConnection,
  organizationId: string
): Promise<void> {
  const deletedAt = new Date();

  // Identify org's offer IDs for junction cleanup (subquery).
  const orgOfferIds = db
    .select({ id: offer.id })
    .from(offer)
    .where(eq(offer.organizationId, organizationId));

  await Promise.all([
    db
      .update(asset)
      .set({ deletedAt })
      .where(and(eq(asset.organizationId, organizationId), notDeleted(asset))),
    db
      .update(video)
      .set({ deletedAt })
      .where(and(eq(video.organizationId, organizationId), notDeleted(video))),
    db
      .update(lead)
      .set({ deletedAt })
      .where(and(eq(lead.organizationId, organizationId), notDeleted(lead))),
    db
      .update(offer)
      .set({ deletedAt })
      .where(and(eq(offer.organizationId, organizationId), notDeleted(offer))),
    // Hard-delete offer junction rows: soft-delete does not trigger FK CASCADE.
    db
      .delete(offerService)
      .where(inArray(offerService.offerId, orgOfferIds)),
    db.delete(offerLocation).where(inArray(offerLocation.offerId, orgOfferIds)),
    db
      .update(sequence)
      .set({ deletedAt })
      .where(
        and(eq(sequence.organizationId, organizationId), notDeleted(sequence))
      ),
    db
      .update(appointment)
      .set({ deletedAt })
      .where(
        and(
          eq(appointment.organizationId, organizationId),
          notDeleted(appointment)
        )
      ),
    db
      .update(practitioner)
      .set({ deletedAt, isActive: false })
      .where(
        and(
          eq(practitioner.organizationId, organizationId),
          notDeleted(practitioner)
        )
      ),
    db
      .update(assistantConversation)
      .set({ deletedAt })
      .where(
        and(
          eq(assistantConversation.organizationId, organizationId),
          notDeleted(assistantConversation)
        )
      ),
    // Hard-delete tables without deleted_at that would otherwise be orphaned.
    // FK CASCADE only fires on hard DELETE, not on UPDATE (soft-delete).
    // Billing/payment/audit records are intentionally excluded — kept for financial audit.
    db
      .delete(organizationIntegration)
      .where(eq(organizationIntegration.organizationId, organizationId)),
    db
      .delete(metaAdsIntegration)
      .where(eq(metaAdsIntegration.organizationId, organizationId)),
    db
      .delete(instagramIntegration)
      .where(eq(instagramIntegration.organizationId, organizationId)),
    db.delete(leadForm).where(eq(leadForm.organizationId, organizationId)),
    // organizationLocation CASCADE deletes org_location_opening_hours_exception
    db
      .delete(organizationLocation)
      .where(eq(organizationLocation.organizationId, organizationId)),
    db
      .delete(organizationService)
      .where(eq(organizationService.organizationId, organizationId)),
    // conversation CASCADE deletes conversation_message
    db
      .delete(conversation)
      .where(eq(conversation.organizationId, organizationId)),
    db.delete(socialPost).where(eq(socialPost.organizationId, organizationId)),
    db.delete(graphic).where(eq(graphic.organizationId, organizationId)),
  ]);
}

export async function softDeleteLeadChildren(
  db: DbConnection,
  leadId: string
): Promise<void> {
  await db
    .update(appointment)
    .set({ deletedAt: new Date() })
    .where(and(eq(appointment.leadId, leadId), notDeleted(appointment)));
}
