import {
  appointment,
  appointmentDeposit,
  conversation,
  conversationMessage,
  lead,
  leadActivity,
  leadSourceLabels,
  sequence,
  sequenceExecution,
  sequenceStep,
  user,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ListLeadHistoryInput,
  listLeadHistorySchema,
} from './list-lead-history.schema.js';

/**
 * Serialized execution for API response (dates as ISO strings)
 */
interface SerializedExecution {
  id: string;
  leadId: string;
  sequenceId: string;
  sequenceName?: string;
  stepId: string;
  stepType?:
    | 'email'
    | 'sms'
    | 'whatsapp'
    | 'voice_call'
    | 'wait'
    | 'condition'
    | 'webhook';
  stepConfig?: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled';
  result?: Record<string, unknown>;
  scheduledAt?: string;
  executedAt?: string;
  errorMessage?: string | null;
  createdAt: string;
}

/**
 * Serialized activity for API response (dates as ISO strings)
 */
interface SerializedActivity {
  id: string;
  leadId: string;
  type: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  performedById?: string | null;
  performedByName?: string | null;
  createdAt: string;
}

interface LeadHistoryItem {
  id: string;
  type: 'execution' | 'activity';
  timestamp: string;
  execution?: SerializedExecution;
  activity?: SerializedActivity;
}

export interface LeadHistoryResponse {
  items: LeadHistoryItem[];
  total: number;
}

/** Trim long message bodies for the timeline sublabel. */
const truncate = (text: string, max = 140): string =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;

/**
 * Internal implementation of list lead history
 */
