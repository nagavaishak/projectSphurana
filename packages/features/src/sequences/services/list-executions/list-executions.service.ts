import {
  type SequenceExecutionStatus,
  lead,
  sequence,
  sequenceExecution,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, desc, eq } from 'drizzle-orm';
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
  type ListExecutionsInput,
  listExecutionsSchema,
} from './list-executions.schema.js';

export interface ExecutionWithDetails {
  id: string;
  sequenceId: string;
  sequenceName: string;
  leadId: string;
  leadName: string;
  leadEmail: string | null;
  status: SequenceExecutionStatus;
  startedAt: string | null;
  completedAt: string | null;
  runTimeMs: number | null;
  errorMessage: string | null;
}

export interface ListExecutionsResult {
  executions: ExecutionWithDetails[];
  total: number;
}

const listExecutionsImpl = async (
  db: DbConnection,
  input: ListExecutionsInput
): Promise<Result<ListExecutionsResult>> => {
  const parsed = listExecutionsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Build conditions - filter by sequences that belong to the organization
  const conditions: SQL[] = [];

  if (parsed.data.sequenceId) {
    conditions.push(eq(sequenceExecution.sequenceId, parsed.data.sequenceId));
  }

  if (parsed.data.status) {
    conditions.push(eq(sequenceExecution.status, parsed.data.status));
  }

  // Get executions with related sequence and lead data
  const results = await db
    .select({
      execution: sequenceExecution,
      sequence: {
        id: sequence.id,
        name: sequence.name,
        organizationId: sequence.organizationId,
      },
      lead: {
        id: lead.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
      },
    })
    .from(sequenceExecution)
    .innerJoin(
      sequence,
      and(eq(sequenceExecution.sequenceId, sequence.id), notDeleted(sequence))
    )
    .innerJoin(
      lead,
      and(eq(sequenceExecution.leadId, lead.id), notDeleted(lead))
    )
    .where(
      and(
        eq(sequence.organizationId, parsed.data.organizationId),
        ...conditions
      )
    )
    .orderBy(desc(sequenceExecution.createdAt))
    .limit(parsed.data.limit)
    .offset(parsed.data.offset);

  // Transform to the expected format
  const executions: ExecutionWithDetails[] = results.map((row) => {
    const scheduledAt = row.execution.scheduledAt
      ? row.execution.scheduledAt.toISOString()
      : null;
    const executedAt = row.execution.executedAt
      ? row.execution.executedAt.toISOString()
      : null;

    // Calculate run time if both timestamps exist
    let runTimeMs: number | null = null;
    if (row.execution.scheduledAt && row.execution.executedAt) {
      runTimeMs =
        row.execution.executedAt.getTime() -
        row.execution.scheduledAt.getTime();
    }

    const leadName = row.lead.lastName
      ? `${row.lead.firstName} ${row.lead.lastName}`
      : row.lead.firstName;

    return {
      id: row.execution.id,
      sequenceId: row.sequence.id,
      sequenceName: row.sequence.name,
      leadId: row.lead.id,
      leadName,
      leadEmail: row.lead.email,
      status: row.execution.status,
      startedAt: scheduledAt,
      completedAt: executedAt,
      runTimeMs,
      errorMessage: row.execution.errorMessage,
    };
  });

  return ok({
    executions,
    total: executions.length, // For proper pagination, a count query would be needed
  });
};

export const listExecutions = (db: DbConnection, input: ListExecutionsInput) =>
  trackedResult(
    'sequences.listExecutions',
    () => listExecutionsImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
