import { randomUUID } from 'node:crypto';
import {
  type PhoneNumber,
  phoneNumber,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type AddPhoneNumberInput,
  addPhoneNumberSchema,
} from './add-phone-number.schema.js';

const addPhoneNumberImpl = async (
  db: DbConnection,
  input: AddPhoneNumberInput
): Promise<Result<PhoneNumber>> => {
  const parsed = addPhoneNumberSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, number, label, countryCode } = parsed.data;

  try {
    const id = randomUUID();
    const [result] = await db
      .insert(phoneNumber)
      .values({
        id,
        organizationId,
        number,
        label: label ?? null,
        provider: 'manual',
        providerNumberId: null,
        status: 'active',
        supportsOutbound: true,
        countryCode: countryCode ?? null,
      })
      .returning();

    return ok(result);
  } catch (error) {
    // No branch matching a unique-constraint violation here: the `phone_number`
    // table has no unique constraint (not on `number`, not on the org+number
    // pair — see packages/database/src/schema/phone-number.ts), so a duplicate
    // insert simply succeeds, and the old message-substring check on the
    // error could never fire. If a uniqueness rule is ever added to the table,
    // wrap that insert in `isUniqueViolation(error, '<constraint name>')`
    // rather than a message match (ENG-844).
    logError('phoneNumbers.addPhoneNumber', error, {
      feature: 'phone-numbers',
      extra: { organizationId, number },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to add phone number')
    );
  }
};

export const addPhoneNumber = (db: DbConnection, input: AddPhoneNumberInput) =>
  trackedResult(
    'phoneNumbers.addPhoneNumber',
    () => withOrgScope((tx) => addPhoneNumberImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        number: input.number,
      },
    }
  );

export type AddPhoneNumberResult = Awaited<ReturnType<typeof addPhoneNumber>>;
