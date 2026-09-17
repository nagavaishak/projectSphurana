import { FolderOpenIcon, UploadIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from '@/components/kibo-ui/dropzone';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

import { useDeleteLeadDocument } from '../api/delete-lead-document';
import { useListLeadDocuments } from '../api/list-lead-documents';
import type { PatientDocumentItem } from '../api/types';
import {
  PATIENT_DOCUMENT_ACCEPT,
  PATIENT_DOCUMENT_MAX_SIZE_BYTES,
} from '../api/types';
import { useUploadLeadDocuments } from '../api/upload-lead-document';
import { describeUploadRejection } from '../api/upload-rejection';
import { useOpenStaffPatientDocument } from '../api/use-open-document';
import { DocumentUploadRow, PatientDocumentRow } from './document-list';

/**
 * Staff-side patient document vault (ENG-647 Phase 4): list + upload on the
 * patient's behalf + delete with confirm. Embeddable wherever a lead profile
 * needs a documents section — pass the `leadId`.
 */
export function PatientDocumentsPanel({ leadId }: { leadId: string }) {
  const { documents, isLoading, isError, refetch } =
    useListLeadDocuments(leadId);
  const { uploads, uploadFiles, dismissUpload, isUploading } =
    useUploadLeadDocuments(leadId);
  const { deleteDocument, isDeleting } = useDeleteLeadDocument(leadId);
  const { openDocument, openingId } = useOpenStaffPatientDocument(leadId);
  const [pendingDelete, setPendingDelete] =
    useState<PatientDocumentItem | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <Dropzone
        accept={PATIENT_DOCUMENT_ACCEPT}
        maxSize={PATIENT_DOCUMENT_MAX_SIZE_BYTES}
        maxFiles={5}
        disabled={isUploading}
        onDrop={(acceptedFiles) => void uploadFiles(acceptedFiles)}
        onError={(error) => toast.error(describeUploadRejection(error))}
      >
        <DropzoneEmptyState>
          <div className="flex flex-col items-center gap-1 py-2">
            <UploadIcon className="text-muted-foreground size-5" />
            <p className="text-sm font-medium">
              Upload a document for this patient
            </p>
            <p className="text-muted-foreground text-xs">
              PDF or photo, up to 15MB
            </p>
          </div>
        </DropzoneEmptyState>
        <DropzoneContent />
      </Dropzone>

      {uploads.map((upload) => (
        <DocumentUploadRow
          key={upload.id}
          upload={upload}
          onDismiss={() => dismissUpload(upload.id)}
        />
      ))}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-2">
            Couldn't load documents.
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : documents.length === 0 && uploads.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpenIcon />
            </EmptyMedia>
            <EmptyTitle>No documents yet</EmptyTitle>
            <EmptyDescription>
              Files the patient uploads in their portal, or that you add here,
              will appear in this list.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {documents.map((document) => (
            <PatientDocumentRow
              key={document.id}
              document={document}
              uploadedByChip={
                document.uploadedByType === 'patient' ? 'Patient' : 'Staff'
              }
              onOpen={() => openDocument(document.id)}
              isOpening={openingId === document.id}
              onDelete={() => setPendingDelete(document)}
              isDeleting={isDeleting && deleteTargetId === document.id}
            />
          ))}
        </div>
      )}

      <ConfirmDeleteDialog
        description="The file is removed from the patient’s documents. This can’t be undone from here."
        isPending={isDeleting}
        onConfirm={() => {
          if (pendingDelete) {
            setDeleteTargetId(pendingDelete.id);
            deleteDocument(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        open={!!pendingDelete}
        title={<>Delete &ldquo;{pendingDelete?.fileName}&rdquo;?</>}
      />
    </div>
  );
}
