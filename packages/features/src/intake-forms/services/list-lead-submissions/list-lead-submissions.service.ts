import { formSubmission } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import {
  type IntakeSubmissionRow,
  toIntakeSubmissionRow,
} from '../../shared/wire-shape.js';
import {
  type ListLeadSubmissionsInput,
  listLeadSubmissionsSchema,
} from './list-lead-submissions.schema.js';

const listLeadSubmissionsImpl = async (
  db: DbConnection,
  input: ListLeadSubmissionsInput
) => {
  const { organizationId, leadId } = listLeadSubmissionsSchema.parse(input);
  const rows = await db.query.formSubmission.findMany({
    where: and(
      eq(formSubmission.organizationId, organizationId),
      eq(formSubmission.leadId, leadId),
      // A client profile's intake tab must never surface a clinical note.
      eq(formSubmission.kind, 'intake')
    ),
    orderBy: [desc(formSubmission.createdAt)],
  });
  return ok({ items: rows.map(toIntakeSubmissionRow) }) as Result<{
    items: IntakeSubmissionRow[];
  }>;
};

export const listLeadSubmissions = (
  db: DbConnection,
  input: ListLeadSubmissionsInput
) =>
  trackedResult(
    'intakeForms.listLeadSubmissions',
    () => listLeadSubmissionsImpl(db, input),
    {
      properties: { leadId: input.leadId },
    }
  );
export type ListLeadSubmissionsResult = Awaited<
  ReturnType<typeof listLeadSubmissions>
>;
