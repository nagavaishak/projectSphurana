import { form } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  type Result,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type IntakeFormRow,
  toIntakeFormRow,
} from '../../shared/wire-shape.js';
import {
  type ListIntakeFormsInput,
  listIntakeFormsSchema,
} from './list-intake-forms.schema.js';

const listIntakeFormsImpl = async (
  db: DbConnection,
  input: ListIntakeFormsInput
) => {
  const { organizationId, includeInactive } =
    listIntakeFormsSchema.parse(input);
  const rows = await db.query.form.findMany({
    where: and(
      eq(form.organizationId, organizationId),
      eq(form.kind, 'intake'),
      notDeleted(form),
      includeInactive ? undefined : eq(form.isActive, true)
    ),
    orderBy: [asc(form.name)],
  });
  return ok({ items: rows.map(toIntakeFormRow) }) as Result<{
    items: IntakeFormRow[];
  }>;
};

export const listIntakeForms = (
  db: DbConnection,
  input: ListIntakeFormsInput
) =>
  trackedResult(
    'intakeForms.listIntakeForms',
    () => listIntakeFormsImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
export type ListIntakeFormsResult = Awaited<ReturnType<typeof listIntakeForms>>;
