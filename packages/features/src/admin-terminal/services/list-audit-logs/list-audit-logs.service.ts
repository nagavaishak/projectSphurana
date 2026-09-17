import { auditLog } from '@borradh-workspace/database';
import type { AuditLog } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, count, desc, eq } from 'drizzle-orm';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import { ErrorCodes, FeatureError, err } from '../../../shared/index.js';
import {
  type ListAuditLogsInput,
  listAuditLogsSchema,
} from './list-audit-logs.schema.js';

const listAuditLogsImpl = async (
  db: DbConnection,
  input: ListAuditLogsInput
): Promise<
  Result<{
    items: AuditLog[];
    total: number;
    limit: number;
    offset: number;
  }>
> => {
  const parsed = listAuditLogsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, entityType, action, limit, offset } = parsed.data;

  const conditions = [];
  if (organizationId) {
    conditions.push(eq(auditLog.organizationId, organizationId));
  }
  if (entityType) {
    conditions.push(eq(auditLog.entityType, entityType));
  }
  if (action) {
    conditions.push(eq(auditLog.action, action));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ total: count() })
    .from(auditLog)
    .where(whereClause);

  const items = await db
    .select()
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  return ok({
    items,
    total: countResult?.total ?? 0,
    limit,
    offset,
  });
};

export const listAuditLogs = (db: DbConnection, input: ListAuditLogsInput) =>
  trackedResult(
    'adminTerminal.listAuditLogs',
    () => listAuditLogsImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        entityType: input.entityType,
        action: input.action,
      },
    }
  );

export type ListAuditLogsResult = Awaited<ReturnType<typeof listAuditLogs>>;
