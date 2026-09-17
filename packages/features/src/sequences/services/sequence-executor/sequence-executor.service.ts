import {
  lead,
  sequenceExecution,
  type sequenceStep,
} from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type BusinessHours,
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { calculateNextActionTime } from './calculate-next-action-time.js';
import { checkConsentForStep } from './check-consent.js';
import { evaluateCondition } from './evaluate-condition.js';
import { executeEmailStep } from './execute-email-step.js';
import { executeSmsStep } from './execute-sms-step.js';
import { executeVoiceStep } from './execute-voice-step.js';
import { executeWebhookStep } from './execute-webhook-step.js';
import { executeWhatsAppStep } from './execute-whatsapp-step.js';
import type {
  ConditionNodeConfig,
  ExecutionResultData,
  LeadData,
  SequenceStep,
  StepExecutor,
} from './types.js';

const logger = createLogger('SequenceExecutor');

/**
 * Step executor registry — maps step types to their executor functions
 */
const executors: Record<string, StepExecutor> = {
  email: executeEmailStep,
  sms: executeSmsStep,
  whatsapp: executeWhatsAppStep,
  voice_call: executeVoiceStep,
  webhook: executeWebhookStep,
};

/**
 * Execute a single sequence step
 */
async function executeStep(
  db: DbConnection,
  leadData: LeadData,
  step: SequenceStep,
  organizationId: string
): Promise<Result<ExecutionResultData>> {
  // Check consent before executing contact steps
  const consentBlock = checkConsentForStep(step.type, leadData);
  if (consentBlock) {
    logger.info('Skipping step due to missing consent', {
      leadId: leadData.id,
      stepType: step.type,
      stepId: step.id,
    });
    return ok({ type: step.type, sent: false, skippedReason: 'no_consent' });
  }

  try {
    // Handle wait step inline (trivial)
    if (step.type === 'wait') {
      return ok({ type: 'wait', duration: step.config.duration as string });
    }

    // Handle condition step inline (uses evaluateCondition)
    if (step.type === 'condition') {
      return executeConditionStep(leadData, step);
    }

    // Dispatch to registered executor
    const executor = executors[step.type];
    if (!executor) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_INPUT,
          `Unknown step type: ${step.type}`
        )
      );
    }

    return await executor(db, leadData, step, organizationId);
  } catch (error) {
    logError('sequences.executeStep', error, {
      extra: { leadId: leadData.id, stepId: step.id, stepType: step.type },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to execute step: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    );
  }
}

/**
 * Execute a condition step — evaluates lead data against configured rules
 */
function executeConditionStep(
  leadData: LeadData,
  step: SequenceStep
): Result<ExecutionResultData> {
  const conditionConfig = step.config as unknown as ConditionNodeConfig;

  // Validate condition configuration
  if (!conditionConfig.field) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_INPUT,
        'Condition step is missing field configuration'
      )
    );
  }

  // Evaluate the condition
  const conditionResult = evaluateCondition(conditionConfig, leadData);

  logger.debug('Condition evaluated', {
    leadId: leadData.id,
    field: conditionConfig.field,
    operator: conditionConfig.operator,
    value: conditionConfig.value,
    result: conditionResult,
  });

  // Return the result with the appropriate branch node ID
  const nextBranchNodeId = conditionResult
    ? conditionConfig.trueBranchNodeId
    : conditionConfig.falseBranchNodeId;

  return ok({
    type: 'condition',
    result: conditionResult,
    nextBranchNodeId,
  });
}

/**
 * Process pending sequence executions for leads
 */