const listLeadHistoryImpl = async (
  db: DbConnection,
  input: ListLeadHistoryInput
): Promise<Result<LeadHistoryResponse>> => {
  // Validate input
  const parsed = listLeadHistorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { leadId, organizationId, limit, offset } = parsed.data;

  // Verify lead exists and belongs to organization
  const leadRecord = await db.query.lead.findFirst({
    where: and(
      eq(lead.id, leadId),
      eq(lead.organizationId, organizationId),
      notDeleted(lead)
    ),
  });

  if (!leadRecord) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Lead not found'));
  }

  // Fetch executions with sequence and step info
  const executions = await db
    .select({
      id: sequenceExecution.id,
      leadId: sequenceExecution.leadId,
      sequenceId: sequenceExecution.sequenceId,
      sequenceName: sequence.name,
      stepId: sequenceExecution.stepId,
      stepType: sequenceStep.type,
      stepConfig: sequenceStep.config,
      status: sequenceExecution.status,
      result: sequenceExecution.result,
      scheduledAt: sequenceExecution.scheduledAt,
      executedAt: sequenceExecution.executedAt,
      errorMessage: sequenceExecution.errorMessage,
      createdAt: sequenceExecution.createdAt,
    })
    .from(sequenceExecution)
    .leftJoin(sequence, eq(sequenceExecution.sequenceId, sequence.id))
    .leftJoin(sequenceStep, eq(sequenceExecution.stepId, sequenceStep.id))
    .where(eq(sequenceExecution.leadId, leadId))
    .orderBy(desc(sequenceExecution.createdAt));

  // Fetch activities with performer info
  const activities = await db
    .select({
      id: leadActivity.id,
      leadId: leadActivity.leadId,
      type: leadActivity.type,
      description: leadActivity.description,
      metadata: leadActivity.metadata,
      performedById: leadActivity.performedById,
      performedByName: user.name,
      createdAt: leadActivity.createdAt,
    })
    .from(leadActivity)
    .leftJoin(user, eq(leadActivity.performedById, user.id))
    .where(eq(leadActivity.leadId, leadId))
    .orderBy(desc(leadActivity.createdAt));

  // Combine and transform to history items
  const historyItems: LeadHistoryItem[] = [];

  // Add executions
  for (const exec of executions) {
    historyItems.push({
      id: exec.id,
      type: 'execution',
      timestamp: exec.createdAt.toISOString(),
      execution: {
        id: exec.id,
        leadId: exec.leadId,
        sequenceId: exec.sequenceId,
        sequenceName: exec.sequenceName ?? undefined,
        stepId: exec.stepId,
        stepType: exec.stepType ?? undefined,
        stepConfig: (exec.stepConfig as Record<string, unknown>) ?? undefined,
        status: exec.status,
        result: (exec.result as Record<string, unknown>) ?? undefined,
        scheduledAt: exec.scheduledAt?.toISOString(),
        executedAt: exec.executedAt?.toISOString(),
        errorMessage: exec.errorMessage,
        createdAt: exec.createdAt.toISOString(),
      },
    });
  }

  // Add activities
  for (const activity of activities) {
    historyItems.push({
      id: activity.id,
      type: 'activity',
      timestamp: activity.createdAt.toISOString(),
      activity: {
        id: activity.id,
        leadId: activity.leadId,
        type: activity.type,
        description: activity.description,
        metadata: (activity.metadata as Record<string, unknown>) ?? undefined,
        performedById: activity.performedById,
        performedByName: activity.performedByName,
        createdAt: activity.createdAt.toISOString(),
      },
    });
  }

  // -----------------------------------------------------------------------
  // Synthesized milestones. The lead_activity / sequence_execution tables are
  // only populated for automation-driven leads, so most leads would show an
  // empty timeline. Derive the key milestones (came in, first messages,
  // appointments) from data that already exists. Best-effort: a failure here
  // must not break the core history.
  // -----------------------------------------------------------------------

  // "Came in" — always derivable from the lead row. Skip if an explicit
  // lead_created activity already exists (avoid a duplicate entry).
  if (!activities.some((a) => a.type === 'lead_created')) {
    historyItems.push({
      id: `synthetic-lead-created-${leadRecord.id}`,
      type: 'activity',
      timestamp: leadRecord.createdAt.toISOString(),
      activity: {
        id: `synthetic-lead-created-${leadRecord.id}`,
        leadId,
        type: 'lead_created',
        description: `Came in via ${leadSourceLabels[leadRecord.source] ?? leadRecord.source}`,
        createdAt: leadRecord.createdAt.toISOString(),
      },
    });
  }

  try {
    // Appointments booked for this lead.
    const appointmentRows = await db
      .select({
        id: appointment.id,
        title: appointment.title,
        startDate: appointment.startDate,
        createdAt: appointment.createdAt,
      })
      .from(appointment)
      .where(
        and(
          eq(appointment.leadId, leadId),
          eq(appointment.organizationId, organizationId),
          notDeleted(appointment)
        )
      );

    for (const appt of Array.isArray(appointmentRows) ? appointmentRows : []) {
      historyItems.push({
        id: `synthetic-appt-${appt.id}`,
        type: 'activity',
        timestamp: appt.createdAt.toISOString(),
        activity: {
          id: `synthetic-appt-${appt.id}`,
          leadId,
          type: 'appointment_booked',
          description: appt.title,
          metadata: { appointmentDate: appt.startDate.toISOString() },
          createdAt: appt.createdAt.toISOString(),
        },
      });
    }
  } catch (error) {
    logError('leads.listLeadHistory.appointments', error, {
      feature: 'leads',
      extra: { leadId },
    });
  }

  try {
    // Deposits paid for this lead's appointments. `appointment_deposit` has no
    // `leadId`, so join through `appointment`. Only paid deposits are surfaced —
    // a pending/expired deposit isn't a history-worthy event.
    const depositRows = await db
      .select({
        id: appointmentDeposit.id,
        amountCents: appointmentDeposit.amountCents,
        currency: appointmentDeposit.currency,
        paidAt: appointmentDeposit.paidAt,
        createdAt: appointmentDeposit.createdAt,
      })
      .from(appointmentDeposit)
      .innerJoin(
        appointment,
        eq(appointmentDeposit.appointmentId, appointment.id)
      )
      .where(
        and(
          eq(appointment.leadId, leadId),
          eq(appointmentDeposit.organizationId, organizationId),
          eq(appointmentDeposit.status, 'paid')
        )
      );

    for (const dep of Array.isArray(depositRows) ? depositRows : []) {
      const ts = (dep.paidAt ?? dep.createdAt).toISOString();
      historyItems.push({
        id: `synthetic-deposit-${dep.id}`,
        type: 'activity',
        timestamp: ts,
        activity: {
          id: `synthetic-deposit-${dep.id}`,
          leadId,
          type: 'deposit_paid',
          description: 'Deposit paid',
          metadata: { amountCents: dep.amountCents, currency: dep.currency },
          createdAt: ts,
        },
      });
    }
  } catch (error) {
    logError('leads.listLeadHistory.deposits', error, {
      feature: 'leads',
      extra: { leadId },
    });
  }

  try {
    // Messages — link conversations to the lead by PSID (Messenger/IG) or by an
    // explicit metadata.leadId set when an inbound message was matched to a lead.
    const convMatchers = [
      sql`(${conversation.metadata} ->> 'leadId') = ${leadId}`,
      ...(leadRecord.psid
        ? [eq(conversation.externalUserId, leadRecord.psid)]
        : []),
    ];
    const conversationRows = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(
        and(
          eq(conversation.organizationId, organizationId),
          or(...convMatchers)
        )
      );

    const conversationIds = (
      Array.isArray(conversationRows) ? conversationRows : []
    ).map((c) => c.id);
    if (conversationIds.length > 0) {
      const messageRows = await db
        .select({
          id: conversationMessage.id,
          role: conversationMessage.role,
          content: conversationMessage.content,
          createdAt: conversationMessage.createdAt,
        })
        .from(conversationMessage)
        .where(inArray(conversationMessage.conversationId, conversationIds))
        .orderBy(asc(conversationMessage.createdAt));
      const messages = Array.isArray(messageRows) ? messageRows : [];

      const firstInbound = messages.find((m) => m.role === 'user');
      const firstOutbound = messages.find(
        (m) => m.role === 'bot' || m.role === 'agent'
      );

      if (firstInbound) {
        historyItems.push({
          id: `synthetic-msg-in-${firstInbound.id}`,
          type: 'activity',
          timestamp: firstInbound.createdAt.toISOString(),
          activity: {
            id: `synthetic-msg-in-${firstInbound.id}`,
            leadId,
            type: 'message_received',
            description: truncate(firstInbound.content),
            createdAt: firstInbound.createdAt.toISOString(),
          },
        });
      }

      if (firstOutbound) {
        historyItems.push({
          id: `synthetic-msg-out-${firstOutbound.id}`,
          type: 'activity',
          timestamp: firstOutbound.createdAt.toISOString(),
          activity: {
            id: `synthetic-msg-out-${firstOutbound.id}`,
            leadId,
            type: 'message_sent',
            description: truncate(firstOutbound.content),
            createdAt: firstOutbound.createdAt.toISOString(),
          },
        });
      }
    }
  } catch (error) {
    logError('leads.listLeadHistory.messages', error, {
      feature: 'leads',
      extra: { leadId },
    });
  }

  // Sort by timestamp descending
  historyItems.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Get total count before pagination
  const total = historyItems.length;

  // Apply pagination
  const paginatedItems = historyItems.slice(offset, offset + limit);

  return ok({
    items: paginatedItems,
    total,
  });
};

/**
 * List lead history - combined timeline of sequence executions and activities
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - List lead history input with leadId and organizationId
 * @returns Result with history items or error
 *
 * @example
 * ```ts
 * const result = await listLeadHistory(db, {
 *   leadId: 'lead_123',
 *   organizationId: 'org_123',
 *   limit: 20,
 *   offset: 0,
 * });
 * ```
 */
export const listLeadHistory = (
  db: DbConnection,
  input: ListLeadHistoryInput
) =>
  trackedResult(
    'leads.listLeadHistory',
    () => withOrgScope((tx) => listLeadHistoryImpl(tx, input), { db }),
    {
      properties: {
        leadId: input.leadId,
        organizationId: input.organizationId,
      },
    }
  );

/**
 * Result type for listLeadHistory
 */
export type ListLeadHistoryResult = Awaited<ReturnType<typeof listLeadHistory>>;
