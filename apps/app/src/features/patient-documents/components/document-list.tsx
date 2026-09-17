import { format } from 'date-fns';
import {
  AlertCircleIcon,
  DownloadIcon,
  FileTextIcon,
  ImageIcon,
  Loader2,
  Trash2Icon,
  XIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

import type { PatientDocumentItem } from '../api/types';
import type { DocumentUploadState } from '../api/use-document-uploads';

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  // Sub-kilobyte files are reported in bytes rather than rounded up to "1 KB",
  // which misrepresented a 69-byte file and disagreed with the staff panel.
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  return `${Math.round(sizeBytes / 1024)} KB`;
}

function DocumentIcon({ mimeType }: { mimeType: string }) {
  const Icon = mimeType === 'application/pdf' ? FileTextIcon : ImageIcon;
  return (
    <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
      <Icon className="text-muted-foreground size-5" />
    </div>
  );
}

/**
 * One recorded vault document. `uploadedByChip` labels who added it:
 * the portal shows a chip only for clinic uploads; the staff panel labels
 * patient uploads.
 */
export function PatientDocumentRow({
  document,
  uploadedByChip,
  onOpen,
  isOpening,
  onDelete,
  isDeleting,
}: {
  document: PatientDocumentItem;
  uploadedByChip?: string;
  /** Fetches a short-lived presigned URL and opens it — never the raw blobUrl. */
  onOpen?: () => void;
  isOpening?: boolean;
  onDelete?: () => void;
  isDeleting?: boolean;
}) {
  return (
    <Card className="flex flex-row items-center gap-3 p-3">
      <DocumentIcon mimeType={document.mimeType} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{document.fileName}</p>
          {uploadedByChip && (
            <Badge variant="secondary" className="shrink-0">
              {uploadedByChip}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          {format(new Date(document.createdAt), 'd MMM yyyy')}
          {' · '}
          {formatFileSize(document.sizeBytes)}
        </p>
      </div>
      {onOpen && (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground shrink-0"
          onClick={onOpen}
          disabled={isOpening}
          aria-label={`Download ${document.fileName}`}
        >
          {isOpening ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <DownloadIcon className="size-4" />
          )}
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive shrink-0"
          onClick={onDelete}
          disabled={isDeleting}
          aria-label={`Delete ${document.fileName}`}
        >
          {isDeleting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2Icon className="size-4" />
          )}
        </Button>
      )}
    </Card>
  );
}

/** In-flight (or failed) upload row with its progress bar. */
export function DocumentUploadRow({
  upload,
  onDismiss,
}: {
  upload: DocumentUploadState;
  onDismiss: () => void;
}) {
  return (
    <Card className="flex flex-row items-center gap-3 p-3">
      {upload.status === 'error' ? (
        <div className="bg-destructive/10 flex size-10 shrink-0 items-center justify-center rounded-lg">
          <AlertCircleIcon className="text-destructive size-5" />
        </div>
      ) : (
        <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{upload.fileName}</p>
        {upload.status === 'error' ? (
          <p className="text-destructive text-xs">
            {upload.error ?? 'Upload failed'}
          </p>
        ) : (
          <div className="mt-1 space-y-1">
            <Progress value={upload.progress} className="h-1.5" />
            <p className="text-muted-foreground text-xs">
              Uploading… {upload.progress}%
            </p>
          </div>
        )}
      </div>
      {upload.status === 'error' && (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground shrink-0"
          onClick={onDismiss}
          aria-label="Dismiss failed upload"
        >
          <XIcon className="size-4" />
        </Button>
      )}
    </Card>
  );
}
