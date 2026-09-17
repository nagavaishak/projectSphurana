import {
  CalendlyApiService,
  TimelyOAuthService,
  decryptCredentials,
} from '@borradh-workspace/integrations';
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
  type ExternalTeamMember,
  type ListExternalTeamMembersInput,
  listExternalTeamMembersSchema,
} from './list-external-team-members.schema.js';

const listExternalTeamMembersImpl = async (
  db: DbConnection,
  input: ListExternalTeamMembersInput
): Promise<Result<ExternalTeamMember[]>> => {
  const parsed = listExternalTeamMembersSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { bookingAccountId, organizationId } = parsed.data;

  // Load the booking account
  const account = await db.query.bookingAccount.findFirst({
    where: (t, { and, eq }) =>
      and(
        eq(t.id, bookingAccountId),
        eq(t.organizationId, organizationId),
        eq(t.isActive, true)
      ),
  });

  if (!account) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Booking account not found')
    );
  }

  try {
    const creds = decryptCredentials<{
      accessToken: string;
      refreshToken?: string;
    }>(account.encryptedCredentials);

    switch (account.provider) {
      case 'calendly': {
        const orgUri = account.config?.calendly?.organizationUri;
        if (!orgUri) {
          return ok([]); // No org URI stored, can't list members
        }
        const calendlyApi = new CalendlyApiService(creds.accessToken);
        const members = await calendlyApi.getOrganizationMembers(orgUri);
        return ok(
          members.map((m) => ({
            externalId: m.userUri,
            name: m.name,
            email: m.email,
            avatarUrl: m.avatarUrl,
            schedulingUrl: m.schedulingUrl,
          }))
        );
      }

      case 'timely': {
        const accountId = account.config?.timely?.accountId;
        if (!accountId) {
          return ok([]);
        }
        const timelyOAuth = new TimelyOAuthService();
        const users = await timelyOAuth.getUsers(
          creds.accessToken,
          Number(accountId)
        );
        return ok(
          users.map((u) => ({
            externalId: u.id.toString(),
            name: u.name,
            email: u.email || '',
            avatarUrl: u.avatarUrl,
          }))
        );
      }

      case 'phorest':
      case 'fresha':
        // Tier 2 providers don't support team member listing via OAuth
        return ok([]);

      default:
        return ok([]);
    }
  } catch (error) {
    logError('integrations.listExternalTeamMembers', error, {
      feature: 'integrations',
      extra: { bookingAccountId, provider: account.provider },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to fetch team members from booking provider'
      )
    );
  }
};

export const listExternalTeamMembers = (
  db: DbConnection,
  input: ListExternalTeamMembersInput
) =>
  trackedResult(
    'integrations.listExternalTeamMembers',
    () => listExternalTeamMembersImpl(db, input),
    {
      properties: {
        bookingAccountId: input.bookingAccountId,
        organizationId: input.organizationId,
      },
    }
  );

export type ListExternalTeamMembersResult = Awaited<
  ReturnType<typeof listExternalTeamMembers>
>;
