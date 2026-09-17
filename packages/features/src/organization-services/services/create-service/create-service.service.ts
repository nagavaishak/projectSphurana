import {
  isForeignKeyViolation,
  isUniqueViolation,
  organizationService,
  withDbRetry,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { enqueueStockMatch } from '../../../stock-footage/index.js';
import {
  type CreateServiceInput,
  createServiceSchema,
} from './create-service.schema.js';

/**
 * Internal implementation of create service
 */
const createServiceImpl = async (
  db: DbConnection,
  input: CreateServiceInput
): Promise<Result<typeof organizationService.$inferSelect>> => {
  // Validate input
  const parsed = createServiceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Check if service with same name already exists for this organization.
  // Wrapped in withDbRetry: a pooled connection can be silently severed by
  // Fly's NAT while idle, so the first query may hit a dead socket and throw a
  // transient connection error (e.g. the postgres.js null-write). Retrying on a
  // fresh connection avoids surfacing that as an INTERNAL_ERROR/500.
  const existing = await withDbRetry(() =>
    db.query.organizationService.findFirst({
      where: (svc, { eq, and }) =>
        and(
          eq(svc.organizationId, parsed.data.organizationId),
          eq(svc.name, parsed.data.name)
        ),
    })
  );

  if (existing) {
    return err(
      new FeatureError(
        ErrorCodes.ALREADY_EXISTS,
        `Service "${parsed.data.name}" already exists in this organization`,
        { name: parsed.data.name }
      )
    );
  }

  // Resolve the price shape. When the caller omits priceType we INFER it so
  // pre-sweep callers that send only a number keep working: a bare priceCents →
  // `fixed`, none → `poa`. Then normalise: `free`/`poa` never carry a number
  // (£0 or unknown), so any priceCents alongside them is dropped; `fixed`/`from`
  // keep the anchor. This is the spec's "free/poa ignore priceCents" rule,
  // enforced at write time.
  const priceType =
    parsed.data.priceType ?? (parsed.data.priceCents != null ? 'fixed' : 'poa');
  const priceCents =
    priceType === 'free' || priceType === 'poa'
      ? null
      : (parsed.data.priceCents ?? null);

  // Uncategorised by default. The seed-default-services service still
  // calls resolveCategoryIdForEnum directly when it wants to backfill
  // legacy enum-based categories — the regular create flow doesn't.
  const categoryId = parsed.data.categoryId ?? null;

  // Same transient-connection guard as the existence check above. A severed
  // pooled connection usually throws before the INSERT reaches the server, so
  // retrying on a fresh connection is safe. Note withDbRetry never retries
  // constraint violations — only connection-class errors.
  //
  // The findFirst check above is NOT atomic with this INSERT: a concurrent
  // request can create the same (organizationId, name) in between and we lose
  // the race on `organization_service_name_unique`. A retried INSERT whose
  // first attempt actually landed before the socket died hits the same
  // constraint. Both cases mean exactly what the pre-check means — the service
  // already exists — so map them to ALREADY_EXISTS instead of letting a raw
  // PostgresError escape as an INTERNAL_ERROR/500.
  let result: typeof organizationService.$inferSelect | undefined;
  try {
    [result] = await withDbRetry(() =>
      db
        .insert(organizationService)
        .values({
          organizationId: parsed.data.organizationId,
          name: parsed.data.name,
          description: parsed.data.description,
          category: parsed.data.category,
          categoryId,
          sortOrder: parsed.data.sortOrder,
          isCustom: parsed.data.isCustom,
          isActive: parsed.data.isActive,
          requiresDeposit: parsed.data.requiresDeposit ?? false,
          depositAmountCents: parsed.data.depositAmountCents ?? null,
          // Null = inherit the org's payment policy. Only a deliberate choice
          // is stored, so an org-wide default still reaches this service.
          //
          // `requiresDeposit` is the pre-policy way of saying `deposit`, and it
          // is still the ONLY deposit field some callers send — onboarding
          // Step 7 and Claire's create-service tool both set the flag and no
          // policy. The booking resolver reads `payment_policy` alone, so the
          // translation has to happen here, or a brand-new clinic that ticked
          // "requires a deposit" during onboarding silently collects nothing
          // (its org default is the column default, `in_clinic`). An explicit
          // policy always wins; the flag only fills the gap it leaves.
          paymentPolicy:
            parsed.data.paymentPolicy ??
            (parsed.data.requiresDeposit ? 'deposit' : null),
          depositBasis: parsed.data.depositBasis ?? null,
          depositPercent: parsed.data.depositPercent ?? null,
          priceText: parsed.data.priceText ?? null,
          priceType,
          priceCents,
          appointmentDuration: parsed.data.appointmentDuration ?? null,
          painPoints: parsed.data.painPoints ?? null,
          expectedResults: parsed.data.expectedResults ?? null,
          processDescription: parsed.data.processDescription ?? null,
          targetArea: parsed.data.targetArea ?? null,
          // Null means this service inherits the connected Stripe account's
          // preset tax code. A non-null value is the specific Stripe tax code
          // selected by the clinic in the service editor.
          taxCode: parsed.data.taxCode ?? null,
        })
        .returning()
    );
  } catch (error) {
    // The organization on the caller's session is not in the database. Almost
    // always a session that outlived its org — a cached session still names it
    // after the row is gone. Reporting that as "an unexpected error occurred"
    // tells the caller nothing and hides a knowable, actionable condition.
    if (
      isForeignKeyViolation(
        error,
        'organization_service_organization_id_organization_id_fk'
      )
    ) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'That organization no longer exists. Sign out and back in, or switch organization.'
        )
      );
    }
    if (isUniqueViolation(error, 'organization_service_name_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Service "${parsed.data.name}" already exists in this organization`,
          { name: parsed.data.name }
        )
      );
    }
    throw error;
  }

  return ok(result);
};

/**
 * Create a new organization service
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Service creation input
 * @returns Result with created service or error
 */
export const createService = (db: DbConnection, input: CreateServiceInput) =>
  trackedResult(
    'organizationServices.createService',
    async () => {
      const result = await withOrgScope((tx) => createServiceImpl(tx, input), {
        db,
      });
      // Best-effort, AFTER the txn commits (never inside it — no external I/O on
      // a pooled conn). enqueueStockMatch returns a Result and never throws, so
      // a Redis blip can't fail service creation; the selector falls back to the
      // generic pool until the match lands.
      if (result.success) {
        await enqueueStockMatch({ organizationServiceId: result.data.id });
      }
      return result;
    },
    {
      properties: { organizationId: input.organizationId, name: input.name },
    }
  );

/**
 * Result type for createService
 */
export type CreateServiceResult = Awaited<ReturnType<typeof createService>>;
