/**
 * Create / edit dialog for promotions (the customer-facing name) — backed
 * by the `offer` table.
 *
 * NOTE ON SCOPE: the promotions LIST no longer opens this. Create and edit from
 * `/dashboard/catalog/offers` go to the unified editor (`/create/promotion`,
 * `/edit/promotion/:id`). This dialog survives for the ONE surface that still
 * needs a modal — the create-video wizard's offer step, where the operator adds
 * a promotion without leaving the wizard. Both surfaces share the same
 * controller (`useOfferForm`) and the same field components
 * (`../offer-form/offer-form-fields`), so they cannot drift.
 *
 * Layout follows the Figma "Add Promotion" design:
 *   - Promotion details (name + code + description)
 *   - Discount (radio + amount + max redemptions)
 *   - Services tag-picker (chips + searchable popover)
 *   - Expiry rows (Start Date / End Date)
 *
 * There is no state or location control on either surface: a promotion is
 * always created ACTIVE, and its branches come from the branches its services
 * are offered at.
 *
 * The schema kept the legacy `fixed_price` and `buy_x_get_y` discount types
 * so existing offers keep working. New offers only pick from `percentage`
 * and `fixed_amount`; when editing a legacy offer we render its existing
 * fields so the operator can save it back unchanged.
 *
 * data-claire-target keys (tour hooks):
 *   - offer-dialog
 *   - offer-name-input
 *   - offer-code-input, offer-code-generate-button
 *   - offer-discount-type-radio
 *   - offer-discount-amount-input, offer-discount-percent-input
 *   - offer-original-price-input, offer-offer-price-input
 *   - offer-buy-quantity-input, offer-get-quantity-input
 *   - offer-redemption-limit-input
 *   - offer-valid-from-input, offer-valid-until-input
 *   - offer-services-picker
 *   - offer-save-button, offer-cancel-button
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldLabel } from '@/components/ui/field';
import type { OrganizationService } from '@/features/organization-services';
import type { Offer } from '@borradh-workspace/api-client/types';
import { Loader2 } from 'lucide-react';

import {
  OfferCodeField,
  OfferDescriptionField,
  OfferDiscountTypeField,
  OfferDiscountValueFields,
  OfferExpiryFields,
  OfferNameField,
  OfferRedemptionLimitField,
  OfferServicesField,
} from '../offer-form/offer-form-fields';
import { useOfferForm } from '../offer-form/use-offer-form';

export interface OfferFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, dialog is in edit mode. */
  offer?: (Offer & { serviceIds: string[]; locationIds?: string[] }) | null;
  /** When set, the picker is shown and the user chooses which services to link. */
  services?: OrganizationService[];
  /** When set, the picker is hidden and these IDs are used verbatim. */
  lockedServiceIds?: string[];
  /** Pre-check these services when opening for create (only used with `services`). */
  defaultServiceIds?: string[];
  /**
   * Branches to scope a NEW promotion to. There is no picker any more — the
   * branches a promotion runs at are derived from the branches its services
   * are offered at (see `offer-services-picker.tsx`), and this dialog links
   * services without asking about branches. Empty = all locations.
   */
  defaultLocationIds?: string[];
  /** Optional callback after successful create/update. */
  onOfferSaved?: (
    offer: Offer & { serviceIds: string[]; locationIds: string[] }
  ) => void;
  /** Forwarded to DialogContent — use to prevent outside-click close during tours. */
  onInteractOutside?: (e: Event) => void;
}

export function OfferFormDialog({
  open,
  onOpenChange,
  offer,
  services,
  lockedServiceIds,
  defaultServiceIds,
  defaultLocationIds,
  onOfferSaved,
  onInteractOutside,
}: OfferFormDialogProps) {
  const showServicePicker = !!services && !lockedServiceIds;

  const {
    form,
    isEdit,
    isSubmitting,
    selectedDiscountType,
    visibleDiscountTypes,
    submit,
  } = useOfferForm({
    defaultLocationIds,
    defaultServiceIds,
    hasServicePicker: showServicePicker,
    lockedServiceIds,
    offer,
    onDone: () => onOpenChange(false),
    onSaved: onOfferSaved,
    open,
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[90vh] gap-0 overflow-y-auto p-8 sm:max-w-[560px]"
        data-claire-target="offer-dialog"
        onInteractOutside={onInteractOutside}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold">
            {isEdit ? 'Edit Promotion' : 'Add Promotion'}
          </DialogTitle>
        </DialogHeader>

        <form className="mt-4 space-y-4" onSubmit={submit}>
          {/* Promotion details */}
          <div className="space-y-3">
            <OfferNameField autoFocus={!isEdit} control={form.control} />
            <OfferCodeField control={form.control} />
            <OfferDescriptionField control={form.control} />
          </div>

          {/* Discount */}
          <div className="space-y-3">
            <OfferDiscountTypeField
              form={form}
              visibleDiscountTypes={visibleDiscountTypes}
            />

            {/* Per-type discount inputs */}
            <div className="flex flex-col gap-3">
              <OfferDiscountValueFields
                control={form.control}
                selectedDiscountType={selectedDiscountType}
              />
              <OfferRedemptionLimitField control={form.control} />
            </div>
          </div>

          {/* Services */}
          {showServicePicker && services && (
            <OfferServicesField control={form.control} services={services} />
          )}

          {/* Expiry */}
          <div className="space-y-3">
            <FieldLabel className="text-base font-medium">
              Expiry{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </FieldLabel>
            <OfferExpiryFields control={form.control} />
          </div>

          <DialogFooter className="mt-2">
            <DialogClose asChild>
              <Button
                data-claire-target="offer-cancel-button"
                disabled={isSubmitting}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              className="bg-[#1877f2] hover:bg-[#166fde]"
              data-claire-target="offer-save-button"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : isEdit ? (
                'Save Changes'
              ) : (
                'Add Promotion'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
