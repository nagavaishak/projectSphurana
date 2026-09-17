import { driveAccount, withOrgScope } from '@borradh-workspace/database';
import {
  GoogleDriveApiService,
  GoogleDriveOAuthService,
  type GoogleStoredCredentials,
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListDriveFilesInput,
  listDriveFilesSchema,
} from './list-drive-files.schema.js';

/**
 * Drive file item
 */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  modifiedTime?: string;
  isFolder: boolean;
}

/**
 * Breadcrumb item for folder path
 */
export interface DriveBreadcrumb {
  id: string;
  name: string;
}

/**
 * Response type for list drive files
 */
export interface ListDriveFilesResponse {
  files: DriveFile[];
  nextPageToken?: string;
  breadcrumbs: DriveBreadcrumb[];
}

/**
 * Internal implementation of list drive files
 */
const listDriveFilesImpl = async (
  db: DbConnection,
  input: ListDriveFilesInput
): Promise<
  | { success: true; data: ListDriveFilesResponse }
  | { success: false; error: FeatureError }
> => {
  const parsed = listDriveFilesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    accountId,
    folderId,
    pageSize,
    pageToken,
    query,
    videoOnly,
  } = parsed.data;

  try {
    // Get the account
    const account = await db.query.driveAccount.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.id, accountId), eqOp(t.organizationId, organizationId)),
    });

    if (!account) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Drive account not found')
      );
    }

    if (!account.isActive) {
      return err(
        new FeatureError(ErrorCodes.FORBIDDEN, 'Drive account is inactive')
      );
    }

    // Decrypt credentials
    let credentials = decryptCredentials<GoogleStoredCredentials>(
      account.encryptedCredentials
    );

    // Check if token needs refresh
    const now = new Date();
    const tokenExpiry = account.tokenExpiresAt;
    const needsRefresh = tokenExpiry && tokenExpiry < now;

    if (needsRefresh && credentials.refreshToken) {
      const driveOAuth = new GoogleDriveOAuthService();
      const newTokens = await driveOAuth.refreshAccessToken(
        credentials.refreshToken
      );

      // Update credentials with new access token
      credentials = {
        ...credentials,
        accessToken: newTokens.accessToken,
        expiresIn: newTokens.expiresIn,
      };

      // Update in database
      const newEncryptedCreds = encryptCredentials(credentials);
      const newTokenExpiresAt = new Date(
        Date.now() + newTokens.expiresIn * 1000
      );

      await db
        .update(driveAccount)
        .set({
          encryptedCredentials: newEncryptedCreds,
          tokenExpiresAt: newTokenExpiresAt,
        })
        .where(eq(driveAccount.id, accountId));
    }

    // Create Drive API service
    const driveApi = new GoogleDriveApiService(credentials.accessToken);

    // List files
    const filesResponse = await driveApi.listFiles({
      folderId,
      pageSize,
      pageToken,
      query,
      videoOnly,
    });

    // Get breadcrumbs for current folder
    const breadcrumbs: DriveBreadcrumb[] =
      folderId !== 'root'
        ? await driveApi.getFolderPath(folderId)
        : [{ id: 'root', name: 'My Drive' }];

    // Update lastSyncAt
    await db
      .update(driveAccount)
      .set({ lastSyncAt: new Date() })
      .where(eq(driveAccount.id, accountId));

    // Map files to add isFolder property
    const mappedFiles: DriveFile[] = filesResponse.files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      thumbnailLink: file.thumbnailLink,
      modifiedTime: file.modifiedTime,
      isFolder: file.mimeType === 'application/vnd.google-apps.folder',
    }));

    return ok({
      files: mappedFiles,
      nextPageToken: filesResponse.nextPageToken,
      breadcrumbs,
    });
  } catch (error) {
    logError('integrations.listDriveFiles', error, {
      feature: 'integrations',
      extra: { organizationId, accountId, folderId },
    });

    if (error instanceof Error) {
      if (error.message.includes('Failed to refresh token')) {
        return err(
          new FeatureError(
            ErrorCodes.UNAUTHORIZED,
            'Drive access has expired. Please reconnect your account.'
          )
        );
      }
      if (error.message.includes('Failed to list files')) {
        return err(
          new FeatureError(
            ErrorCodes.EXTERNAL_SERVICE_ERROR,
            'Failed to list files from Google Drive'
          )
        );
      }
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while listing Drive files'
      )
    );
  }
};

/**
 * List files from a connected Google Drive account
 */
export const listDriveFiles = (db: DbConnection, input: ListDriveFilesInput) =>
  trackedResult(
    'integrations.listDriveFiles',
    () => withOrgScope((tx) => listDriveFilesImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        accountId: input.accountId,
      },
    }
  );

export type ListDriveFilesResult = Awaited<ReturnType<typeof listDriveFiles>>;
