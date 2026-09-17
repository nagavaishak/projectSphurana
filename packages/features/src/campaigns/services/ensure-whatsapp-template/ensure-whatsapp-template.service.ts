import { whatsappAccount, whatsappTemplate } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
// Cross-context call into integrations goes through its PUBLIC barrel (the
// domain's top-level index), not its internals — and via a relative path so it
// resolves from source in tests without a prior build.
import { createWhatsappTemplate } from '../../../integrations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { CANONICAL_WHATSAPP_TEMPLATE } from '../../_shared/campaign-content.js';
import {
  type EnsureCampaignWhatsappTemplateInput,
  ensureCampaignWhatsappTemplateSchema,
} from './ensure-whatsapp-template.schema.js';

/**
 * The outcome of ensuring the canonical WhatsApp template exists for an org:
 *  - `missing_account` — no active WABA, so nothing to register against.
 *  - `created`         — we just registered it on Meta (now pending approval —
 *                        first-run "up to 24h" notice territory).
 *  - approved/pending/rejected/paused/disabled — it already existed; the value
 *                        is the template's current Meta-mirrored status.
 */
export type EnsureCampaignWhatsappTemplateStatus =
  | 'approved'
  | 'pending'
  | 'rejected'
  | 'paused'
  | 'disabled'
  | 'created'
  | 'missing_account';

/**
 * Auto-provision the canonical `borradh_campaign_message` template for the org's
 * active WhatsApp Business account so bulk WhatsApp works for EVERY org — not
 * just ones that found Settings.
 *
 * Idempotent: if the template row already exists (any status) it is a no-op that
 * just reports the current status. If there is no active WABA, it reports
 * `missing_account` (email/other channels are unaffected). Otherwise it
 * registers the template via the existing `createWhatsappTemplate` flow (which
 * seeds the cache as `pending`) and reports `created`.
 */
const ensureCampaignWhatsappTemplateImpl = async (
  db: DbConnection,
  input: EnsureCampaignWhatsappTemplateInput
): Promise<Result<{ status: EnsureCampaignWhatsappTemplateStatus }>> => {
  const parsed = ensureCampaignWhatsappTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // 1. An active WABA is required to register a template against.
  const account = await db.query.whatsappAccount.findFirst({
    where: and(
      eq(whatsappAccount.organizationId, organizationId),
      eq(whatsappAccount.isActive, true)
    ),
    columns: { id: true },
  });
  if (!account) {
    return ok({ status: 'missing_account' });
  }

  // 2. Already registered? No-op — report the current status.
  const existing = await db.query.whatsappTemplate.findFirst({
    where: and(
      eq(whatsappTemplate.organizationId, organizationId),
      eq(whatsappTemplate.name, CANONICAL_WHATSAPP_TEMPLATE.name)
    ),
    columns: { status: true },
  });
  if (existing) {
    return ok({ status: existing.status });
  }

  // 3. Register the canonical template (seeds the cache as `pending`).
  const created = await createWhatsappTemplate(db, {
    organizationId,
    accountId: account.id,
    name: CANONICAL_WHATSAPP_TEMPLATE.name,
    category: CANONICAL_WHATSAPP_TEMPLATE.category,
    language: CANONICAL_WHATSAPP_TEMPLATE.languageCode,
    body: CANONICAL_WHATSAPP_TEMPLATE.body,
  });
  if (!created.success) {
    return err(new FeatureError(created.error.code, created.error.message));
  }

  return ok({ status: 'created' });
};

export const ensureCampaignWhatsappTemplate = (
  db: DbConnection,
  input: EnsureCampaignWhatsappTemplateInput
) =>
  trackedResult(
    'campaigns.ensureCampaignWhatsappTemplate',
    () => ensureCampaignWhatsappTemplateImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type EnsureCampaignWhatsappTemplateResult = Awaited<
  ReturnType<typeof ensureCampaignWhatsappTemplate>
>;
