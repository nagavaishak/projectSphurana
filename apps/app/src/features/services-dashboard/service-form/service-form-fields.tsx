import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TaxCodePicker } from '@/features/stripe-connect';
import { cn } from '@/lib/utils';
import type {
  OrganizationServiceCategory,
  PractitionerWithRelations,
} from '@borradh-workspace/api-client/types';
import {
  depositBasisLabels,
  formatMoneyCents,
  servicePriceTypeLabels,
  servicePriceTypeValues,
} from '@borradh-workspace/labels';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

import { durationOptions } from './duration-options';
import {
  OPTIONAL_LABEL_SUFFIX,
  type PriceType,
  SERVICE_DESCRIPTION_MAX,
  type ServiceFormErrors,
  type VariantDraft,
  minVariantPriceCents,
  priceTypeHasAmount,
  serviceForm,
} from './service-form-schema';

/**
 * Shared service-form fields. The desktop wizard, the mobile funnel and
 * onboarding all compose THESE components — no surface renders its own inputs.
 * `variant` only changes the chrome (mobile uses the funnel's iOS-ish styling);
 * the value semantics, labels and validation are identical on all of them.
 *
 * Every label comes from `serviceForm.labels`, the same declaration the schema
 * and the defaults come from — so the string the user reads and the string the
 * form-contract harness locates the control by cannot drift apart.
 */

const L = serviceForm.labels;

export type ServiceFieldVariant = 'desktop' | 'mobile';

export const MOBILE_SERVICE_INPUT_CLASS =
  'h-11 w-full rounded-lg border border-[#E5E5E5] bg-white px-3 text-[15px] text-black placeholder:text-[#C7C7CC] focus:border-[#0A0A0A] focus:outline-none focus:ring-1 focus:ring-[#0A0A0A]';

const MOBILE_SELECT_TRIGGER_CLASS = cn(
  MOBILE_SERVICE_INPUT_CLASS,
  'flex items-center justify-between py-0 shadow-none',
  '[&_[data-slot=select-value]]:text-[15px]'
);

