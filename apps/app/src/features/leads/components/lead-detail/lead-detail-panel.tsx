import { useSidePanel } from '@/components/app/side-panel';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, User, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useLead } from '../../api';
import { useUpdateLeadForm } from '../../customer-form/use-update-lead-form';
import { LeadEditFields } from './lead-edit-fields';
import { LeadHistoryTab } from './lead-history-tab';

interface LeadDetailPanelProps {
  leadId: string;
}

/**
 * Body for the docked side panel that shows and edits a lead. Rendered inside
 * the global {@link useSidePanel} dock, which reflows the page to the left
 * rather than covering it with a backdrop. Edits save in place; the panel
 * closes on save.
 */
export function LeadDetailPanel({ leadId }: LeadDetailPanelProps) {
  const { close } = useSidePanel();
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details');

  const { lead, isLoading, isError } = useLead({ leadId });

  // The form state, the lead→form mapping and the submit all live in the one
  // shared controller, which the `/edit/customer/:id` editor renders too.
  const { form, isUpdating, submit } = useUpdateLeadForm({
    lead: lead ?? null,
    onDone: close,
  });

  const fullName = lead
    ? `${lead.firstName} ${lead.lastName || ''}`.trim()
    : '';

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void submit(event)}
        className="flex h-full min-h-0 flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted">
              <User className="size-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              {isLoading ? (
                <Skeleton className="h-6 w-32" />
              ) : (
                <h2 className="truncate text-base font-semibold">
                  {fullName || 'Client Details'}
                </h2>
              )}
              <p className="text-sm text-muted-foreground">
                View and edit client details.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            onClick={close}
            aria-label="Close panel"
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {isLoading && (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          )}

          {isError && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              Failed to load client details. Please try again.
            </div>
          )}

          {lead && !isLoading && (
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as typeof activeTab)}
              className="w-full"
            >
              <TabsList className="w-fit">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

              <div className="mt-4">
                <TabsContent value="details" className="mt-0">
                  <LeadEditFields form={form} lead={lead} />
                </TabsContent>
                <TabsContent value="history" className="mt-0">
                  <LeadHistoryTab leadId={lead.id} />
                </TabsContent>
              </div>
            </Tabs>
          )}
        </div>

        {/* Footer */}
        {lead && !isLoading && activeTab === 'details' && (
          <div className="flex items-center justify-end gap-2 border-t p-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={close}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isUpdating}>
              {isUpdating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
