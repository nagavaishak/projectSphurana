import {
  type BookingAccount,
  bookingAccount,
} from '@borradh-workspace/database';
import { PhorestApiService } from '@borradh-workspace/integrations';
import { encryptCredentials } from '@borradh-workspace/integrations';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ConnectPhorestInput,
  connectPhorestSchema,
} from './connect-phorest.schema.js';

/**
 * Internal implementation of connect Phorest
 */
const connectPhorestImpl = async (
  db: DbConnection,
  input: ConnectPhorestInput
): Promise<Result<BookingAccount>> => {
  const parsed = connectPhorestSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, username, password, businessId, region } =
    parsed.data;

  try {
    // Test the connection
    const phorestApi = new PhorestApiService({
      username,
      password,
      businessId,
      region,
    });

    const isConnected = await phorestApi.testConnection();
    if (!isConnected) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'Invalid Phorest credentials. Please check your username, password, and business ID.'
        )
      );
    }

    // Get branches to verify access and get business name
    const branches = await phorestApi.getBranches();
    const primaryBranch = branches[0];

    // Check if already connected
    const existing = await db.query.bookingAccount.findFirst({
      where: (t, { and, eq }) =>
        and(
          eq(t.organizationId, organizationId),
          eq(t.provider, 'phorest'),
          eq(t.externalAccountId, businessId)
        ),
    });

    if (existing) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Phorest business ${businessId} is already connected`
        )
      );
    }

    // Encrypt credentials (Phorest uses basic auth, not OAuth tokens)
    const encryptedCreds = encryptCredentials({
      username,
      password,
      businessId,
      region,
    });

    // Store in database
    const [result] = await db
      .insert(bookingAccount)
      .values({
        organizationId,
        userId,
        provider: 'phorest',
        externalAccountId: businessId,
        email: username.replace('global/', ''), // Extract email from username
        displayName: primaryBranch?.name || `Phorest ${businessId}`,
        config: {
          phorest: {
            businessId,
            branchId: primaryBranch?.branchId,
            region,
          },
        },
        encryptedCredentials: encryptedCreds,
        isActive: true,
      })
      .returning();

    return ok(result);
  } catch (error) {
    logError('integrations.connectPhorest', error, {
      feature: 'integrations',
      extra: { organizationId, userId, businessId },
    });

    if (error instanceof Error && error.message.includes('401')) {
      return err(
        new FeatureError(
          ErrorCodes.UNAUTHORIZED,
          'Invalid Phorest credentials. Please check your username and password.'
        )
      );
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while connecting Phorest'
      )
    );
  }
};

/**
 * Connect a Phorest account to an organization
 */
export const connectPhorest = (db: DbConnection, input: ConnectPhorestInput) =>
  trackedResult(
    'integrations.connectPhorest',
    () => connectPhorestImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ConnectPhorestResult = Awaited<ReturnType<typeof connectPhorest>>;
