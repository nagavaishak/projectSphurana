import { organizationService, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
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
  type UpdateServiceInput,
  updateServiceSchema,
} from './update-service.schema.js';

/**
 * Whether an update touches a field the stock matcher reads — if so, the cached
 * matches should be recomputed. A price/sortOrder/deposit edit doesn't change
 * the match, so we skip the LLM call for those.
 */
function affectsStockMatch(input: UpdateServiceInput): boolean {
  return (
    input.name !== undefined ||
    input.description !== undefined ||
    input.category !== undefined ||
    input.painPoints !== undefined ||
    input.expectedResults !== undefined ||
    input.processDescription !== undefined ||
    input.targetArea !== undefined
  );
}

/**
 * Internal implementation of update service
 */
const updateServiceImpl = async (
  db: DbConnection,
  input: UpdateServiceInput
): Promise<Result<typeof organizationService.$inferSelect>> => {
  // Validate input
  const parsed = updateServiceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...updates } = parsed.data;

  // Check if service exists
  const existing = await db.query.organizationService.findFirst({
    where: (svc, { eq: e, and: a }) =>
      a(e(svc.id, id), e(svc.organizationId, organizationId)),
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found', { id })
    );
  }

  // If name is being updated, check for duplicates
  if (updates.name && updates.name !== existing.name) {
    // Type assertion safe: guarded by `if (updates.name && ...)`
    const newName = updates.name as string;
    const duplicate = await db.query.organizationService.findFirst({
      where: (svc, { eq: e, and: a, ne }) =>
        a(
          e(svc.organizationId, organizationId),
          e(svc.name, newName),
          ne(svc.id, id)
        ),
    });

    if (duplicate) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Service "${updates.name}" already exists in this organization`,
          { name: updates.name }
        )
      );
    }
  }

  // Build update object (only include defined values)
  const updateData: Partial<typeof organizationService.$inferInsert> = {};
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined)
    updateData.description = updates.description;
  if (updates.category !== undefined) updateData.category = updates.category;
  if (updates.categoryId !== undefined)
    updateData.categoryId = updates.categoryId;
  if (updates.sortOrder !== undefined) updateData.sortOrder = updates.sortOrder;
  if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
  if (updates.paymentPolicy !== undefined)
    updateData.paymentPolicy = updates.paymentPolicy;
  // A caller that moves the pre-policy flag without sending a policy — Claire,
  // any direct API client — means the policy question, since `payment_policy`
  // is the only field the booking resolver reads. On → `deposit`; off → null,
  // i.e. back to whatever the org default says, which is what the flag meant
  // before the policy column existed. An explicit policy in the same patch
  // wins.
  else if (updates.requiresDeposit !== undefined)
    updateData.paymentPolicy = updates.requiresDeposit ? 'deposit' : null;
  if (updates.depositBasis !== undefined)
    updateData.depositBasis = updates.depositBasis;
  if (updates.depositPercent !== undefined)
    updateData.depositPercent = updates.depositPercent;
  if (updates.requiresDeposit !== undefined)
    updateData.requiresDeposit = updates.requiresDeposit;
  if (updates.depositAmountCents !== undefined)
    updateData.depositAmountCents = updates.depositAmountCents;
  if (updates.priceText !== undefined) updateData.priceText = updates.priceText;
  if (updates.priceType !== undefined) updateData.priceType = updates.priceType;
  // Price-shape normalisation: `free`/`poa` never carry an anchor, so switching
  // to either clears priceCents even when the caller didn't send one. Otherwise
  // priceCents is set only when explicitly provided.
  if (updates.priceType === 'free' || updates.priceType === 'poa') {
    updateData.priceCents = null;
  } else if (updates.priceCents !== undefined) {
    updateData.priceCents = updates.priceCents;
  }
  if (updates.appointmentDuration !== undefined)
    updateData.appointmentDuration = updates.appointmentDuration;
  // Normalise 0 → null: "no turnaround" has one representation in the DB, so
  // readers never have to treat 0 and null as the same thing.
  if (updates.turnaroundMinutes !== undefined)
    updateData.turnaroundMinutes = updates.turnaroundMinutes || null;
  if (updates.painPoints !== undefined)
    updateData.painPoints = updates.painPoints;
  if (updates.expectedResults !== undefined)
    updateData.expectedResults = updates.expectedResults;
  if (updates.processDescription !== undefined)
    updateData.processDescription = updates.processDescription;
  if (updates.targetArea !== undefined)
    updateData.targetArea = updates.targetArea;
  // Preserve an explicit null: it is how a clinic switches a service back to
  // the Stripe account default tax code.
  if (updates.taxCode !== undefined) updateData.taxCode = updates.taxCode;

  // Update service
  const [result] = await db
    .update(organizationService)
    .set(updateData)
    .where(
      and(
        eq(organizationService.id, id),
        eq(organizationService.organizationId, organizationId)
      )
    )
    .returning();

  return ok(result);
};

/**
 * Update an organization service
 *
 * @param db - Database connection
 * @param input - Update service input
 * @returns Result with updated service or error
 */
export const updateService = (db: DbConnection, input: UpdateServiceInput) =>
  trackedResult(
    'organizationServices.updateService',
    async () => {
      const result = await withOrgScope((tx) => updateServiceImpl(tx, input), {
        db,
      });
      // Best-effort re-match AFTER the txn commits, only when a match-relevant
      // field changed. Never throws (Result), so it can't fail the update.
      //
      // `reclassify` because every field `affectsStockMatch` tests is an INPUT
      // to the classifier. A service renamed from "Body Contouring" to
      // "Cryolipolysis" must be re-asked; reusing the cached answer would keep
      // it on the old spec forever.
      if (result.success && affectsStockMatch(input)) {
        await enqueueStockMatch({
          organizationServiceId: result.data.id,
          reclassify: true,
        });
      }
      return result;
    },
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

/**
 * Result type for updateService
 */
export type UpdateServiceResult = Awaited<ReturnType<typeof updateService>>;
