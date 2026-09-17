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
import { normalizeContact } from '../_shared/channel-eligibility.js';
import {
  type IsSuppressedInput,
  isSuppressedSchema,
} from './is-suppressed.schema.js';

const isSuppressedImpl = async (db: DbConnection, input: IsSuppressedInput) => {
  const parsed = isSuppressedSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, channel } = parsed.data;
  const contact = normalizeContact(channel, parsed.data.contact);

  const row = await db.query.suppression.findFirst({
    where: and(
      eq(suppression.organizationId, organizationId),
      eq(suppression.channel, channel),
      eq(suppression.contact, contact)
    ),
  });

  return ok({ suppressed: Boolean(row), reason: row?.reason ?? null });
};

export const isSuppressed = (db: DbConnection, input: IsSuppressedInput) =>
  trackedResult(
    'campaigns.isSuppressed',
    () => withOrgScope((tx) => isSuppressedImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        channel: input.channel,
      },
      internalErrorsOnly: true,
    }
  );

export type IsSuppressedResult = Awaited<ReturnType<typeof isSuppressed>>;