const processPendingExecutionsImpl = async (
  db: DbConnection
): Promise<Result<{ processed: number; failed: number }>> => {
  try {
    // Find all leads with pending sequence actions
    const now = new Date();

    const pendingLeads = await db.query.lead.findMany({
      where: (lead, { and, eq, lte, isNotNull, isNull }) =>
        and(
          eq(lead.sequenceStatus, 'active'),
          isNotNull(lead.nextActionAt),
          lte(lead.nextActionAt, now),
          // Skip leads flagged for human takeover
          eq(lead.humanTakeoverRequested, false),
          isNull(lead.deletedAt)
        ),
      limit: 100, // Process in batches
    });

    if (pendingLeads.length > 0) {
      logger.info(`Processing ${pendingLeads.length} pending leads`);
    }

    let processed = 0;
    let failed = 0;

    for (const pendingLead of pendingLeads) {
      try {
        // Get the current step or first step
        let currentStep: typeof sequenceStep.$inferSelect | undefined;

        const currentStepId = pendingLead.currentStepId;
        const sequenceId = pendingLead.sequenceId;

        if (!sequenceId) {
          // Lead has no sequence assigned, skip
          continue;
        }

        // Fetch organization for business hours
        const org = await db.query.organization.findFirst({
          where: (o, { and, eq, isNull }) =>
            and(eq(o.id, pendingLead.organizationId), isNull(o.deletedAt)),
        });

        const businessHours = (org?.businessHours ??
          null) as BusinessHours | null;

        // Fetch the last voice call for this lead (for condition evaluation)
        const lastVoiceCall = await db.query.voiceCall.findFirst({
          where: (vc, { eq }) => eq(vc.leadId, pendingLead.id),
          orderBy: (vc, { desc }) => [desc(vc.createdAt)],
        });

        // Enrich lead data with last call info
        const enrichedLeadData: LeadData = {
          ...pendingLead,
          lastCall: lastVoiceCall
            ? {
                id: lastVoiceCall.id,
                status: lastVoiceCall.status,
                sentiment: lastVoiceCall.sentiment,
                callbackRequested: lastVoiceCall.callbackRequested,
                appointmentBooked: lastVoiceCall.appointmentBooked,
                duration: lastVoiceCall.durationMs,
                summary: lastVoiceCall.aiSummary,
                createdAt: lastVoiceCall.createdAt,
              }
            : null,
        };

        if (currentStepId) {
          currentStep = await db.query.sequenceStep.findFirst({
            where: (step, { eq }) => eq(step.id, currentStepId),
          });
        } else {
          // Get first step of the sequence
          const steps = await db.query.sequenceStep.findMany({
            where: (step, { eq }) => eq(step.sequenceId, sequenceId),
            orderBy: (step, { asc }) => [asc(step.order)],
            limit: 1,
          });
          currentStep = steps[0];
        }

        if (!currentStep) {
          // No more steps, mark sequence as completed
          await db
            .update(lead)
            .set({
              sequenceStatus: 'completed',
              nextActionAt: null,
            })
            .where(and(eq(lead.id, pendingLead.id), notDeleted(lead)));

          processed++;
          continue;
        }

        // Execute the step based on its type
        // Cast config to Record<string, unknown> as JSONB returns unknown
        const stepForExecution: SequenceStep = {
          ...currentStep,
          config: currentStep.config as Record<string, unknown>,
        };
        const executionResult = await executeStep(
          db,
          enrichedLeadData,
          stepForExecution,
          pendingLead.organizationId
        );

        // Record execution
        await db.insert(sequenceExecution).values({
          leadId: pendingLead.id,
          sequenceId: sequenceId,
          stepId: currentStep.id,
          status: executionResult.success ? 'completed' : 'failed',
          result: executionResult.success ? executionResult.data : null,
          scheduledAt: pendingLead.nextActionAt,
          executedAt: new Date(),
          errorMessage: executionResult.success
            ? null
            : executionResult.error?.message,
        });

        if (executionResult.success) {
          let nextStep: typeof sequenceStep.$inferSelect | undefined;

          // For condition steps, use the branch node ID to determine next step
          if (
            currentStep.type === 'condition' &&
            executionResult.data?.nextBranchNodeId
          ) {
            // Find the step with the matching nodeId
            nextStep = await db.query.sequenceStep.findFirst({
              where: (step, { eq, and }) =>
                and(
                  eq(step.sequenceId, sequenceId),
                  eq(
                    step.nodeId,
                    executionResult.data.nextBranchNodeId as string
                  )
                ),
            });

            logger.debug('Condition branching', {
              leadId: pendingLead.id,
              conditionResult: executionResult.data?.result,
              nextBranchNodeId: executionResult.data?.nextBranchNodeId,
              nextStepFound: !!nextStep,
            });
          } else {
            // For non-condition steps, get the next step by order
            const nextSteps = await db.query.sequenceStep.findMany({
              where: (step, { eq, gt, and }) =>
                and(
                  eq(step.sequenceId, sequenceId),
                  gt(step.order, currentStep.order)
                ),
              orderBy: (step, { asc }) => [asc(step.order)],
              limit: 1,
            });
            nextStep = nextSteps[0];
          }

          if (nextStep) {
            // Schedule next step - cast configs as JSONB returns unknown
            const nextStepForCalc: SequenceStep = {
              ...nextStep,
              config: nextStep.config as Record<string, unknown>,
            };
            const nextActionAt = calculateNextActionTime(
              stepForExecution,
              nextStepForCalc,
              businessHours
            );

            await db
              .update(lead)
              .set({
                currentStepId: nextStep.id,
                nextActionAt,
              })
              .where(and(eq(lead.id, pendingLead.id), notDeleted(lead)));
          } else {
            // No more steps (or branch leads to end), mark as completed
            await db
              .update(lead)
              .set({
                sequenceStatus: 'completed',
                currentStepId: null,
                nextActionAt: null,
              })
              .where(and(eq(lead.id, pendingLead.id), notDeleted(lead)));
          }

          processed++;
        } else {
          // Check if failure was due to insufficient credits
          const isInsufficientCredits =
            executionResult.error?.code === ErrorCodes.FORBIDDEN;

          if (isInsufficientCredits) {
            // Pause the sequence - it can resume when credits are added
            logger.info('Pausing sequence due to insufficient credits', {
              leadId: pendingLead.id,
              organizationId: pendingLead.organizationId,
            });
            await db
              .update(lead)
              .set({
                sequenceStatus: 'paused',
                // Keep currentStepId so we can resume from this step
                nextActionAt: null,
              })
              .where(and(eq(lead.id, pendingLead.id), notDeleted(lead)));
          } else {
            // Mark sequence as failed for other errors
            await db
              .update(lead)
              .set({
                sequenceStatus: 'failed',
                nextActionAt: null,
              })
              .where(and(eq(lead.id, pendingLead.id), notDeleted(lead)));
          }

          failed++;
        }
      } catch (error) {
        logError('sequences.processPendingExecutions', error, {
          extra: { leadId: pendingLead.id },
        });
        failed++;
      }
    }

    return ok({ processed, failed });
  } catch (error) {
    logError('sequences.processPendingExecutions', error);
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to process pending sequence executions'
      )
    );
  }
};

/**
 * Process pending sequence executions
 *
 * This should be called by a cron job or scheduled task
 *
 * @param db - Database connection
 * @returns Result with processed and failed counts
 *
 * @example
 * ```ts
 * const result = await processPendingExecutions(db);
 * if (result.success) {
 *   console.log(`Processed ${result.data.processed}, Failed ${result.data.failed}`);
 * }
 * ```
 */
export const processPendingExecutions = (db: DbConnection) =>
  trackedResult(
    'sequences.processPendingExecutions',
    () => processPendingExecutionsImpl(db),
    { trackSuccess: false, trackFailure: false }
  );

export type ProcessPendingExecutionsResult = Awaited<
  ReturnType<typeof processPendingExecutions>
>;
