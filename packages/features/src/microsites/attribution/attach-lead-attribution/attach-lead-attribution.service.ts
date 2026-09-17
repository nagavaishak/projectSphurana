/**
 * Land a microsite visit's attribution ON THE LEAD (plan §9, §11).
 *
 * WHAT GETS STORED, and why it is not the host: `micrositeId` plus the five
 * UTMs. A tenant moving from `salon.borradh.io` to `salon.com` must keep ONE
 * attribution history — storing the host would split their CAC in two on the
 * exact day they start spending on their own brand, and the split would look
 * like a performance cliff rather than a data bug. The host is derivable at
 * read time from `microsite_domain`; the site identity is not derivable from
 * the host once the host has changed.
 *
 * FIRST TOUCH WINS. A lead that already carries a campaign keeps it: the ad we
 * paid for is the one that acquired them, and a later organic visit must not
 * launder that spend away. Fields the lead does not yet have are filled in, so
 * a second visit can still add, say, a `utm_content` the first one lacked.
 *
 * The PostHog event is fired here rather than only from the browser pixel
 * deliberately (§11): the pixel is Meta's view of the world and dies with an
 * ad-blocker or an iOS install. We should never be unable to answer "what did
 * this campaign cost us" without asking Meta.
 */

import { lead as leadTable } from '@borradh-workspace/database';
import {
  logError,
  trackOrgEvent,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { type MicrositeUtm, hasUtm, parseUtmParams } from '../utm.js';
import {
  type AttachLeadAttributionInput,
  attachLeadAttributionSchema,
} from './attach-lead-attribution.schema.js';

export interface AttachLeadAttributionOutput {
  leadId: string;
  micrositeId: string | null;
  utm: MicrositeUtm;
  /** False when the lead already carried attribution and we left it alone. */
  changed: boolean;
}

/** Explicit input wins over anything parsed out of the landing URL. */
const resolveUtm = (input: AttachLeadAttributionInput): MicrositeUtm => {
  const fromUrl = input.landingUrl ? parseUtmParams(input.landingUrl) : {};
  return {
    source: input.utmSource ?? fromUrl.source ?? null,
    medium: input.utmMedium ?? fromUrl.medium ?? null,
    campaign: input.utmCampaign ?? fromUrl.campaign ?? null,
    content: input.utmContent ?? fromUrl.content ?? null,
    term: input.utmTerm ?? fromUrl.term ?? null,
  };
};

const attachLeadAttributionImpl = async (
  db: DbConnection,
  input: AttachLeadAttributionInput
): Promise<Result<AttachLeadAttributionOutput>> => {
  const parsed = attachLeadAttributionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadId, micrositeId } = parsed.data;
  const incoming = resolveUtm(parsed.data);

  try {
    const existing = await db.query.lead.findFirst({
      columns: {
        id: true,
        micrositeId: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        utmContent: true,
        utmTerm: true,
      },
      where: and(
        eq(leadTable.id, leadId),
        eq(leadTable.organizationId, organizationId)
      ),
    });

    if (!existing) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Lead not found'));
    }

    // First touch wins: only fill what is missing.
    const updates: Record<string, string> = {};
    const keep = <T extends string>(
      current: T | null | undefined,
      next: string | null | undefined,
      column: string
    ): string | null => {
      if (current) return current;
      if (next) {
        updates[column] = next;
        return next;
      }
      return null;
    };

    const finalMicrositeId = keep(
      existing.micrositeId,
      micrositeId,
      'micrositeId'
    );
    const utm: MicrositeUtm = {
      source: keep(existing.utmSource, incoming.source, 'utmSource'),
      medium: keep(existing.utmMedium, incoming.medium, 'utmMedium'),
      campaign: keep(existing.utmCampaign, incoming.campaign, 'utmCampaign'),
      content: keep(existing.utmContent, incoming.content, 'utmContent'),
      term: keep(existing.utmTerm, incoming.term, 'utmTerm'),
    };

    const changed = Object.keys(updates).length > 0;
    if (changed) {
      await db.update(leadTable).set(updates).where(eq(leadTable.id, leadId));
    }

    // Fire-and-forget: our own record of the acquisition, independent of Meta's
    // pixel. A telemetry failure must never fail the lead write.
    if (changed && hasUtm(utm)) {
      trackOrgEvent(organizationId, 'microsite_lead_attributed', {
        leadId,
        micrositeId: finalMicrositeId,
        utmSource: utm.source,
        utmMedium: utm.medium,
        utmCampaign: utm.campaign,
        utmContent: utm.content,
      });
    }

    return ok({ leadId, micrositeId: finalMicrositeId, utm, changed });
  } catch (error) {
    logError('microsites.attachLeadAttribution', error, {
      feature: 'microsites',
      extra: { organizationId, leadId, micrositeId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to attach lead attribution'
      )
    );
  }
};

export const attachLeadAttribution = (
  db: DbConnection,
  input: AttachLeadAttributionInput
) =>
  trackedResult(
    'microsites.attachLeadAttribution',
    () => attachLeadAttributionImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        utmCampaign: input.utmCampaign,
      },
      internalErrorsOnly: true,
    }
  );

export type AttachLeadAttributionResult = Awaited<
  ReturnType<typeof attachLeadAttribution>
>;
