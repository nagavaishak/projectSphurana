'use client';

import {
  ArrowLeftIcon,
  FileIcon,
  FolderOpenIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useListPortalDocuments } from '../api/list-portal-documents.hook';
import { useOpenPortalDocument } from '../api/open-portal-document.hook';
import { PortalProvider, usePortalLink } from '../api/portal-provider';
import {
  PATIENT_DOCUMENT_ACCEPT,
  type PatientDocumentItem,
} from '../api/types';
import {
  type DocumentUpload,
  useUploadPortalDocuments,
} from '../api/upload-portal-documents.hook';
import { describeUploadRejection, rejectFile } from '../api/upload-rejection';
import { PortalAuthGate } from '../portal-auth-gate';
import type { PortalContext } from '../portal-context';
import { shortDateInTz } from '../portal-time';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../ui/empty';

const DocumentsSkeleton = (
  <div className="flex flex-col gap-4">
    <Skeleton className="h-8 w-40" />
    <Skeleton className="h-32 w-full rounded-xl" />
    <Skeleton className="h-16 w-full rounded-xl" />
    <Skeleton className="h-16 w-full rounded-xl" />
  </div>
);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload target.
 *
 * apps/app used the kibo-ui `Dropzone` (react-dropzone). Neither is a
 * dependency here, and the control is a labelled file input with four drag
 * handlers — so it is built directly rather than pulling a package in for it.
 * Tap-to-choose works identically on mobile, which is where most of these
 * uploads come from.
 */
function UploadDropzone({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const accept = (files: FileList | null) => {
    if (!files) return;
    const accepted: File[] = [];
    // Validate client-side purely so a customer hears about a 20MB photo
    // before uploading it. The presign endpoint re-validates both rules.
    for (const file of Array.from(files).slice(0, 5)) {
      const rejection = rejectFile(file);
      if (rejection) {
        toast.error(describeUploadRejection(rejection));
      } else {
        accepted.push(file);
      }
    }
    if (accepted.length > 0) onFiles(accepted);
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-dashed transition-colors',
        isDragging && 'border-primary bg-accent/50',
        disabled && 'opacity-60'
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        if (!disabled) accept(event.dataTransfer.files);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center gap-2 rounded-xl px-4 py-6 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed"
      >
        <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <UploadIcon className="text-muted-foreground size-5" aria-hidden />
        </div>
        <span className="text-sm font-medium">Tap to add a document</span>
        <span className="text-muted-foreground text-xs">
          PDF or photo, up to 15MB
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={PATIENT_DOCUMENT_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          accept(event.target.files);
          // Reset so re-picking the same file fires change again.
          event.target.value = '';
        }}
      />
    </div>
  );
}

function UploadRow({
  upload,
  onDismiss,
}: {
  upload: DocumentUpload;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border px-4 py-3">
      <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
        <FileIcon className="text-muted-foreground size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{upload.fileName}</p>
        {upload.status === 'error' ? (
          <p role="alert" className="text-destructive text-xs">
            {upload.error ?? 'Upload failed'}
          </p>
        ) : (
          // A native <progress> rather than a div with role="progressbar":
          // it carries the semantics for free, and biome correctly refuses the
          // ARIA role on a non-focusable div. Track/fill are styled through the
          // pseudo-elements so the appearance is unchanged.
          <progress
            className="mt-1.5 h-1.5 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:bg-primary [&::-webkit-progress-value]:rounded-full [&::-moz-progress-bar]:bg-primary"
            value={upload.progress}
            max={100}
            aria-label={`Uploading ${upload.fileName}`}
          />
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Dismiss ${upload.fileName}`}
        onClick={onDismiss}
      >
        <XIcon className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function DocumentRow({
  document,
  timezone,
  onOpen,
  isOpening,
}: {
  document: PatientDocumentItem;
  timezone: string;
  onOpen: () => void;
  isOpening: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={isOpening}
      className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
    >
      <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
        <FileIcon className="text-muted-foreground size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{document.fileName}</p>
        <p className="text-muted-foreground text-xs">
          {shortDateInTz(document.createdAt, timezone)} ·{' '}
          {formatSize(document.sizeBytes)}
          {document.uploadedByType === 'staff' && ' · Added by your clinic'}
        </p>
      </div>
      {isOpening && (
        <span className="text-muted-foreground text-xs">Opening…</span>
      )}
    </button>
  );
}

function DocumentsContent() {
  const { documents, isLoading, isError, refetch } = useListPortalDocuments();
  const { openDocument, openingId } = useOpenPortalDocument();
  const { uploads, uploadFiles, dismissUpload, isUploading } =
    useUploadPortalDocuments();
  const link = usePortalLink();

  // Documents carry no clinic timezone of their own; the created-at date is
  // shown in the viewer's zone, which is the right frame for "when did I
  // upload this" (unlike an appointment, which belongs to the clinic's day).
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-1">
        <a
          href={link()}
          className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          Back
        </a>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          My documents
        </h1>
        <p className="text-muted-foreground text-sm">
          Share referral letters, treatment reports or photos with your clinic.
        </p>
      </div>

      <UploadDropzone
        disabled={isUploading}
        onFiles={(files) => void uploadFiles(files)}
      />

      {uploads.map((upload) => (
        <UploadRow
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
        <div
          role="alert"
          className="border-destructive/50 text-destructive flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm"
        >
          Couldn't load your documents.
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : documents.length === 0 && uploads.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <FolderOpenIcon />
            </EmptyMedia>
            <EmptyTitle>No documents yet</EmptyTitle>
            <EmptyDescription>
              Anything you upload — and anything your clinic shares with you —
              will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {documents.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              timezone={timezone}
              onOpen={() => void openDocument(document.id)}
              isOpening={openingId === document.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function PortalDocumentsIsland({ ctx }: { ctx: PortalContext }) {
  return (
    <PortalProvider ctx={ctx}>
      <PortalAuthGate
        skeleton={DocumentsSkeleton}
        errorIcon={<FolderOpenIcon />}
        errorTitle="Something went wrong"
        errorDescription="We couldn't load your documents. Please try again."
      >
        {() => <DocumentsContent />}
      </PortalAuthGate>
    </PortalProvider>
  );
}
