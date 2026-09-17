import { suppression, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  buildSegmentWhere,
  buildSuppressionIndex,
  eligibleChannels,
} from '../_shared/index.js';
import {
  type PreviewSegmentInput,
  previewSegmentSchema,
} from './preview-segment.schema.js';

/**
 * Count how many leads a segment matches, and how many are actually reachable
 * per channel (consent + contact + suppression). Powers the wizard's audience
 * step and the pre-send cost estimate.
 */
const previewSegmentImpl = async (
  db: DbConnection,
  input: PreviewSegmentInput
) => {
  const parsed = previewSegmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, filterJson, channels } = parsed.data;

  const leads = await db.query.lead.findMany({
    where: and(...buildSegmentWhere(organizationId, filterJson)),
    columns: {
      id: true,
      email: true,
      phone: true,
      whatsapp: true,
      consentEmail: true,
      consentSms: true,
    },
  });

  const suppressionRows = await db.query.suppression.findMany({
    where: eq(suppression.organizationId, organizationId),
    columns: { channel: true, contact: true },
  });
  const index = buildSuppressionIndex(suppressionRows);

  const counts: Record<'email' | 'sms' | 'whatsapp', number> = {
    email: 0,
    sms: 0,
    whatsapp: 0,
  };
  let reachable = 0;

  for (const l of leads) {
    const eligible = eligibleChannels(l, channels, index);
    if (eligible.length > 0) reachable++;
    for (const c of eligible) counts[c]++;
  }

  return ok({ total: leads.length, reachable, channels: counts });
};

export const previewSegment = (db: DbConnection, input: PreviewSegmentInput) =>
  trackedResult(
    'campaigns.previewSegment',
    () => withOrgScope((tx) => previewSegmentImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type PreviewSegmentResult = Awaited<ReturnType<typeof previewSegment>>;
