import { metaAd, sequence } from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';

import { type DbConnection, notDeleted } from '../../shared/index.js';

/**
 * Editor node shape from sequence builder
 */
interface EditorNode {
  id: string;
  type: string;
  data: {
    metadata?: Record<string, unknown>;
  };
}

/**
 * Find an active sequence with a facebook_lead trigger for the given organization
 */
async function findFacebookLeadSequence(
  db: DbConnection,
  organizationId: string
): Promise<{ id: string; name: string } | null> {
  // Get all active sequences for this organization
  const activeSequences = await db.query.sequence.findMany({
    where: and(
      eq(sequence.organizationId, organizationId),
      eq(sequence.isActive, true),
      notDeleted(sequence)
    ),
  });

  // Find one that has a facebook_lead trigger
  for (const seq of activeSequences) {
    const nodes = (seq.nodes as EditorNode[] | null) ?? [];
    const hasFacebookTrigger = nodes.some(
      (n) =>
        n.type === 'trigger' &&
        n.data?.metadata?.triggerType === 'facebook_lead'
    );

    if (hasFacebookTrigger) {
      return { id: seq.id, name: seq.name };
    }
  }

  return null;
}

/**
 * Find the sequence for a lead, checking the ad's assigned sequence first.
 * Falls back to the global facebook_lead trigger sequence if no ad-specific one.
 */
export async function findSequenceForLead(
  db: DbConnection,
  organizationId: string,
  metaAdId?: string | null
): Promise<{ id: string; name: string; source: 'ad' | 'trigger' } | null> {
  // First, try to find a sequence from the ad
  if (metaAdId) {
    const ad = await db.query.metaAd.findFirst({
      where: eq(metaAd.metaAdId, metaAdId),
      with: {
        sequence: true,
      },
    });

    if (ad?.sequenceId && ad.sequence) {
      // Verify the sequence is active
      if (ad.sequence.isActive) {
        return {
          id: ad.sequence.id,
          name: ad.sequence.name,
          source: 'ad',
        };
      }
    }
  }

  // Fallback: Find a sequence with facebook_lead trigger
  const triggerSequence = await findFacebookLeadSequence(db, organizationId);
  if (triggerSequence) {
    return {
      ...triggerSequence,
      source: 'trigger',
    };
  }

  return null;
}
