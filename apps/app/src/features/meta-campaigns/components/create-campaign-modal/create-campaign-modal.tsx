import { CitySearch } from '@/components/app/city-search';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CreateLeadFormDialog } from '@/features/lead-forms';

import { cn } from '@/lib/utils';
import type { MessagingDestination } from '@borradh-workspace/api-client/types';
import { messagingDestinationLabels } from '@borradh-workspace/api-client/types';
import {
  AlertCircle,
  Check,
  ChevronsUpDown,
  Facebook,
  Instagram,
  Loader2,
  MapPin,
  MessageCircle,
  Plus,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';
import {
  FOLLOW_UP_OPTIONS,
  createCampaignFormLabels as L,
  OptimizationModeField,
  getLeadFormFieldsPreview,
  useCreateCampaignForm,
} from '../create-campaign-form';
import { MetaErrorDialog } from '../meta-error-dialog';

const DESTINATION_ORDER: MessagingDestination[] = [
  'instagram_dm',
  'whatsapp',
  'messenger',
];

const DESTINATION_ICONS: Record<MessagingDestination, LucideIcon> = {
  instagram_dm: Instagram,
  whatsapp: MessageCircle,
  messenger: Facebook,
};

interface CreateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Desktop presentation of the shared create-campaign core
 * (`useCreateCampaignForm`). The mobile funnel — `CampaignMobileCreate` —
 * renders the same core with a step/sheet UI. Neither surface owns a schema or
 * builds a payload; both go through the hook.
 */
export function CreateCampaignDialog({
  open,
  onOpenChange,
}: CreateCampaignDialogProps) {
  const formId = useId();
  const [leadFormPickerOpen, setLeadFormPickerOpen] = useState(false);
  const [createLeadFormOpen, setCreateLeadFormOpen] = useState(false);

  const {
    form,
    onSubmit,
    isExecuting,
    isMetaNotConfigured,
    currencySymbol,
    hasLocation,
    locationPrefillPending,
    targetingLocation,
    clearLocation,
    setLocation,
    isChatbot,
    destinations,
    optimizationMode,
    showOptimization,
    setOptimizationMode,
    toggleDestination,
    isDestinationDisabled,
    syncedLeadForms,
    selectedLeadForm,
    hasNoLeadForms,
    isLoadingLeadForms,
    metaError,
    showMetaErrorDialog,
    setShowMetaErrorDialog,
  } = useCreateCampaignForm({ onSuccess: () => onOpenChange(false) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        onInteractOutside={(e) => {
          // Keep dialog open when clicking Google Maps autocomplete suggestions
          const target = e.target as HTMLElement;
          if (target.closest('.pac-container')) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Create campaign</DialogTitle>
          <DialogDescription>
            Create a new ad campaign on Meta. You can add ads to it later.
          </DialogDescription>
        </DialogHeader>

        {isMetaNotConfigured ? (
          <div className="flex items-center gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <p>
              Please connect your Meta Ads account in the Integrations settings
              before creating campaigns.
            </p>
          </div>
        ) : (
          <Form {...form}>
            <form
              id={formId}
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{L.name}</FormLabel>
                    <FormControl>
                      <Input placeholder="My campaign" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dailyBudget"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{L.dailyBudget}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          {currencySymbol}
                        </span>
                        {/* FormControl's id lands on the wrapping div (the
                            currency prefix lives there), so label the input
                            explicitly. */}
                        <Input
                          type="number"
                          aria-label={L.dailyBudget}
                          step="0.01"
                          min="1"
                          placeholder="50.00"
                          className="pl-8"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-[1fr_120px] gap-3">
                <FormField
                  control={form.control}
                  name="targetingLocation"
                  render={() => (
                    <FormItem>
                      <FormLabel>{L.targetingLocation}</FormLabel>
                      {hasLocation ? (
                        <div className="flex h-9 items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <MapPin className="h-4 w-4 shrink-0 text-primary" />
                            <span className="truncate">
                              {targetingLocation}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={clearLocation}
                            className="ml-2 rounded-sm p-0.5 hover:bg-muted"
                            aria-label="Remove location"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : locationPrefillPending ? (
                        <div className="flex h-9 items-center rounded-md border border-input bg-transparent px-3 text-sm text-muted-foreground">
                          Loading location…
                        </div>
                      ) : (
                        <CitySearch onCitySelect={setLocation} />
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="targetingDistanceKm"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{L.targetingDistanceKm}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          {/* FormControl's id lands on the wrapping div (the
                              "km" suffix lives there), so label the input
                              explicitly. */}
                          <Input
                            type="number"
                            aria-label={L.targetingDistanceKm}
                            min={1}
                            max={500}
                            step={1}
                            value={field.value ?? ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              field.onChange(v === '' ? undefined : Number(v));
                            }}
                            className="pr-9"
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            km
                          </span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="followUpType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{L.followUpType}</FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value}
                        onValueChange={field.onChange}
                        className="grid grid-cols-2 gap-3"
                      >
                        {FOLLOW_UP_OPTIONS.map((option) => (
                          <FollowUpRadioCard
                            key={option.value}
                            value={option.value}
                            label={option.label}
                            checked={field.value === option.value}
                          />
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!isChatbot && (
                <FormField
                  control={form.control}
                  name="leadFormId"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>{L.leadFormId}</FormLabel>
                      {hasNoLeadForms ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full justify-start"
                          onClick={() => setCreateLeadFormOpen(true)}
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Create a lead form
                        </Button>
                      ) : (
                        <Popover
                          open={leadFormPickerOpen}
                          onOpenChange={setLeadFormPickerOpen}
                        >
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                aria-expanded={leadFormPickerOpen}
                                className="h-auto min-h-9 w-full justify-between"
                                disabled={isLoadingLeadForms}
                              >
                                {selectedLeadForm ? (
                                  <span className="flex min-w-0 flex-col items-start">
                                    <span className="truncate">
                                      {selectedLeadForm.name}
                                    </span>
                                    <span className="w-full truncate text-xs text-muted-foreground">
                                      {getLeadFormFieldsPreview(
                                        selectedLeadForm
                                      )}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    Select a lead form
                                  </span>
                                )}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[var(--radix-popover-trigger-width)] p-0"
                            align="start"
                          >
                            <Command>
                              <CommandInput placeholder="Search lead forms..." />
                              <CommandList>
                                <CommandEmpty>
                                  No lead forms found.
                                </CommandEmpty>
                                <CommandGroup>
                                  {syncedLeadForms.map((leadForm) => (
                                    <CommandItem
                                      key={leadForm.id}
                                      value={leadForm.name}
                                      onSelect={() => {
                                        field.onChange(leadForm.id);
                                        setLeadFormPickerOpen(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          'mr-2 h-4 w-4 shrink-0',
                                          field.value === leadForm.id
                                            ? 'opacity-100'
                                            : 'opacity-0'
                                        )}
                                      />
                                      <span className="flex min-w-0 flex-col">
                                        <span className="truncate">
                                          {leadForm.name}
                                        </span>
                                        <span className="truncate text-xs text-muted-foreground">
                                          {getLeadFormFieldsPreview(leadForm)}
                                        </span>
                                      </span>
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                              {/* Always-visible create action pinned at the
                                  bottom, outside the searchable list. */}
                              <div className="border-t p-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="w-full justify-start font-normal"
                                  onClick={() => {
                                    setLeadFormPickerOpen(false);
                                    setCreateLeadFormOpen(true);
                                  }}
                                >
                                  <Plus className="mr-2 h-4 w-4" />
                                  Create new lead form
                                </Button>
                              </div>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {isChatbot && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div>
                      <Label className="text-sm">{L.destinations}</Label>
                      <p className="text-xs text-muted-foreground">
                        Pick one or more.
                      </p>
                    </div>
                    <FieldGroup
                      data-slot="checkbox-group"
                      className="grid grid-cols-3 gap-3"
                    >
                      {DESTINATION_ORDER.map((value) => {
                        const checkboxId = `${formId}-${value}`;
                        const disabled = isDestinationDisabled(value);
                        const checked = destinations.includes(value);
                        const Icon = DESTINATION_ICONS[value];
                        const disabledReason =
                          value === 'whatsapp'
                            ? 'Connect WhatsApp first.'
                            : 'No linked Instagram Professional account.';
                        const card = (
                          <Field
                            orientation="horizontal"
                            data-disabled={disabled || undefined}
                            className={cn(
                              'rounded-lg border p-3 transition-colors',
                              checked
                                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                : 'border-input hover:border-primary/50',
                              disabled && 'cursor-not-allowed opacity-60'
                            )}
                          >
                            <Checkbox
                              id={checkboxId}
                              name={checkboxId}
                              checked={checked}
                              disabled={disabled}
                              onCheckedChange={() => toggleDestination(value)}
                            />
                            <FieldLabel
                              htmlFor={checkboxId}
                              className="flex items-center gap-2"
                            >
                              <Icon className="h-4 w-4" />
                              {messagingDestinationLabels[value]}
                            </FieldLabel>
                          </Field>
                        );
                        if (!disabled) {
                          return <div key={value}>{card}</div>;
                        }
                        return (
                          <Tooltip key={value}>
                            <TooltipTrigger asChild>
                              <div>{card}</div>
                            </TooltipTrigger>
                            <TooltipContent>{disabledReason}</TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </FieldGroup>
                    {destinations.length === 0 && (
                      <p className="text-xs text-destructive">
                        Select at least one destination.
                      </p>
                    )}
                  </div>

                  {/* Advanced settings — hidden when WhatsApp is selected
                      because Meta forces Engagement for WhatsApp. */}
                  {showOptimization && (
                    <OptimizationModeField
                      layout="desktop"
                      value={optimizationMode}
                      onChange={setOptimizationMode}
                    />
                  )}
                </>
              )}
            </form>
          </Form>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={isExecuting || isMetaNotConfigured}
          >
            {isExecuting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create campaign
          </Button>
        </DialogFooter>
      </DialogContent>
      <MetaErrorDialog
        open={showMetaErrorDialog}
        onOpenChange={setShowMetaErrorDialog}
        error={metaError}
      />
      <CreateLeadFormDialog
        open={createLeadFormOpen}
        onOpenChange={setCreateLeadFormOpen}
      />
    </Dialog>
  );
}

function FollowUpRadioCard({
  value,
  label,
  checked,
}: {
  value: string;
  label: string;
  checked: boolean;
}) {
  const id = useId();
  return (
    <Label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-normal transition-colors',
        checked
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-input hover:border-primary/50'
      )}
    >
      <RadioGroupItem id={id} value={value} />
      {label}
    </Label>
  );
}
