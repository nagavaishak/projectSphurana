import { form } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { INTAKE_TEMPLATES } from '../../shared/templates.js';
import {
  type SeedIntakeTemplatesInput,
  seedIntakeTemplatesSchema,
} from './seed-intake-templates.schema.js';

/**
 * Create editable forms from the pre-built templates. Idempotent by NAME: a
 * template whose name already exists in the org is skipped, so re-running (or a
 * clinic that seeded some by hand) never produces duplicates the unique
 * constraint would reject anyway.
 */
const seedIntakeTemplatesImpl = async (
  db: DbConnection,
  input: SeedIntakeTemplatesInput
): Promise<Result<{ created: string[]; skipped: string[] }>> => {
  const parsed = seedIntakeTemplatesSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }
  const { organizationId, keys, createdById } = parsed.data;

  const chosen = keys
    ? INTAKE_TEMPLATES.filter((t) => keys.includes(t.key))
    : INTAKE_TEMPLATES;

  const existing = await db.query.form.findMany({
    where: and(
      eq(form.organizationId, organizationId),
      eq(form.kind, 'intake'),
      notDeleted(form),
      inArray(
        form.name,
        chosen.map((t) => t.name)
      )
    ),
    columns: { name: true },
  });
  const taken = new Set(existing.map((r) => r.name));

  const created: string[] = [];
  const skipped: string[] = [];
  try {
    for (const template of chosen) {
      if (taken.has(template.name)) {
        skipped.push(template.name);
        continue;
      }
      await db.insert(form).values({
        organizationId,
        kind: 'intake',
        name: template.name,
        description: template.description,
        fields: template.fields,
        createdById,
      });
      created.push(template.name);
    }
    return ok({ created, skipped });
  } catch (error) {
    logError('intakeForms.seedIntakeTemplates', error, {
      feature: 'intake-forms',
      extra: { organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to seed templates')
    );
  }
};

export const seedIntakeTemplates = (
  db: DbConnection,
  input: SeedIntakeTemplatesInput
) =>
  trackedResult(
    'intakeForms.seedIntakeTemplates',
    () => seedIntakeTemplatesImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
export type SeedIntakeTemplatesResult = Awaited<
  ReturnType<typeof seedIntakeTemplates>
>;
