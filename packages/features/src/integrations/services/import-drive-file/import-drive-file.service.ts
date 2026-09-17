import {
  type Asset,
  driveAccount,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  GoogleDriveApiService,
  GoogleDriveOAuthService,
  type GoogleStoredCredentials,
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { getOrgAssetsBucket, upload } from '@borradh-workspace/storage';
import { eq } from 'drizzle-orm';
import { createAsset } from '../../../assets/services/create-asset/create-asset.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ImportDriveFileInput,
  importDriveFileSchema,
} from './import-drive-file.schema.js';

/**
 * Convert a ReadableStream to a Buffer
 */
async function streamToBuffer(
  stream: ReadableStream<Uint8Array>
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  return Buffer.concat(chunks);
}

/**
 * Internal implementation of import drive file
 */
const importDriveFileImpl = async (
  db: DbConnection,
  input: ImportDriveFileInput
): Promise<
  { success: true; data: Asset } | { success: false; error: FeatureError }
> => {
  const parsed = importDriveFileSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, accountId, fileId, name, tags } = parsed.data;

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

    // Download the file
    const downloadResult = await driveApi.downloadFile(fileId);

    // Convert stream to buffer
    const fileBuffer = await streamToBuffer(downloadResult.stream);

    // Generate S3 key
    const timestamp = Date.now();
    const sanitizedFileName = downloadResult.fileName.replace(
      /[^a-zA-Z0-9.-]/g,
      '_'
    );
    const s3Key = `org-${organizationId}/assets/drive-imports/${timestamp}-${sanitizedFileName}`;

    // Upload to S3
    const bucket = getOrgAssetsBucket();
    await upload({
      bucket,
      key: s3Key,
      body: fileBuffer,
      contentType: downloadResult.mimeType,
      metadata: {
        source: 'google-drive',
        'source-file-id': fileId,
        'original-filename': downloadResult.fileName,
      },
    });

    // Generate the blob URL (CloudFront or S3 URL)
    const blobUrl = `https://${bucket}.s3.amazonaws.com/${s3Key}`;

    // Create the asset
    const assetResult = await createAsset(db, {
      name: name || downloadResult.fileName.replace(/\.[^/.]+$/, ''),
      blobUrl,
      sourceFileName: downloadResult.fileName,
      tags,
      type: 'video',
      organizationId,
      uploadedById: userId,
    });

    if (!assetResult.success) {
      return err(
        new FeatureError(
          assetResult.error.code,
          assetResult.error.message,
          assetResult.error.details
        )
      );
    }

    return ok(assetResult.data);
  } catch (error) {
    logError('integrations.importDriveFile', error, {
      feature: 'integrations',
      extra: { organizationId, accountId, fileId },
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
      if (error.message.includes('File too large')) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, error.message)
        );
      }
      if (error.message.includes('Invalid file type')) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, error.message)
        );
      }
      if (error.message.includes('File not found')) {
        return err(
          new FeatureError(
            ErrorCodes.NOT_FOUND,
            'File not found in Google Drive'
          )
        );
      }
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An unexpected error occurred while importing the file'
      )
    );
  }
};

/**
 * Import a file from Google Drive to the asset library
 */
export const importDriveFile = (
  db: DbConnection,
  input: ImportDriveFileInput
) =>
  trackedResult(
    'integrations.importDriveFile',
    () => withOrgScope((tx) => importDriveFileImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        accountId: input.accountId,
        fileId: input.fileId,
      },
    }
  );

export type ImportDriveFileResult = Awaited<ReturnType<typeof importDriveFile>>;
