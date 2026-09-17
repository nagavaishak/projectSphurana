import { useResolvedRoutes } from '@/lib/use-routes';
import {
  documentImportKindLabels,
  documentImportStatusLabels,
} from '@borradh-workspace/labels';
import { Link } from '@tanstack/react-router';
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileTextIcon,
  ImageIcon,
  Loader2Icon,
  Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';

import { LeadPicker } from '@/components/app/lead-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatFileSize } from '@/features/patient-documents/components/document-list';

import {
  DISCARDABLE_STATUSES,
  type DocumentImportItem,
  IN_FLIGHT_STATUSES,
  REVIEWABLE_STATUSES,
} from '../api/types';

function KindIcon({ mimeType }: { mimeType: string }) {
  const Icon = mimeType === 'application/pdf' ? FileTextIcon : ImageIcon;
  return (
    <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
      <Icon className="text-muted-foreground size-5" />
    </div>
  );
}

const percent = (confidence: number | null) =>
  confidence === null ? null : `${Math.round(confidence * 100)}%`;

/** What the model read, for the person deciding. */
function ReadBack({ item }: { item: DocumentImportItem }) {
  const read = item.extracted;
  if (!read) return null;
  const bits = [
    read.personName,
    read.email,
    read.phone,
    read.dateOfBirth ? `DOB ${read.dateOfBirth}` : null,
  ].filter(Boolean);
  if (bits.length === 0 && !read.summary) return null;
  return (
    <p className="text-muted-foreground text-xs">
      {read.summary ? `${read.summary}. ` : ''}
      {bits.length > 0 ? `Read: ${bits.join(' · ')}` : ''}
    </p>
  );
}

/**
 * One row of the import dialog: what was uploaded, where it is in the
 * pipeline, and — for the rows the matcher could not settle — the controls
 * to settle it by hand.
 */
export function DocumentImportRow({
  item,
  onAssign,
  isAssigning,
  onDiscard,
  isDiscarding,
}: {
  item: DocumentImportItem;
  onAssign: (leadId: string) => void;
  isAssigning: boolean;
  onDiscard: () => void;
  isDiscarding: boolean;
}) {
  const routes = useResolvedRoutes();
  // The matcher's best guess, until someone picks otherwise.
  //
  // This CANNOT seed `useState`: a row is first rendered the moment it lands
  // as `pending`, when `candidates` is still null, and the 2s poll then fills
  // them in on the SAME element (the list is keyed by `item.id`, so it never
  // remounts). A lazy initialiser only runs on that first render, so on the
  // normal path the suggestion was always dropped and the picker opened empty
  // — leaving people to search for the very client the matcher had already
  // identified and shown them. Deriving it means late-arriving candidates
  // still apply, while an explicit choice keeps winning.
  const [chosenLeadId, setChosenLeadId] = useState<string>();
  const pickedLeadId = chosenLeadId ?? item.candidates?.[0]?.leadId;
  const inFlight = IN_FLIGHT_STATUSES.has(item.status);
  const reviewable = REVIEWABLE_STATUSES.has(item.status);
  const discardable = DISCARDABLE_STATUSES.has(item.status);
  const busy = isAssigning || isDiscarding;

  return (
    <li
      className="flex flex-col gap-3 rounded-lg border p-3"
      data-status={item.status}
    >
      <div className="flex items-start gap-3">
        <KindIcon mimeType={item.mimeType} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{item.fileName}</p>
            {item.documentKind && (
              <Badge variant="secondary" className="shrink-0">
                {documentImportKindLabels[item.documentKind]}
              </Badge>
            )}
            <span className="text-muted-foreground text-xs">
              {formatFileSize(item.sizeBytes)}
            </span>
          </div>

          {inFlight && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
              {item.status === 'processing'
                ? 'Reading…'
                : documentImportStatusLabels[item.status]}
            </p>
          )}

          {item.status === 'uploading' && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <AlertCircleIcon className="size-3.5" aria-hidden />
              Upload didn’t finish. Drop it again, or bin it.
            </p>
          )}

          {item.status === 'matched' && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              <CheckCircle2Icon
                className="size-3.5 text-green-600 dark:text-green-400"
                aria-hidden
              />
              <span>Filed under</span>
              {item.matchedLeadId ? (
                <Link
                  to={routes.customerDetail(item.matchedLeadId)}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {item.matchedLeadName ?? 'client'}
                </Link>
              ) : (
                <span className="font-medium">
                  {item.matchedLeadName ?? 'client'}
                </span>
              )}
              {item.matchSource === 'auto' && percent(item.confidence) && (
                <span className="text-muted-foreground">
                  · {percent(item.confidence)} match
                </span>
              )}
              {item.matchSource === 'manual' && (
                <span className="text-muted-foreground">· you picked this</span>
              )}
            </p>
          )}

          {item.status === 'needs_review' && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertCircleIcon className="size-3.5" aria-hidden />
              Needs a look
              {item.matchReason ? ` — ${item.matchReason}` : ''}
            </p>
          )}

          {item.status === 'failed' && (
            <p
              className="text-destructive flex items-center gap-1.5 text-xs"
              role="alert"
            >
              <AlertCircleIcon className="size-3.5" aria-hidden />
              {item.failureReason ?? 'Couldn’t read this one'}
            </p>
          )}

          {reviewable && <ReadBack item={item} />}
        </div>

        {discardable && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Discard ${item.fileName}`}
            disabled={busy}
            onClick={onDiscard}
          >
            {isDiscarding ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <Trash2Icon className="text-muted-foreground size-4" />
            )}
          </Button>
        )}
      </div>

      {/*
        `min-w-0` on the picker and `shrink-0` on the button are what keep
        "Attach to client" on screen. A flex item defaults to `min-width:auto`,
        so the picker refused to shrink below its own text — and a value like
        "Niamh Gearalt (niamh.gearalt@example.com)" then pushed the button off
        the right edge, clipped by the row's rounded border. Widening the
        dialog alone does not fix this: it only buys enough room for the names
        that happen to be short enough today.
      */}
      {reviewable && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <LeadPicker
            value={pickedLeadId}
            onValueChange={(leadId) => setChosenLeadId(leadId)}
            placeholder="Pick a client…"
            disabled={busy}
            className="min-w-0 sm:flex-1"
          />
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            disabled={!pickedLeadId || busy}
            onClick={() => pickedLeadId && onAssign(pickedLeadId)}
          >
            {isAssigning ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                Attaching…
              </>
            ) : (
              'Attach'
            )}
          </Button>
        </div>
      )}
    </li>
  );
}
