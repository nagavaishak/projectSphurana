import { fetchWithRetry } from '@borradh-workspace/http';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

/**
 * Allowed video MIME types for import
 */
export const ALLOWED_VIDEO_TYPES: string[] = [
  'video/mp4',
  'video/quicktime', // .mov
  'video/x-msvideo', // .avi
  'video/webm',
  'video/x-matroska', // .mkv
  'video/mpeg',
  'video/3gpp',
  'video/3gpp2',
];

/**
 * Maximum file size for import (5GB)
 */
export const MAX_FILE_SIZE_BYTES: number = 5 * 1024 * 1024 * 1024;

/**
 * Google Drive file metadata
 */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  trashed?: boolean;
}

/**
 * List files options
 */
export interface ListFilesOptions {
  folderId?: string;
  pageSize?: number;
  pageToken?: string;
  query?: string;
  videoOnly?: boolean;
  orderBy?: string;
}

/**
 * List files response
 */
export interface ListFilesResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

/**
 * Folder breadcrumb item
 */
export interface FolderBreadcrumb {
  id: string;
  name: string;
}

/**
 * Service for interacting with Google Drive API
 */
export class GoogleDriveApiService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Update the access token (e.g., after refresh)
   */
  setAccessToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

  /**
   * List files in Drive
   * @param options List options
   * @returns Files and optional next page token
   */
  async listFiles(options: ListFilesOptions = {}): Promise<ListFilesResponse> {
    const {
      folderId = 'root',
      pageSize = 50,
      pageToken,
      query,
      videoOnly = false,
      orderBy = 'folder,modifiedTime desc',
    } = options;

    // Build query parts
    const queryParts: string[] = [
      `'${folderId}' in parents`,
      'trashed = false',
    ];

    // Add video filter if requested
    if (videoOnly) {
      const videoMimeQuery = ALLOWED_VIDEO_TYPES.map(
        (type) => `mimeType = '${type}'`
      ).join(' or ');
      // Include folders so user can navigate
      queryParts.push(
        `(mimeType = 'application/vnd.google-apps.folder' or ${videoMimeQuery})`
      );
    }

    // Add search query if provided
    if (query) {
      queryParts.push(`name contains '${query.replace(/'/g, "\\'")}'`);
    }

    const params = new URLSearchParams({
      q: queryParts.join(' and '),
      pageSize: pageSize.toString(),
      orderBy,
      fields:
        'nextPageToken,files(id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,iconLink,createdTime,modifiedTime,parents)',
      ...(pageToken && { pageToken }),
    });

    const response = await fetchWithRetry(`${DRIVE_API_BASE}/files?${params}`, {
      timeoutMs: 15000,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message?: string } };
      throw new Error(
        `Failed to list files: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      files?: DriveFile[];
      nextPageToken?: string;
    };

    return {
      files: data.files || [],
      nextPageToken: data.nextPageToken,
    };
  }

  /**
   * Get file metadata
   * @param fileId The file ID
   * @returns File metadata
   */
  async getFile(fileId: string): Promise<DriveFile> {
    const params = new URLSearchParams({
      fields:
        'id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,iconLink,createdTime,modifiedTime,parents,trashed',
    });

    const response = await fetchWithRetry(
      `${DRIVE_API_BASE}/files/${fileId}?${params}`,
      {
        timeoutMs: 15000,
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message?: string } };
      if (response.status === 404) {
        throw new Error('File not found');
      }
      throw new Error(
        `Failed to get file: ${error.error?.message || 'Unknown error'}`
      );
    }

    return (await response.json()) as DriveFile;
  }

  /**
   * Get folder path (breadcrumbs)
   * @param folderId The folder ID
   * @returns Array of folder breadcrumbs from root to current
   */
  async getFolderPath(folderId: string): Promise<FolderBreadcrumb[]> {
    const breadcrumbs: FolderBreadcrumb[] = [];
    let currentId: string | undefined = folderId;

    // Traverse up the folder hierarchy
    while (currentId && currentId !== 'root') {
      try {
        const folder = await this.getFile(currentId);
        breadcrumbs.unshift({ id: folder.id, name: folder.name });

        // Get parent folder
        if (folder.parents && folder.parents.length > 0) {
          currentId = folder.parents[0];
        } else {
          break;
        }
      } catch {
        // Stop if we can't access the folder (e.g., shared drive root)
        break;
      }
    }

    // Add root at the beginning
    breadcrumbs.unshift({ id: 'root', name: 'My Drive' });

    return breadcrumbs;
  }

  /**
   * Download file content as a stream
   * @param fileId The file ID
   * @returns Readable stream of file content
   */
  async downloadFile(fileId: string): Promise<{
    stream: ReadableStream<Uint8Array>;
    mimeType: string;
    fileName: string;
    size: number;
  }> {
    // First get file metadata to validate
    const file = await this.getFile(fileId);

    if (!file.size) {
      throw new Error('Cannot download file: size unknown');
    }

    const size = Number.parseInt(file.size, 10);

    if (size > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File too large. Maximum size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024 * 1024)}GB`
      );
    }

    if (!ALLOWED_VIDEO_TYPES.includes(file.mimeType)) {
      throw new Error(
        `Invalid file type: ${file.mimeType}. Only video files are allowed.`
      );
    }

    // Download the file
    const response = await fetchWithRetry(
      `${DRIVE_API_BASE}/files/${fileId}?alt=media`,
      {
        timeoutMs: 15000,
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as { error?: { message?: string } };
      throw new Error(
        `Failed to download file: ${error.error?.message || 'Unknown error'}`
      );
    }

    if (!response.body) {
      throw new Error('No response body for download');
    }

    return {
      stream: response.body,
      mimeType: file.mimeType,
      fileName: file.name,
      size,
    };
  }

  /**
   * Check if a file is a video
   * @param mimeType The MIME type to check
   * @returns True if the file is a supported video type
   */
  static isVideoFile(mimeType: string): boolean {
    return ALLOWED_VIDEO_TYPES.includes(mimeType);
  }

  /**
   * Check if a file is a folder
   * @param mimeType The MIME type to check
   * @returns True if the file is a folder
   */
  static isFolder(mimeType: string): boolean {
    return mimeType === 'application/vnd.google-apps.folder';
  }
}
