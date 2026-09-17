import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
} from '../../../shared/index.js';
import { createLead } from '../create-lead/create-lead.service.js';
import { normalizeLead } from '../normalize-lead/normalize-lead.service.js';
import {
  type CreateNormalizedLeadInput,
  createNormalizedLeadSchema,
} from './create-normalized-lead.schema.js';

/**
 * Create a lead from MANUAL entry.
 *
 * Manual entry is messy, so names/emails/phones (E.164) are cleaned via the
 * model first. Best-effort: on model failure the raw input goes through
 * unchanged — normalisation must never block the create.
 *
 * Machine-sourced creates (form submissions, imports, Meta lead-gen) call
 * `createLead` directly and are deliberately NOT normalised.
 */
const createNormalizedLeadImpl = async (
  db: DbConnection,
  input: CreateNormalizedLeadInput
) => {
  const parsed = createNormalizedLeadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, firstName, lastName, email, phone, whatsapp } =
    parsed.data;

  const normalized = await normalizeLead({
    organizationId,
    firstName,
    lastName,
    email,
    phone,
    whatsapp,
  });

  return createLead(db, {
    ...parsed.data,
    ...(normalized.success ? normalized.data : {}),
  });
};

export const createNormalizedLead = (
  db: DbConnection,
  input: CreateNormalizedLeadInput
) =>
  trackedResult(
    'leads.createNormalizedLead',
    () => createNormalizedLeadImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type CreateNormalizedLeadResult = Awaited<
  ReturnType<typeof createNormalizedLead>
>;
