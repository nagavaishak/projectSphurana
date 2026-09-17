'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { FileSpreadsheetIcon, Loader2Icon, UploadIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useImportLeadsCsv } from '../api';

const MAX_FILE_BYTES = 1_048_576; // 1 MB — matches the backend cap

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const isXlsx = (f: File) =>
  f.name.toLowerCase().endsWith('.xlsx') || f.type === XLSX_MIME;
const isCsv = (f: File) =>
  f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv';

/** File → base64 (no data: prefix), via FileReader so big files are safe. */
const fileToBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(f);
  });

interface ImportLeadsCsvDialogProps {
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
 * Upload a CSV or Excel (.xlsx) file of leads in whatever shape it comes in —
 * the backend identifies the columns (name, email, phone…) automatically, so
 * no column mapping is needed. Files are capped at 1 MB.
 */
export function ImportLeadsCsvDialog({
  trigger,
  open: openProp,
  onOpenChange,
}: ImportLeadsCsvDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { importCsv, isImporting } = useImportLeadsCsv({
    onSuccess: () => {
      setOpen(false);
      setFile(null);
      setConsent(false);
    },
  });

  const acceptFile = (f: File | undefined) => {
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.xls') && !isXlsx(f)) {
      toast.error('Legacy .xls isn’t supported — save it as .xlsx or .csv');
      return;
    }
    if (!isCsv(f) && !isXlsx(f)) {
      toast.error('Choose a .csv or .xlsx file');
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      toast.error('File is over 1 MB. Split it and import in parts.');
      return;
    }
    setFile(f);
  };

  const onImport = async () => {
    if (!file || !consent || isImporting) return;
    // The uploader confirms consent for the whole file, so every channel
    // defaults to consented (manual entry stays per-channel opt-in).
    const shared = {
      deduplicateBy: 'email',
      onDuplicate: 'skip',
      consentAcknowledgment: true,
      defaultConsentEmail: true,
      defaultConsentSms: true,
      defaultConsentVoice: true,
    } as const;
    if (isXlsx(file)) {
      importCsv({
        fileBase64: await fileToBase64(file),
        fileName: file.name,
        ...shared,
      });
    } else {
      importCsv({ csv: await file.text(), ...shared });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setFile(null);
          setConsent(false);
        }
      }}
    >
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
              <UploadIcon className="size-4" />
              Import CSV
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import leads from a file</DialogTitle>
          <DialogDescription>
            CSV or Excel — columns like name, email and phone are identified
            automatically, whatever they’re called. Up to 1 MB per file.
          </DialogDescription>
        </DialogHeader>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            acceptFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            'flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
          )}
        >
          {file ? (
            <>
              <FileSpreadsheetIcon className="size-8 text-primary" />
              <span className="font-medium">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB · click to choose a different
                file
              </span>
            </>
          ) : (
            <>
              <UploadIcon className="size-8 text-muted-foreground" />
              <span className="font-medium">
                Drop your CSV or Excel file here or click to browse
              </span>
              <span className="text-xs text-muted-foreground">
                .csv or .xlsx up to 1 MB
              </span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={`.csv,text/csv,.xlsx,${XLSX_MIME}`}
          className="hidden"
          onChange={(e) => {
            acceptFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <label htmlFor="csv-consent" className="flex items-start gap-2 text-sm">
          <Checkbox
            id="csv-consent"
            checked={consent}
            onCheckedChange={(c) => setConsent(Boolean(c))}
            className="mt-0.5"
          />
          These leads have agreed to be contacted.
        </label>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isImporting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void onImport()}
            disabled={!file || !consent || isImporting}
          >
            {isImporting ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                Importing…
              </>
            ) : (
              'Import leads'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