function FieldShell({
  variant,
  htmlFor,
  label,
  counter,
  description,
  error,
  children,
  className,
}: {
  variant: ServiceFieldVariant;
  htmlFor: string;
  /** The declared label, e.g. `Price (optional)`. Rendered verbatim. */
  label: string;
  counter?: string;
  description?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  const isMobile = variant === 'mobile';
  // The declaration owns the whole label; the "(optional)" tail is only styled
  // differently, never added or removed here.
  const isOptional = label.endsWith(OPTIONAL_LABEL_SUFFIX);
  const baseLabel = isOptional
    ? label.slice(0, -OPTIONAL_LABEL_SUFFIX.length)
    : label;

  return (
    <Field className={className} data-invalid={error ? true : undefined}>
      <div className="flex items-center justify-between">
        <FieldLabel
          htmlFor={htmlFor}
          className={cn(
            isMobile
              ? 'text-[13px] font-medium text-[#8E8E93]'
              : 'text-muted-foreground font-normal'
          )}
        >
          {baseLabel}{' '}
          {isOptional ? (
            <span className="text-muted-foreground/70">(optional)</span>
          ) : null}
        </FieldLabel>
        {counter ? (
          <span className="text-muted-foreground text-xs">{counter}</span>
        ) : null}
      </div>
      {children}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </Field>
  );
}

export function ServiceNameField({
  value,
  onChange,
  variant = 'desktop',
  error,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  variant?: ServiceFieldVariant;
  error?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const isMobile = variant === 'mobile';

  return (
    <FieldShell variant={variant} htmlFor={id} label={L.name} error={error}>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Dermafiller"
        autoFocus={autoFocus}
        className={isMobile ? MOBILE_SERVICE_INPUT_CLASS : undefined}
      />
    </FieldShell>
  );
}

export function ServiceCategoryField({
  value,
  onChange,
  categories,
  variant = 'desktop',
}: {
  value: string;
  onChange: (value: string) => void;
  categories: OrganizationServiceCategory[];
  variant?: ServiceFieldVariant;
}) {
  const id = useId();
  const isMobile = variant === 'mobile';

  return (
    <FieldShell variant={variant} htmlFor={id} label={L.categoryId}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          className={cn('w-full', isMobile && MOBILE_SELECT_TRIGGER_CLASS)}
        >
          <SelectValue placeholder="Select a category" />
        </SelectTrigger>
        <SelectContent>
          {categories.length === 0 ? (
            <div className="text-muted-foreground px-2 py-1.5 text-sm">
              No categories yet
            </div>
          ) : (
            categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                <span className="flex items-center gap-2">
                  <span className="bg-primary size-1.5 shrink-0 rounded-full" />
                  {category.name}
                </span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

export function ServiceDescriptionField({
  value,
  onChange,
  variant = 'desktop',
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  variant?: ServiceFieldVariant;
  error?: string;
}) {
  const id = useId();

  return (
    <FieldShell
      variant={variant}
      htmlFor={id}
      label={L.description}
      counter={`${value.length}/${SERVICE_DESCRIPTION_MAX}`}
      error={error}
    >
      <Textarea
        id={id}
        value={value}
        // Matches the API contract (`description: z.string().max(500)`).
        maxLength={SERVICE_DESCRIPTION_MAX}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
      />
    </FieldShell>
  );
}

export function ServiceDepositField({
  requiresDeposit,
  depositAmount,
  depositBasis,
  depositPercent,
  onRequiresDepositChange,
  onDepositAmountChange,
  onDepositBasisChange,
  onDepositPercentChange,
  variant = 'desktop',
  currencySymbol = '€',
  depositsAvailable = true,
}: {
  requiresDeposit: boolean;
  depositAmount: string;
  depositBasis: 'inherit' | 'fixed' | 'percent';
  depositPercent: string;
  onRequiresDepositChange: (value: boolean) => void;
  onDepositAmountChange: (value: string) => void;
  onDepositBasisChange: (value: 'inherit' | 'fixed' | 'percent') => void;
  onDepositPercentChange: (value: string) => void;
  variant?: ServiceFieldVariant;
  currencySymbol?: string;
  /**
   * Whether the org can actually collect a deposit — i.e. Stripe Connect is
   * connected and charges-enabled. When false, the toggle can't be switched ON
   * (a deposit with no way to charge it just silently books), but an already-on
   * (stale) deposit stays visible so it can be turned OFF.
   */
  depositsAvailable?: boolean;
}) {
  const switchId = useId();
  const amountId = useId();
  const basisId = useId();
  const percentId = useId();
  const isMobile = variant === 'mobile';
  // Allow toggling OFF a stale deposit even when Stripe is gone; only block
  // turning it ON when we can't collect.
  const canToggle = depositsAvailable || requiresDeposit;

  return (
    <div className="space-y-3">
      <Field
        orientation="horizontal"
        className={cn(
          'rounded-md border p-3',
          isMobile && 'rounded-lg border-[#E5E5E5]'
        )}
      >
        <div className="flex flex-col gap-0.5">
          <FieldLabel htmlFor={switchId} className="font-medium">
            {L.requiresDeposit}
          </FieldLabel>
          <FieldDescription>
            Customers pay a deposit to book. Shown to customers and used by your
            assistant when it quotes prices.
          </FieldDescription>
        </div>
        <Switch
          id={switchId}
          checked={requiresDeposit}
          disabled={!canToggle}
          onCheckedChange={(value) => {
            // Never let it be switched ON without a way to collect the deposit.
            if (value && !depositsAvailable) return;
            onRequiresDepositChange(value);
          }}
        />
      </Field>

      {!depositsAvailable && (
        <p className="px-1 text-sm text-muted-foreground">
          {requiresDeposit
            ? 'Stripe isn’t connected, so this deposit can’t be collected — bookings will go through without it. '
            : 'Connect Stripe to collect deposits. '}
          <a
            href="/dashboard/integrations"
            className="font-medium text-primary underline underline-offset-2"
          >
            Connect Stripe
          </a>
        </p>
      )}

      {requiresDeposit && depositsAvailable && (
        <FieldShell
          variant={variant}
          htmlFor={basisId}
          label={L.depositBasis}
          description="Follow the clinic default, or override it just for this service."
        >
          <Select
            value={depositBasis}
            onValueChange={(v) =>
              onDepositBasisChange(v as 'inherit' | 'fixed' | 'percent')
            }
          >
            <SelectTrigger
              id={basisId}
              className={cn('w-full', isMobile && MOBILE_SELECT_TRIGGER_CLASS)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Use clinic default</SelectItem>
              <SelectItem value="fixed">{depositBasisLabels.fixed}</SelectItem>
              <SelectItem value="percent">
                {depositBasisLabels.percent}
              </SelectItem>
            </SelectContent>
          </Select>
        </FieldShell>
      )}

      {requiresDeposit && depositsAvailable && depositBasis === 'percent' && (
        <FieldShell
          variant={variant}
          htmlFor={percentId}
          label={L.depositPercent}
          description="Share of this service's price, rounded up to the nearest 50c."
        >
          <InputGroup className={isMobile ? 'h-11 rounded-lg' : undefined}>
            <InputGroupInput
              id={percentId}
              type="number"
              inputMode="numeric"
              min="1"
              max="100"
              step="1"
              placeholder="20"
              value={depositPercent}
              onChange={(e) => onDepositPercentChange(e.target.value)}
            />
            <InputGroupAddon className="bg-muted text-foreground">
              %
            </InputGroupAddon>
          </InputGroup>
        </FieldShell>
      )}

      {requiresDeposit && depositsAvailable && depositBasis !== 'percent' && (
        <FieldShell
          variant={variant}
          htmlFor={amountId}
          label={L.depositAmount}
          description="Pre-filled from your last deposit — change it if this service differs."
        >
          <InputGroup className={isMobile ? 'h-11 rounded-lg' : undefined}>
            <InputGroupAddon className="bg-muted text-foreground">
              {currencySymbol}
            </InputGroupAddon>
            <InputGroupInput
              id={amountId}
              type="number"
              inputMode="decimal"
              min="1"
              step="0.01"
              placeholder="0.00"
              value={depositAmount}
              onChange={(e) => onDepositAmountChange(e.target.value)}
            />
          </InputGroup>
        </FieldShell>
      )}
    </div>
  );
}

export function ServiceDurationField({
  value,
  onChange,
  variant = 'desktop',
  error,
}: {
  value: number;
  onChange: (value: number) => void;
  variant?: ServiceFieldVariant;
  error?: string;
}) {
  const id = useId();
  const isMobile = variant === 'mobile';

  return (
    <FieldShell
      variant={variant}
      htmlFor={id}
      label={L.durationMinutes}
      description="Calendar slot length for this service."
      error={error}
    >
      {/* A select, not a bare number input: the API only accepts 5–480 min. */}
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger
          id={id}
          className={cn('w-full', isMobile && MOBILE_SELECT_TRIGGER_CLASS)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {durationOptions.map((option) => (
            <SelectItem key={option.value} value={String(option.value)}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

/** Callbacks the surface wires the variants editor to. */
export interface VariantEditorHandlers {
  variants: VariantDraft[];
  /**
   * The service's saved options could not be loaded, so `variants` is empty
   * for a reason that has nothing to do with the service. Adding a row here
   * would duplicate an option that already exists.
   */
  variantsError?: boolean;
  onAddVariant: () => void;
  onVariantChange: (index: number, patch: Partial<VariantDraft>) => void;
  onRemoveVariant: (index: number) => void;
  /** Move a row up (-1) or down (+1) — array order becomes the saved sortOrder. */
  onMoveVariant: (index: number, direction: -1 | 1) => void;
}

export function ServicePriceFields({
  priceType,
  priceAmount,
  onPriceTypeChange,
  onPriceAmountChange,
  variant = 'desktop',
  currencySymbol = '€',
  variantEditor,
}: {
  priceType: PriceType;
  priceAmount: string;
  onPriceTypeChange: (value: PriceType) => void;
  onPriceAmountChange: (value: string) => void;
  variant?: ServiceFieldVariant;
  /** The org's display currency symbol (from the primary location's country). */
  currencySymbol?: string;
  /** When provided, renders the collapsible pricing-options (variant) editor. */
  variantEditor?: VariantEditorHandlers;
}) {
  const typeId = useId();
  const amountId = useId();
  const isMobile = variant === 'mobile';

  const drafts = variantEditor?.variants ?? [];
  const hasVariants = drafts.length > 0;
  const floorCents = minVariantPriceCents(drafts);

  return (
    <div className="space-y-4">
      {hasVariants ? (
        // With ≥1 option the service price is the "from" floor (cheapest option),
        // computed — not typed. The per-option amounts live in the editor below.
        <FieldShell variant={variant} htmlFor={amountId} label={L.priceType}>
          <div
            id={amountId}
            className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
          >
            {floorCents != null ? (
              <>
                Priced{' '}
                <span className="font-semibold">
                  From {formatMoneyCents(floorCents, currencySymbol)}
                </span>{' '}
                — the cheapest pricing option below.
              </>
            ) : (
              'Add a price to at least one pricing option below.'
            )}
          </div>
        </FieldShell>
      ) : (
        <div
          className={cn('grid gap-4', isMobile ? 'grid-cols-1' : 'grid-cols-2')}
        >
          <FieldShell variant={variant} htmlFor={typeId} label={L.priceType}>
            <Select
              value={priceType}
              onValueChange={(v) => onPriceTypeChange(v as PriceType)}
            >
              <SelectTrigger
                id={typeId}
                className={cn(
                  'w-full',
                  isMobile && MOBILE_SELECT_TRIGGER_CLASS
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {servicePriceTypeValues.map((value) => (
                  <SelectItem key={value} value={value}>
                    {servicePriceTypeLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>

          {priceTypeHasAmount(priceType) && (
            <FieldShell
              variant={variant}
              htmlFor={amountId}
              label={L.priceAmount}
            >
              <InputGroup className={isMobile ? 'h-11 rounded-lg' : undefined}>
                <InputGroupAddon className="bg-muted text-foreground">
                  {currencySymbol}
                </InputGroupAddon>
                <InputGroupInput
                  id={amountId}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={priceAmount}
                  onChange={(e) => onPriceAmountChange(e.target.value)}
                />
              </InputGroup>
            </FieldShell>
          )}
        </div>
      )}

      {variantEditor && (
        <VariantsEditor
          {...variantEditor}
          currencySymbol={currencySymbol}
          variant={variant}
        />
      )}
    </div>
  );
}

export function ServiceTaxCodeField({
  value,
  onChange,
  variant = 'desktop',
}: {
  value: string;
  onChange: (value: string) => void;
  variant?: ServiceFieldVariant;
}) {
  const id = useId();

  return (
    <FieldShell
      variant={variant}
      htmlFor={id}
      label={L.taxCode}
      description="Use the clinic default unless this service needs its own Stripe classification."
    >
      <TaxCodePicker
        id={id}
        onChange={(taxCode) => onChange(taxCode ?? '')}
        value={value || null}
      />
    </FieldShell>
  );
}

/**
 * The optional per-service pricing options ("1 Area", "3 sessions", "60 min").
 * Collapsed by default when a single-price service; expanded once options exist.
 * Persisted through the variant CRUD hooks — see `use-service-form`.
 */
function VariantsEditor({
  variants,
  variantsError,
  onAddVariant,
  onVariantChange,
  onRemoveVariant,
  onMoveVariant,
  currencySymbol,
  variant,
}: VariantEditorHandlers & {
  currencySymbol: string;
  variant: ServiceFieldVariant;
}) {
  const [open, setOpen] = useState(variants.length > 0);
  const isMobile = variant === 'mobile';

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <div>
          <p className="font-medium text-sm">Pricing options</p>
          <p className="text-muted-foreground text-xs">
            Add options like "1 Area" or "3 sessions", each with its own price.
          </p>
        </div>
        <ChevronDownIcon
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && variantsError && (
        <div className="border-t p-3">
          <p className="text-destructive text-sm">
            Couldn&apos;t load this service&apos;s pricing options. Close and
            reopen to try again — adding options now would duplicate the ones
            already saved.
          </p>
        </div>
      )}

      {open && !variantsError && (
        <div className="space-y-3 border-t p-3">
          {variants.map((draft, index) => (
            <VariantRow
              key={draft.key}
              draft={draft}
              currencySymbol={currencySymbol}
              isMobile={isMobile}
              canMoveUp={index > 0}
              canMoveDown={index < variants.length - 1}
              onMove={(dir) => onMoveVariant(index, dir)}
              onChange={(patch) => onVariantChange(index, patch)}
              onRemove={() => onRemoveVariant(index)}
            />
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddVariant}
          >
            <PlusIcon className="size-4" />
            Add pricing option
          </Button>
        </div>
      )}
    </div>
  );
}

function VariantRow({
  draft,
  currencySymbol,
  isMobile,
  canMoveUp,
  canMoveDown,
  onMove,
  onChange,
  onRemove,
}: {
  draft: VariantDraft;
  currencySymbol: string;
  isMobile: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onChange: (patch: Partial<VariantDraft>) => void;
  onRemove: () => void;
}) {
  const nameId = useId();
  const priceId = useId();
  const durationId = useId();

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground"
          aria-label={`Move ${draft.name || 'option'} up`}
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
        >
          <ChevronUpIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground"
          aria-label={`Move ${draft.name || 'option'} down`}
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
        >
          <ChevronDownIcon className="size-4" />
        </Button>
      </div>

      <Field className="flex-1">
        <FieldLabel htmlFor={nameId} className="text-muted-foreground text-xs">
          Option name
        </FieldLabel>
        <Input
          id={nameId}
          value={draft.name}
          placeholder="e.g. 1 Area"
          onChange={(e) => onChange({ name: e.target.value })}
          className={isMobile ? MOBILE_SERVICE_INPUT_CLASS : undefined}
        />
      </Field>

      <Field className="w-28">
        <FieldLabel htmlFor={priceId} className="text-muted-foreground text-xs">
          Price
        </FieldLabel>
        <InputGroup className={isMobile ? 'h-11 rounded-lg' : undefined}>
          <InputGroupAddon className="bg-muted text-foreground">
            {currencySymbol}
          </InputGroupAddon>
          <InputGroupInput
            id={priceId}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={draft.priceAmount}
            onChange={(e) => onChange({ priceAmount: e.target.value })}
          />
        </InputGroup>
      </Field>

      <Field className="w-24">
        <FieldLabel
          htmlFor={durationId}
          className="text-muted-foreground text-xs"
        >
          Mins
        </FieldLabel>
        <Input
          id={durationId}
          type="number"
          inputMode="numeric"
          min="5"
          max="480"
          placeholder="—"
          value={draft.durationMinutes ?? ''}
          onChange={(e) =>
            onChange({
              durationMinutes: e.target.value ? Number(e.target.value) : null,
            })
          }
          className={isMobile ? MOBILE_SERVICE_INPUT_CLASS : undefined}
        />
      </Field>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove ${draft.name || 'option'}`}
        onClick={onRemove}
        className="text-muted-foreground"
      >
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  );
}

function PractitionerRow({
  practitioner,
  selected,
  onToggle,
  idPrefix,
}: {
  practitioner: PractitionerWithRelations;
  selected: boolean;
  onToggle: () => void;
  idPrefix: string;
}) {
  const initials = practitioner.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const checkboxId = `${idPrefix}-practitioner-${practitioner.id}`;

  return (
    <label htmlFor={checkboxId} className="flex items-center gap-3 py-1.5">
      <Checkbox id={checkboxId} checked={selected} onCheckedChange={onToggle} />
      <Avatar className="size-10">
        {practitioner.photo && (
          <AvatarImage src={practitioner.photo} alt={practitioner.name} />
        )}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <span className="text-sm">{practitioner.name}</span>
    </label>
  );
}

/**
 * Team-member assignment. A service with zero practitioners is not bookable,
 * so this belongs on EVERY surface that can create a service.
 */
export function ServiceTeamMembersField({
  practitioners,
  selectedIds,
  onToggle,
  onToggleAll,
  allSelected,
  idPrefix = 'service',
}: {
  practitioners: PractitionerWithRelations[];
  selectedIds: string[];
  onToggle: (practitionerId: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  idPrefix?: string;
}) {
  const selectAllId = `${idPrefix}-select-all-practitioners`;

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={selectAllId} className="flex items-center gap-3 py-1.5">
        <Checkbox
          id={selectAllId}
          checked={allSelected}
          onCheckedChange={() => onToggleAll()}
          disabled={practitioners.length === 0}
        />
        <span className="text-sm font-semibold">{L.practitionerIds}</span>
      </label>
      {practitioners.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No team members yet. You can assign them later.
        </p>
      ) : (
        practitioners.map((practitioner) => (
          <PractitionerRow
            key={practitioner.id}
            practitioner={practitioner}
            selected={selectedIds.includes(practitioner.id)}
            onToggle={() => onToggle(practitioner.id)}
            idPrefix={idPrefix}
          />
        ))
      )}
    </div>
  );
}

export type { ServiceFormErrors };
