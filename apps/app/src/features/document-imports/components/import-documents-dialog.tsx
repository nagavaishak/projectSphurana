import { FileUpIcon, UploadIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';

import {
  Dropzone,
  DropzoneContent,
  DropzoneEmptyState,
} from '@/components/kibo-ui/dropzone';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useAssignDocumentImport } from '../api/assign-document-import';
import { useClearDocumentImports } from '../api/clear-document-imports';
import { useDiscardDocumentImport } from '../api/discard-document-import';
import { useDocumentImports } from '../api/list-document-imports';
import {
  DOCUMENT_IMPORT_ACCEPT,
  DOCUMENT_IMPORT_MAX_FILES,
  DOCUMENT_IMPORT_MAX_SIZE_BYTES,
} from '../api/types';
import { useUploadDocumentImports } from '../api/upload-document-imports';
import { DocumentImportRow } from './document-import-row';

const MAX_SIZE_MB = Math.round(DOCUMENT_IMPORT_MAX_SIZE_BYTES / (1024 * 1024));

/** Dropzone's raw rejection message → something a person can act on. */
function describeRejection(error: Error): string {
  const message = error.message ?? '';
  if (/file type|accept/i.test(message)) {
    return 'Only PDFs and photos, sorry.';
  }
  if (/larger|too large|size|maxSize/i.test(message)) {
    return `That file is over ${MAX_SIZE_MB}MB.`;
  }
  if (/too many|maxFiles/i.test(message)) {
    return `That’s more than ${DOCUMENT_IMPORT_MAX_FILES} files.`;
  }
  return 'That file can’t be imported.';
}

