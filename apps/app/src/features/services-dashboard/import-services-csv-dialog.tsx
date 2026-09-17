'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useImportServicesCsv } from '@/features/organization-services';
import { cn } from '@/lib/utils';
import { FileSpreadsheetIcon, Loader2Icon, UploadIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

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

interface ImportServicesCsvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Upload a CSV or Excel export of the clinic's price list — whatever shape its
 * previous booking system produced. The backend identifies the columns (name,
 * price, duration, category) automatically, so there is no mapping step here.
 *
 * The two checkboxes are the only decisions the user has to make, and both
 * default to the safe answer: existing services of the same name are left
 * alone, and imported services go live unless the clinic asks to review first.
 */
export function ImportServicesCsvDialog({
  open,
  onOpenChange,
}: ImportServicesCsvDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [importAsInactive, setImportAsInactive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setUpdateExisting(false);
    setImportAsInactive(false);
  };

  const { importServicesCsv, isImporting } = useImportServicesCsv({
    onSuccess: () => {
      onOpenChange(false);
      reset();
    },
  });

  const acceptFile = (f: File | undefined) => {
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.xls') && !isXlsx(f)) {
      toast.error('Legacy .xls isn’t supported — save it as .xlsx or .csv');
      return;
    }
    if (!(isCsv(f) || isXlsx(f))) {
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
    if (!file || isImporting) return;
    const shared = {
      onDuplicate: updateExisting ? ('update' as const) : ('skip' as const),
      createMissingCategories: true,
      importAsInactive,
    };
    if (isXlsx(file)) {
      importServicesCsv({
        fileBase64: await fileToBase64(file),
        fileName: file.name,
        ...shared,
      });
    } else {
      importServicesCsv({
        csv: await file.text(),
        fileName: file.name,
        ...shared,
      });
    }
  };

  return (
    <Dialog
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
      open={open}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import services from a file</DialogTitle>
          <DialogDescription>
            CSV or Excel — columns like service, price, duration and category
            are identified automatically, whatever they’re called. Up to 1 MB
            per file.
          </DialogDescription>
        </DialogHeader>

        <button
          className={cn(
            'flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
          )}
          onClick={() => inputRef.current?.click()}
          onDragLeave={() => setDragOver(false)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            acceptFile(e.dataTransfer.files?.[0]);
          }}
          type="button"
        >
          {file ? (
            <>
              <FileSpreadsheetIcon className="size-8 text-primary" />
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground text-xs">
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
              <span className="text-muted-foreground text-xs">
                .csv or .xlsx up to 1 MB
              </span>
            </>
          )}
        </button>
        <input
          accept={`.csv,text/csv,.xlsx,${XLSX_MIME}`}
          className="hidden"
          onChange={(e) => {
            acceptFile(e.target.files?.[0]);
            e.target.value = '';
          }}
          ref={inputRef}
          type="file"
        />

        <div className="flex flex-col gap-2">
          <label
            className="flex items-start gap-2 text-sm"
            htmlFor="services-import-update-existing"
          >
            <Checkbox
              checked={updateExisting}
              className="mt-0.5"
              id="services-import-update-existing"
              onCheckedChange={(c) => setUpdateExisting(Boolean(c))}
            />
            Update services that already exist. Off means they’re left exactly
            as they are.
          </label>
          <label
            className="flex items-start gap-2 text-sm"
            htmlFor="services-import-inactive"
          >
            <Checkbox
              checked={importAsInactive}
              className="mt-0.5"
              id="services-import-inactive"
              onCheckedChange={(c) => setImportAsInactive(Boolean(c))}
            />
            {/* Names the state the rest of the product uses. `isActive: false`
                renders as "Archived" everywhere else, and saying "inactive"
                sent people looking for a status that does not exist. */}
            Import as archived, so I can review them before they’re bookable.
            They appear in the list with an Archived badge — restore one to make
            it bookable.
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            disabled={isImporting}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={!file || isImporting}
            onClick={() => void onImport()}
            type="button"
          >
            {isImporting ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                Importing…
              </>
            ) : (
              'Import services'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
