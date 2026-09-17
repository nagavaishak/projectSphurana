import { leadSourceLabels } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
// The sibling domain's PUBLIC barrel — not a deep path into its internals.
// (`@borradh-workspace/features/notifications` can't be used from inside this
// same package: that subpath resolves to `dist/`, which doesn't exist yet at
// build time.)
import { dispatchNotification } from '../../../notifications/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type NotifyLeadCreatedInput,
  notifyLeadCreatedSchema,
} from './notify-lead-created.schema.js';

const notifyLeadCreatedImpl = async (
  db: DbConnection,
  input: NotifyLeadCreatedInput
): Promise<Result<{ recipientCount: number }>> => {
  const parsed = notifyLeadCreatedSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const {
    organizationId,
    leadId,
    firstName,
    lastName,
    source,
    serviceName,
    assignedToId,
    conversationId,
  } = parsed.data;

  const name = [firstName, lastName].filter(Boolean).join(' ');
  const body = serviceName
    ? `${name} came in from ${leadSourceLabels[source]} — enquired about ${serviceName}.`
    : `${name} came in from ${leadSourceLabels[source]}.`;

  const result = await dispatchNotification(db, {
    organizationId,
    type: 'lead_created',
    assigneeUserId: assignedToId ?? undefined,
    title: 'New lead',
    body,
    linkPath: `/dashboard/clients/${leadId}`,
    data: {
      leadId,
      source,
      ...(conversationId ? { conversationId } : {}),
    },
  });

  if (!result.success) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to dispatch lead notification'
      )
    );
  }
  return ok({ recipientCount: result.data.recipientCount });
};

/**
 * Notifies the org that a lead arrived. Shared by every lead-creation path so
 * the copy, deep link and preference gating stay in one place.
 *
 * Deliberately NOT called from bulk import: a 500-row CSV must not fire 500
 * notifications, and the importer already knows the leads landed.
 *
 * Call fire-and-forget — returns a Result and never throws.
 */
export const notifyLeadCreated = (
  db: DbConnection,
  input: NotifyLeadCreatedInput
) =>
  trackedResult(
    'leads.notifyLeadCreated',
    () => notifyLeadCreatedImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        leadId: input.leadId,
        source: input.source,
      },
    }
  );

export type NotifyLeadCreatedResult = Awaited<
  ReturnType<typeof notifyLeadCreated>
>;

/**
 * Fire-and-forget wrapper for trigger sites: swallows and logs any failure so
 * notification problems can never fail lead creation itself.
 */
export const notifyLeadCreatedSafe = (
  db: DbConnection,
  input: NotifyLeadCreatedInput
): void => {
  notifyLeadCreated(db, input).catch((error) =>
    logError('leads.notifyLeadCreated', error, {
      feature: 'leads',
      extra: { organizationId: input.organizationId, leadId: input.leadId },
    })
  );
};