interface ImportDocumentsDialogProps {
  trigger?: ReactNode;
  /**
   * Optional controlled open state, so the dialog can be driven from somewhere
   * that is not its own trigger — e.g. an item inside a dropdown menu, where a
   * nested trigger does not fire reliably. Omit both to keep the previous
   * self-managed behaviour.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Bulk "Import Documents" (ENG-784). Drop consent forms, ID scans, intake
 * forms, invoices… and each one is read and filed against the matching
 * client. Anything the matcher can't settle waits here as "Needs review"
 * until someone picks the client or discards it — the trigger wears a badge
 * while any such rows are outstanding.
 */
export function ImportDocumentsDialog({
  trigger,
  open: openProp,
  onOpenChange,
}: ImportDocumentsDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const { imports, reviewCount, inFlightCount, isLoading } =
    useDocumentImports();
  const { uploads, uploadFiles, dismissUpload, isUploading } =
    useUploadDocumentImports();
  const { assignDocumentImport, assigningId } = useAssignDocumentImport();
  const { discardDocumentImport, discardingId } = useDiscardDocumentImport();

  const { clearDocumentImports, isClearing } = useClearDocumentImports();

  const visible = imports.filter((i) => i.status !== 'discarded');
  /** Anything on screen below the drop target — settled rows or in-flight uploads. */
  const hasImports = visible.length > 0 || uploads.length > 0;
  /** Finished with: filed, or unreadable and seen. Nothing here is anyone's to-do. */
  const settledCount = visible.filter(
    (i) => i.status === 'matched' || i.status === 'failed'
  ).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/*
        `trigger === null` means the caller drives this dialog from elsewhere
        (a dropdown item) and wants NO trigger of its own. `trigger || …`
        would treat that null as "unset" and render the default button —
        which is how two stray Import buttons ended up on the clients page.
      */}
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="outline">
              <FileUpIcon className="size-4" />
              Import Documents
              {reviewCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 px-1.5"
                  aria-label={`${reviewCount} documents need review`}
                >
                  {reviewCount}
                </Badge>
              )}
            </Button>
          )}
        </DialogTrigger>
      )}
      {/*
        `sm:max-w-2xl`, NOT `max-w-2xl`: DialogContent's own base class is
        `sm:max-w-lg`, and an unprefixed utility never beats a `sm:`-prefixed
        one at this breakpoint. Passing the plain form left the dialog at
        512px instead of the 672px intended — which is what squeezed the
        review row until the "Attach to client" button was clipped off the
        right edge. tailwind-merge drops the base only when the override is in
        the same variant group, so the prefix is what makes it apply at all.
      */}
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import documents</DialogTitle>
          {/*
            The full pitch only while there is nothing to look at. Once rows
            exist the reviewer knows what this dialog is, and four lines of
            explanation is just height taken from the list they came for.
          */}
          <DialogDescription>
            {hasImports
              ? 'Anything we couldn’t place is below.'
              : 'Consent forms, ID scans, intake forms, invoices, photos. We read each one and file it under the right client. Anything we’re unsure about waits here.'}
          </DialogDescription>
        </DialogHeader>

        {/*
          The drop target is the whole point of an empty dialog and mostly in
          the way of a full one, so it collapses to a single line once there
          are rows. Together with the shorter description this is ~130px handed
          back to the list — the difference between three imports fitting and
          the third being cut off mid-row.
        */}
        <Dropzone
          className={cn('shrink-0', hasImports ? 'p-3' : 'p-6')}
          accept={DOCUMENT_IMPORT_ACCEPT}
          maxSize={DOCUMENT_IMPORT_MAX_SIZE_BYTES}
          maxFiles={DOCUMENT_IMPORT_MAX_FILES}
          disabled={isUploading}
          onDrop={(accepted) => void uploadFiles(accepted)}
          onError={(error) => toast.error(describeRejection(error))}
        >
          <DropzoneEmptyState>
            {hasImports ? (
              <div className="flex items-center justify-center gap-2 py-0.5">
                <UploadIcon className="text-muted-foreground size-4 shrink-0" />
                <p className="text-sm font-medium">
                  Drop more, or click to browse
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 py-2">
                <UploadIcon className="text-muted-foreground size-5" />
                <p className="text-sm font-medium">
                  Drop files here, or click to browse
                </p>
                <p className="text-muted-foreground text-xs">
                  PDF, JPEG, PNG or WebP · up to {MAX_SIZE_MB}MB each · up to{' '}
                  {DOCUMENT_IMPORT_MAX_FILES} at a time
                </p>
              </div>
            )}
          </DropzoneEmptyState>
          <DropzoneContent />
        </Dropzone>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {uploads.length > 0 && (
            <ul className="mb-3 space-y-2" aria-label="Uploading">
              {uploads.map((upload) => (
                <li
                  key={upload.id}
                  className="rounded-lg border px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">
                      {upload.fileName}
                    </span>
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
          )}

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : visible.length === 0 && uploads.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Nothing here yet.
            </p>
          ) : (
            <ul className="space-y-2" aria-label="Imported documents">
              {visible.map((item) => (
                <DocumentImportRow
                  key={item.id}
                  item={item}
                  onAssign={(leadId) =>
                    assignDocumentImport({ importId: item.id, leadId })
                  }
                  isAssigning={assigningId === item.id}
                  onDiscard={() => discardDocumentImport(item.id)}
                  isDiscarding={discardingId === item.id}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <p className="text-muted-foreground text-xs">
            {inFlightCount > 0
              ? `Reading ${inFlightCount} ${inFlightCount === 1 ? 'document' : 'documents'}…`
              : reviewCount > 0
                ? `${reviewCount} to check`
                : 'Nothing to check'}
          </p>
          <div className="flex items-center gap-2">
            {/*
              Without this the list only ever grows: every document ever
              imported stays on screen, so the handful that still need a
              decision end up buried under months of ones that do not. Only
              the finished rows go, and the filed copies are untouched.
            */}
            {settledCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isClearing}
                onClick={() => clearDocumentImports()}
              >
                {isClearing ? 'Clearing…' : `Clear ${settledCount} done`}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
