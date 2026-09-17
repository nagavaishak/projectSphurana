import {
  lead,
  sequence,
  sequenceExecution,
  sequenceStep,
  voiceCall,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
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
  type GetLeadExecutionHistoryInput,
  getLeadExecutionHistorySchema,
} from './get-lead-execution-history.schema.js';

export interface ExecutionHistoryStep {
  id: string;
  stepId: string;
  nodeId: string | null;
  status: string;
  result: Record<string, unknown> | null;
  scheduledAt: string | null;
  executedAt: string | null;
  errorMessage: string | null;
}

export interface CallbackInfo {
  callbackRequested: boolean;
  callbackTime: string | null;
  voiceCallId: string | null;
}

export interface LeadExecutionHistory {
  lead: {
    id: string;
    firstName: string;
    lastName: string | null;
    currentStepId: string | null;
    sequenceStatus: string | null;
    nextActionAt: string | null;
  };
  sequence: {
    id: string;
    name: string;
    nodes: unknown[];
    edges: unknown[];
  };
  executions: ExecutionHistoryStep[];
  callbackInfo: CallbackInfo | null;
}

const getLeadExecutionHistoryImpl = async (
  db: DbConnection,
  input: GetLeadExecutionHistoryInput
): Promise<Result<LeadExecutionHistory>> => {
  const parsed = getLeadExecutionHistorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { leadId, sequenceId, organizationId } = parsed.data;

  // Get the sequence and verify it belongs to the organization
  const seq = await db.query.sequence.findFirst({
    where: and(
      eq(sequence.id, sequenceId),
      eq(sequence.organizationId, organizationId),
      notDeleted(sequence)
    ),
  });

  if (!seq) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Sequence not found'));
  }

  // Get the lead
  const leadRecord = await db.query.lead.findFirst({
    where: and(
      eq(lead.id, leadId),
      eq(lead.organizationId, organizationId),
      notDeleted(lead)
    ),
    columns: {
      id: true,
      firstName: true,
      lastName: true,
      currentStepId: true,
      sequenceStatus: true,
      nextActionAt: true,
    },
  });

  if (!leadRecord) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Lead not found'));
  }

  // Get all executions for this lead in this sequence, with step details
  const executions = await db
    .select({
      execution: sequenceExecution,
      step: {
        nodeId: sequenceStep.nodeId,
      },
    })
    .from(sequenceExecution)
    .innerJoin(sequenceStep, eq(sequenceExecution.stepId, sequenceStep.id))
    .where(
      and(
        eq(sequenceExecution.leadId, leadId),
        eq(sequenceExecution.sequenceId, sequenceId)
      )
    )
    .orderBy(desc(sequenceExecution.createdAt));

  const executionHistory: ExecutionHistoryStep[] = executions.map((row) => ({
    id: row.execution.id,
    stepId: row.execution.stepId,
    nodeId: row.step.nodeId,
    status: row.execution.status,
    result: (row.execution.result as Record<string, unknown>) ?? null,
    scheduledAt: row.execution.scheduledAt?.toISOString() ?? null,
    executedAt: row.execution.executedAt?.toISOString() ?? null,
    errorMessage: row.execution.errorMessage,
  }));

  // Check for callback info from the most recent voice call for this lead
  let callbackInfo: CallbackInfo | null = null;

  const latestVoiceCall = await db.query.voiceCall.findFirst({
    where: eq(voiceCall.leadId, leadId),
    orderBy: [desc(voiceCall.createdAt)],
    columns: {
      id: true,
      callbackRequested: true,
      callbackTime: true,
    },
  });

  if (latestVoiceCall?.callbackRequested) {
    callbackInfo = {
      callbackRequested: true,
      callbackTime: latestVoiceCall.callbackTime,
      voiceCallId: latestVoiceCall.id,
    };
  }

  return ok({
    lead: {
      id: leadRecord.id,
      firstName: leadRecord.firstName,
      lastName: leadRecord.lastName,
      currentStepId: leadRecord.currentStepId,
      sequenceStatus: leadRecord.sequenceStatus,
      nextActionAt: leadRecord.nextActionAt?.toISOString() ?? null,
    },
    sequence: {
      id: seq.id,
      name: seq.name,
      nodes: (seq.nodes as unknown[]) ?? [],
      edges: (seq.edges as unknown[]) ?? [],
    },
    executions: executionHistory,
    callbackInfo,
  });
};

export const getLeadExecutionHistory = (
  db: DbConnection,
  input: GetLeadExecutionHistoryInput
) =>
  trackedResult(
    'sequences.getLeadExecutionHistory',
    () => getLeadExecutionHistoryImpl(db, input),
    {
      properties: {
        leadId: input.leadId,
        sequenceId: input.sequenceId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetLeadExecutionHistoryResult = Awaited<
  ReturnType<typeof getLeadExecutionHistory>
>;
