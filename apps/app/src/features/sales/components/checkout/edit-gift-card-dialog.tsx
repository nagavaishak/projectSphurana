import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AddSaleItemInput } from '@borradh-workspace/api-client/types';
import {
  type GiftCardExpiry,
  giftCardExpiryLabels,
  giftCardExpiryValues,
} from '@borradh-workspace/api-client/types';
import { Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { currencySymbol, formatMoney, toCents } from '../../lib/money';

interface TeamMemberOption {
  id: string;
  name: string;
}

interface EditGiftCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  /** Face value chosen on the selection grid; empty for a custom amount. */
  initialValue: number | null;
  teamMembers: TeamMemberOption[];
  defaultTeamMemberId?: string;
  onConfirm: (input: AddSaleItemInput) => void;
}

/**
 * Fresha-style "Edit gift card" form. The card's FACE VALUE and the PRICE the
 * client pays are separate — a lower price is a manual discount. The face value
 * is what the card is issued with at completion; the price is what the sale
 * charges.
 */
export function EditGiftCardDialog({
  open,
  onOpenChange,
  currency,
  initialValue,
  teamMembers,
  defaultTeamMemberId,
  onConfirm,
}: EditGiftCardDialogProps) {
  const symbol = currencySymbol(currency);
  const [value, setValue] = useState('');
  const [price, setPrice] = useState('');
  const [expiry, setExpiry] = useState<GiftCardExpiry>('1y');
  const [customCode, setCustomCode] = useState(false);
  const [isGift, setIsGift] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);
  const [teamMemberId, setTeamMemberId] = useState(defaultTeamMemberId ?? '');

  // Re-seed the form each time it opens for a fresh preset.
  useEffect(() => {
    if (!open) return;
    const seed = initialValue != null ? String(initialValue) : '';
    setValue(seed);
    setPrice(seed);
    setExpiry('1y');
    setCustomCode(false);
    setIsGift(true);
    setSendEmail(true);
    setTeamMemberId(defaultTeamMemberId ?? '');
  }, [open, initialValue, defaultTeamMemberId]);

  const valueNum = Number.parseFloat(value);
  const priceNum = Number.parseFloat(price);
  const hasValue = !Number.isNaN(valueNum) && valueNum > 0;
  const hasPrice = !Number.isNaN(priceNum) && priceNum >= 0;
  const faceCents = hasValue ? toCents(valueNum) : 0;
  const priceCents = hasPrice ? toCents(priceNum) : faceCents;
  const discountCents = Math.max(faceCents - priceCents, 0);
  const canApply = hasValue && hasPrice && priceCents <= faceCents;

  const apply = () => {
    if (!canApply) return;
    onConfirm({
      itemType: 'gift_card',
      name: 'Gift card',
      quantity: 1,
      unitPriceCents: priceCents,
      giftCardFaceValueCents: faceCents,
      giftCardExpiry: expiry,
      ...(teamMemberId ? { practitionerId: teamMemberId } : {}),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit gift card</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="gc-value">Gift card value</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                {symbol}
              </span>
              <Input
                id="gc-value"
                type="number"
                min={0}
                step={0.01}
                className="pl-7"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  // Keep price in lock-step until the operator discounts it.
                  if (discountCents === 0) setPrice(e.target.value);
                }}
              />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="gc-price">Price</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                {symbol}
              </span>
              <Input
                id="gc-price"
                type="number"
                min={0}
                step={0.01}
                className="pl-7"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            {discountCents > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatMoney(discountCents, currency)} manual discount applied.{' '}
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setPrice(value)}
                >
                  Reset
                </button>
              </p>
            )}
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="gc-discount">Discounts</FieldLabel>
          <Select disabled value="">
            <SelectTrigger id="gc-discount">
              <SelectValue placeholder="None available" />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="gc-expiry">Expiration</FieldLabel>
          <Select
            value={expiry}
            onValueChange={(v) => setExpiry(v as GiftCardExpiry)}
          >
            <SelectTrigger id="gc-expiry">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {giftCardExpiryValues.map((v) => (
                <SelectItem key={v} value={v}>
                  {giftCardExpiryLabels[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="flex flex-col gap-3">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox (renders a button, not a native input) */}
          <label className="flex cursor-pointer items-center gap-3">
            <Checkbox
              checked={customCode}
              onCheckedChange={(v) => setCustomCode(v === true)}
            />
            <span className="text-sm">Use a custom gift card code</span>
          </label>

          {/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox (renders a button, not a native input) */}
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={isGift}
              onCheckedChange={(v) => setIsGift(v === true)}
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">This is a gift</span>
              <span className="text-xs text-muted-foreground">
                Gift card will not be added to the purchasing client's wallet so
                it can be shared
              </span>
            </span>
          </label>

          {/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox (renders a button, not a native input) */}
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={sendEmail}
              onCheckedChange={(v) => setSendEmail(v === true)}
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">
                Send purchase confirmation email
              </span>
              <span className="text-xs text-muted-foreground">
                We'll send an email to the purchasing client with their gift
                card code and information on how to redeem it
              </span>
            </span>
          </label>
        </div>

        {teamMembers.length > 0 && (
          <Field>
            <FieldLabel htmlFor="gc-team-member">Team member</FieldLabel>
            <Select value={teamMemberId} onValueChange={setTeamMemberId}>
              <SelectTrigger id="gc-team-member">
                <SelectValue placeholder="Select team member" />
              </SelectTrigger>
              <SelectContent>
                {teamMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <div className="flex items-end justify-between border-t pt-4">
          <div>
            <p className="text-xs text-muted-foreground">Item total</p>
            <p className="text-lg font-semibold">
              {formatMoney(priceCents, currency)}
              {discountCents > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground line-through">
                  {formatMoney(faceCents, currency)}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => onOpenChange(false)}
              aria-label="Discard gift card"
            >
              <Trash2Icon className="size-4" />
            </Button>
            <Button type="button" disabled={!canApply} onClick={apply}>
              Apply
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
