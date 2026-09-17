import { format } from 'date-fns';
import {
  FileIcon,
  FileImage,
  FileText,
  FolderOpen,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';

import { useDeleteLeadDocument } from '@/features/patient-documents/api/delete-lead-document/delete-lead-document.hook';
import { PATIENT_DOCUMENT_ACCEPT } from '@/features/patient-documents/api/types';
import { useUploadLeadDocuments } from '@/features/patient-documents/api/upload-lead-document/upload-lead-document.hook';
import { useOpenStaffPatientDocument } from '@/features/patient-documents/api/use-open-document';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { LeadProfileDocument } from '../api';

/** `accept` attribute built from the same allow-list the upload hook enforces. */
const ACCEPT_ATTRIBUTE = Object.entries(PATIENT_DOCUMENT_ACCEPT)
  .flatMap(([mimeType, extensions]) => [mimeType, ...extensions])
  .join(',');

function mimeIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) {
    return FileText;
  }
  return FileIcon;
}

function formatSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(0)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

const uploadedByLabel: Record<LeadProfileDocument['uploadedByType'], string> = {
  patient: 'Patient',
  staff: 'Staff',
};

/**
 * Documents tab — the patient's document vault (referrals, reports, ID…),
 * uploaded by the patient in the portal or by staff on their behalf.
 * Each file opens in a new tab via a short-lived presigned URL.
 */
export function PatientDocumentsTab({
  leadId,
  documents,
}: {
  leadId: string;
  documents: LeadProfileDocument[];
}) {
  // Private-bucket files aren't directly fetchable — every open mints a
  // short-lived presigned URL through the staff download endpoint.
  const { openDocument, openingId } = useOpenStaffPatientDocument(leadId);
  const { uploads, uploadFiles, dismissUpload, isUploading } =
    useUploadLeadDocuments(leadId);
  const { deleteDocument, isDeleting } = useDeleteLeadDocument(leadId);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] =
    useState<LeadProfileDocument | null>(null);

  const uploadControl = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) void uploadFiles(files);
          // Reset so re-picking the same file fires onChange again.
          event.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isUploading}
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Upload aria-hidden />
        )}
        Add documents
      </Button>
    </>
  );

  const uploadProgress = uploads.length > 0 && (
    <ul className="space-y-2">
      {uploads.map((upload) => (
        <li key={upload.id} className="rounded-lg border px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate font-medium">{upload.fileName}</span>
            {upload.status === 'error' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => dismissUpload(upload.id)}
              >
                Dismiss
              </Button>
            ) : (
              <span className="text-muted-foreground shrink-0">
                {upload.progress}%
              </span>
            )}
          </div>
          {upload.status === 'error' ? (
            <p className="text-destructive mt-1" role="alert">
              {upload.error}
            </p>
          ) : (
            <Progress value={upload.progress} className="mt-2 h-1.5" />
          )}
        </li>
      ))}
    </ul>
  );

  const deleteConfirmation = (
    <ConfirmDeleteDialog
      cancelLabel="Keep document"
      confirmLabel="Delete document"
      description="The file is removed from this patient’s vault and will no longer be visible to them in the portal."
      isPending={isDeleting}
      onConfirm={() => {
        if (pendingDelete) deleteDocument(pendingDelete.id);
        setPendingDelete(null);
      }}
      onOpenChange={(open) => {
        if (!open) setPendingDelete(null);
      }}
      open={pendingDelete !== null}
      title={<>Delete &ldquo;{pendingDelete?.fileName}&rdquo;?</>}
    />
  );

  if (documents.length === 0) {
    return (
      <div className="space-y-4">
        {uploadProgress}
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>No documents yet</EmptyTitle>
            <EmptyDescription>
              Files this patient uploads in the portal — or staff upload on
              their behalf — will appear here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{uploadControl}</EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{uploadControl}</div>
      {uploadProgress}
      {deleteConfirmation}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Uploaded by</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((document) => {
              const Icon = mimeIcon(document.mimeType);
              return (
                <TableRow key={document.id}>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => openDocument(document.id)}
                      disabled={openingId === document.id}
                      className="flex items-center gap-2 font-medium hover:underline disabled:opacity-60"
                    >
                      {openingId === document.id ? (
                        <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
                      ) : (
                        <Icon className="text-muted-foreground size-4 shrink-0" />
                      )}
                      <span className="truncate">{document.fileName}</span>
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatSize(document.sizeBytes)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {uploadedByLabel[document.uploadedByType]}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(document.createdAt), 'd MMM yyyy')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${document.fileName}`}
                      disabled={isDeleting}
                      onClick={() => setPendingDelete(document)}
                    >
                      <Trash2 className="text-muted-foreground size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
