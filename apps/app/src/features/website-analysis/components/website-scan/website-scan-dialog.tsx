import { RefreshCwIcon, SearchIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import {
  useAnalyzeWebsiteJob,
  useApplyAnalysis,
  usePreviewAnalysis,
  useStartAnalyzeWebsite,
} from '../../api';
import type {
  AnalysisSection,
  AnalyzeWebsiteJobStatus,
  WebsiteAnalysisPlan,
} from '../../api/types';
import { PlanReview } from './plan-review';
import {
  allSelectableKeys,
  buildApplyInput,
  defaultSelection,
  hasStableKeys,
  isNoOpPlan,
  selectedCount,
} from './plan-selection';

/** Claire-voice progress copy per analyzer phase (mirrors the onboarding slide). */
const PHASE_COPY: Record<AnalyzeWebsiteJobStatus['phase'], string> = {
  pending: 'Getting ready…',
  fetching: 'Reading your website…',
  discovering: 'Exploring your pages…',
  analyzing: 'Pulling out everything we can find…',
  done: 'Done',
  error: 'That did not work',
};

/** The "what should we look for?" checklist, in the order it reads best. */
const SCAN_OPTIONS: {
  section: AnalysisSection;
  label: string;
  hint: string;
}[] = [
  {
    section: 'services',
    label: 'Services & prices',
    hint: 'Treatment names and what you charge',
  },
  {
    section: 'packages',
    label: 'Packages & bundles',
    hint: 'Courses and multi-session offers',
  },
  {
    section: 'description',
    label: 'Business description',
    hint: 'The "about us" text for your booking page',
  },
  {
    section: 'location',
    label: 'Location & address',
    hint: 'Where you operate',
  },
  { section: 'hours', label: 'Opening hours', hint: 'Your weekly schedule' },
  { section: 'team', label: 'Team members', hint: 'Names and job titles' },
  {
    section: 'brand',
    label: 'Brand details',
    hint: 'Logo, colours and tone of voice',
  },
];

const ALL_SECTIONS = SCAN_OPTIONS.map((o) => o.section);

/** Human summary of what an apply actually wrote, for the success toast. */
const describeWrites = (summary: {
  createdServiceIds: string[];
  servicesPriceUpdated: number;
  servicesDeactivated: number;
  locationsCreated: number;
  practitionersCreated: number;
  practitionersDeactivated: number;
  packagesCreated: number;
  packagesDeactivated: number;
  venueDescriptionUpdated: boolean;
  openingHoursUpdated: boolean;
  brandUpdated: boolean;
}) => {
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;

  if (summary.createdServiceIds.length) {
    parts.push(
      `${plural(summary.createdServiceIds.length, 'service', 'services')} added`
    );
  }
  if (summary.servicesPriceUpdated) {
    parts.push(
      `${plural(summary.servicesPriceUpdated, 'price', 'prices')} updated`
    );
  }
  if (summary.servicesDeactivated) {
    parts.push(
      `${plural(summary.servicesDeactivated, 'service', 'services')} switched off`
    );
  }
  if (summary.packagesCreated) {
    parts.push(
      `${plural(summary.packagesCreated, 'package', 'packages')} added`
    );
  }
  if (summary.packagesDeactivated) {
    parts.push(
      `${plural(summary.packagesDeactivated, 'package', 'packages')} switched off`
    );
  }
  if (summary.practitionersCreated) {
    parts.push(
      `${plural(summary.practitionersCreated, 'team member', 'team members')} added`
    );
  }
  if (summary.practitionersDeactivated) {
    parts.push(
      `${plural(summary.practitionersDeactivated, 'team member', 'team members')} switched off`
    );
  }
  if (summary.locationsCreated) {
    parts.push(
      `${plural(summary.locationsCreated, 'address', 'addresses')} added`
    );
  }
  if (summary.venueDescriptionUpdated) parts.push('description updated');
  if (summary.openingHoursUpdated) parts.push('opening hours updated');
  if (summary.brandUpdated) parts.push('brand details updated');

  return parts.join(' · ');
};

/**
 * Scan the customer's website and pull what it finds into the account
 * (ENG-645 / ENG-659) — the same scanner onboarding runs, available afterwards
 * so an existing customer never has to be set up by hand.
 *
 * Three steps in one dialog: choose what to look for, wait, then review. The
 * diff is computed by the API against live account state and RE-computed when
 * Apply runs, so what the owner approves is what happens.
 */
export function WebsiteScanDialog({
  websiteUrl,
  disabled,
}: {
  websiteUrl: string;
  /** No website on the account yet — nothing to scan. */
  disabled?: boolean;
}) {
  const { currency } = useOrgCurrency();

  const [open, setOpen] = useState(false);
  const [bookingSystemUrl, setBookingSystemUrl] = useState('');
  const [sections, setSections] = useState<AnalysisSection[]>(ALL_SECTIONS);
  const [jobId, setJobId] = useState<string | null>(null);
  const [plan, setPlan] = useState<WebsiteAnalysisPlan | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const { job } = useAnalyzeWebsiteJob(jobId);
  const { previewAnalysis, isPreviewing } = usePreviewAnalysis({
    onSuccess: (result) => {
      setPlan(result);
      setSelected(defaultSelection(result));
    },
  });

  const resetAll = useCallback(() => {
    setJobId(null);
    setPlan(null);
    setSelected(new Set());
  }, []);

  const { applyAnalysis, isApplying } = useApplyAnalysis({
    onSuccess: (summary) => {
      const written = describeWrites(summary);
      toast.success(
        written
          ? 'Your website details have been saved'
          : 'Nothing to change — your account already matches your website',
        written ? { description: written } : undefined
      );
      if (summary.skipped.length > 0) {
        toast.warning(
          `${summary.skipped.length} item${
            summary.skipped.length === 1 ? ' was' : 's were'
          } left alone`,
          { description: summary.skipped.slice(0, 4).join(' · ') }
        );
      }
      setOpen(false);
      resetAll();
    },
  });

  const { startAnalyze, isStarting } = useStartAnalyzeWebsite({
    onSuccess: (id) => setJobId(id),
    onError: (error) =>
      toast.error(error.message || 'Could not start the scan'),
  });

  // The scan finished — diff it against the account. Guarded on `plan` so a
  // background refetch of a completed job cannot re-trigger the preview.
  useEffect(() => {
    if (job?.status === 'done' && jobId && !plan && !isPreviewing) {
      previewAnalysis({ jobId });
    }
  }, [job?.status, jobId, plan, isPreviewing, previewAnalysis]);

  const isScanning =
    isStarting || (jobId !== null && job?.status !== 'done' && !job?.error);
  const isBusy = isScanning || isPreviewing;

  const toggleSection = (section: AnalysisSection, checked: boolean) =>
    setSections((current) =>
      checked
        ? ALL_SECTIONS.filter((s) => s === section || current.includes(s))
        : current.filter((s) => s !== section)
    );

  const onToggle = useCallback((key: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const onToggleMany = useCallback((keys: string[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }, []);

  const onScan = () => {
    if (!websiteUrl.trim()) {
      toast.error('Add your website address above first, then save.');
      return;
    }
    resetAll();
    startAnalyze({
      websiteUrl: websiteUrl.trim(),
      bookingSystemUrl: bookingSystemUrl.trim() || undefined,
      // A rescan must never be served the cached result of an earlier one —
      // the whole point is to pick up what changed on the site.
      forceRefresh: true,
      scanFor: sections,
    });
  };

  const counts = useMemo(() => {
    if (!plan) return { total: 0, chosen: 0 };
    return {
      total: allSelectableKeys(plan).length,
      chosen: selectedCount(plan, selected),
    };
  }, [plan, selected]);

  const nothingToDo = plan ? isNoOpPlan(plan) : false;
  // Rows arrived without server-issued keys — see `hasStableKeys`. Refuse the
  // review rather than render checkboxes that all toggle together.
  const keysUsable = plan ? hasStableKeys(plan) : true;
  const reviewing = plan !== null;

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetAll();
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled} type="button" variant="outline">
          <SearchIcon />
          Scan my website
        </Button>
      </DialogTrigger>

      <DialogContent
        className="grid max-h-[85dvh] grid-rows-[auto_1fr_auto] gap-0 overflow-hidden p-0 sm:max-w-3xl"
        showCloseButton={!isApplying}
      >
        <DialogHeader className="space-y-1 border-b px-6 py-4 text-left">
          <DialogTitle>
            {reviewing ? 'Review what we found' : 'Scan your website'}
          </DialogTitle>
          <DialogDescription>
            {reviewing
              ? 'Tick what you want to keep. Nothing is saved until you apply.'
              : 'We read your website and pull your details straight into your account. You will see exactly what changes before anything is saved.'}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-6 py-5">
          {reviewing ? (
            !keysUsable ? (
              <Alert variant="destructive">
                <AlertDescription>
                  We can't show this scan safely — it came back without the
                  identifiers the review needs, which usually means the app
                  updated while this page was open. Reload the page and scan
                  again.
                </AlertDescription>
              </Alert>
            ) : nothingToDo ? (
              <Alert>
                <AlertDescription>
                  Your account already matches your website — there is nothing
                  to change.
                </AlertDescription>
              </Alert>
            ) : (
              <PlanReview
                accountCurrencySymbol={currency.symbol}
                onToggle={onToggle}
                onToggleMany={onToggleMany}
                plan={plan}
                selected={selected}
              />
            )
          ) : (
            <div className="space-y-6">
              <p className="text-muted-foreground text-sm">
                Scanning{' '}
                <span className="font-medium text-foreground">
                  {websiteUrl || 'your website'}
                </span>
              </p>

              <Field className="gap-2">
                <FieldLabel htmlFor="scan-booking-url">
                  Booking system link (optional)
                </FieldLabel>
                <Input
                  disabled={isBusy}
                  id="scan-booking-url"
                  onChange={(e) => setBookingSystemUrl(e.target.value)}
                  placeholder="https://..."
                  type="url"
                  value={bookingSystemUrl}
                />
              </Field>

              <div className="space-y-3">
                <p className="font-medium text-sm">What should we look for?</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {SCAN_OPTIONS.map((option) => (
                    <label
                      className="flex cursor-pointer items-start gap-3"
                      htmlFor={`scan-${option.section}`}
                      key={option.section}
                    >
                      <Checkbox
                        checked={sections.includes(option.section)}
                        disabled={isBusy}
                        id={`scan-${option.section}`}
                        onCheckedChange={(checked) =>
                          toggleSection(option.section, checked === true)
                        }
                      />
                      <span className="grid gap-0.5">
                        <span className="font-medium text-sm leading-none">
                          {option.label}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {option.hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {sections.includes('packages') &&
                !sections.includes('services') ? (
                  <p className="text-muted-foreground text-xs">
                    Packages list the services they include, so services will be
                    scanned too.
                  </p>
                ) : null}
              </div>

              {isBusy ? (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-4">
                  <Spinner className="size-4" />
                  <div className="space-y-0.5">
                    <p className="text-sm">
                      {isPreviewing
                        ? 'Comparing with your account…'
                        : PHASE_COPY[job?.phase ?? 'pending']}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      This usually takes a minute or two — you can leave this
                      open.
                    </p>
                  </div>
                </div>
              ) : null}

              {job?.status === 'error' ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    {job.error ??
                      'We could not read your website. Check the address and try again.'}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="items-center gap-2 border-t px-6 py-4 sm:justify-between">
          <p className="text-muted-foreground text-xs tabular-nums">
            {reviewing && !nothingToDo && keysUsable
              ? `${counts.chosen} of ${counts.total} changes selected`
              : null}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={isApplying}
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            {reviewing ? (
              <Button
                disabled={
                  isApplying ||
                  nothingToDo ||
                  !keysUsable ||
                  counts.chosen === 0
                }
                onClick={() =>
                  jobId &&
                  plan &&
                  applyAnalysis({ jobId, ...buildApplyInput(plan, selected) })
                }
                type="button"
              >
                {isApplying
                  ? 'Saving…'
                  : `Apply ${counts.chosen} change${
                      counts.chosen === 1 ? '' : 's'
                    }`}
              </Button>
            ) : (
              <Button
                disabled={isBusy || sections.length === 0}
                onClick={onScan}
                type="button"
              >
                {isBusy ? (
                  <>
                    <Spinner className="size-4" />
                    {isPreviewing ? 'Comparing…' : 'Scanning…'}
                  </>
                ) : (
                  <>
                    {jobId ? <RefreshCwIcon /> : <SearchIcon />}
                    {jobId ? 'Scan again' : 'Scan my website'}
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
