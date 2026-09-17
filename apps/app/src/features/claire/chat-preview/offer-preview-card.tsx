'use client';

import { format, parse } from 'date-fns';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { offerDraftLabels } from '@/features/offers/api';

import { trackRecommendationEdited } from '../telemetry';
import { usePublishOffer } from './use-publish-offer';
import { useSaveOfferDraft } from './use-save-offer-draft';
import { useUpdatePendingOffer } from './use-update-pending-offer';

export interface OfferPreviewCardState {
  draftId: string;
  name: string;
  code: string | null;
  state: 'draft' | 'active' | 'paused' | 'expired';
  validFrom: string | null;
  validUntil: string | null;
  discountType: 'percentage' | 'fixed_price' | 'buy_x_get_y';
  discountPercent: number | null;
  originalPriceCents: number | null;
  offerPriceCents: number | null;
  buyQuantity: number | null;
  getQuantity: number | null;
  limitPerClient: boolean;
  redemptionLimit: number | null;
  serviceIds: string[];
  locationIds: string[];
}

interface OfferPreviewCardProps {
  draft: OfferPreviewCardState;
}

/**
 * Labels come from the shared offer-draft declaration, not from literals here —
 * the form contract locates each control by the same string.
 */
const L = offerDraftLabels;

/**
 * The card holds the validity as a `yyyy-MM-dd` day and renders it with date-fns
 * `parse` — i.e. as a LOCAL day. Both conversions below must agree with that, and
 * with the offer-form-dialog, which stores a local-midnight `Date` and lets the
 * shared builder ISO it. Slicing the ISO string / parsing it as UTC instead (as
 * this did) made the two writers of `PUT offers/:id` send different instants for
 * the same picked day, and made the card's own read-back off by a day east of
 * UTC. The form contract compares them; they now encode the day identically.
 */
function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return format(new Date(iso), 'yyyy-MM-dd');
}

function fromDateInputValue(value: string): string | null {
  if (value === '') return null;
  return parse(value, 'yyyy-MM-dd', new Date()).toISOString();
}

function centsToEuros(cents: number | null): number {
  return cents == null ? 0 : cents / 100;
}

/**
 * Window 7 — minimal preview card for chat-owned draft offers.
 * Editable fields are scoped per Decision #14: name, validity, and
 * the discount-shape-specific numeric input. Code, locations, and
 * redemption rules are read-only summaries — owners adjust those by
 * asking Claire (per Decision #14, no inline editor for them in v1).
 */
export function OfferPreviewCard({ draft }: OfferPreviewCardProps) {
  const [name, setName] = useState(draft.name);
  const [validUntil, setValidUntil] = useState(
    toDateInputValue(draft.validUntil)
  );
  const [offerPriceCents, setOfferPriceCents] = useState(draft.offerPriceCents);
  const [discountPercent, setDiscountPercent] = useState(draft.discountPercent);
  const [published, setPublished] = useState(false);

  const initialNameRef = useRef(draft.name);
  const initialValidUntilRef = useRef(toDateInputValue(draft.validUntil));
  const initialOfferPriceRef = useRef(draft.offerPriceCents);
  const initialDiscountPercentRef = useRef(draft.discountPercent);

  const updatePending = useUpdatePendingOffer(
    draft.draftId,
    draft.discountType
  );
  const saveDraft = useSaveOfferDraft(draft.draftId, draft.discountType);
  const publishOffer = usePublishOffer(draft.draftId, draft.discountType, {
    onSuccess: () => setPublished(true),
  });

  const isBusy = saveDraft.isPending || publishOffer.isPending;

  // Pass the card's full editable state as intent; the shared builder gates
  // the discount value by `discountType` (percentage → discountPercent,
  // fixed_price → offerPriceCents) and drops the rest.
  const finalEdits = () => ({
    name,
    validUntil: fromDateInputValue(validUntil),
    discountPercent,
    offerPriceCents,
  });

  const emitEditedIfDirty = () => {
    const editedFields: string[] = [];
    if (name !== initialNameRef.current) editedFields.push('name');
    if (validUntil !== initialValidUntilRef.current)
      editedFields.push('validUntil');
    if (
      draft.discountType === 'fixed_price' &&
      offerPriceCents !== initialOfferPriceRef.current
    )
      editedFields.push('offerPriceCents');
    if (
      draft.discountType === 'percentage' &&
      discountPercent !== initialDiscountPercentRef.current
    )
      editedFields.push('discountPercent');
    if (editedFields.length === 0) return;
    trackRecommendationEdited({
      surface: 'chat',
      kind: 'ad_flow_offer_pick',
      rankedServiceId: draft.draftId,
      rank: 1,
      acceptedAtRank: 1,
      editedFields,
    });
  };

  return (
    <Card data-testid="offer-preview-card" className="max-w-md my-3 bg-card">
      <CardContent className="p-4 space-y-4">
        <Field>
          <FieldLabel htmlFor={`offer-preview-name-${draft.draftId}`}>
            {L.name}
          </FieldLabel>
          <Input
            id={`offer-preview-name-${draft.draftId}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => updatePending.mutate({ name })}
            disabled={published}
            aria-invalid={false}
          />
        </Field>

        <div className="text-sm text-muted-foreground space-y-1">
          {draft.code && (
            <p>
              Code: <code className="font-mono">{draft.code}</code>
            </p>
          )}
          <p>
            Locations:{' '}
            {draft.locationIds.length === 0
              ? 'all'
              : `${draft.locationIds.length} selected`}
          </p>
          <p>Services: {draft.serviceIds.length} selected</p>
        </div>

        {draft.discountType === 'fixed_price' && (
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor={`offer-preview-original-${draft.draftId}`}>
                Regular price (€)
              </FieldLabel>
              <Input
                id={`offer-preview-original-${draft.draftId}`}
                type="number"
                value={centsToEuros(draft.originalPriceCents)}
                disabled
                aria-invalid={false}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`offer-preview-price-${draft.draftId}`}>
                {L.offerPriceEuros}
              </FieldLabel>
              <Input
                id={`offer-preview-price-${draft.draftId}`}
                type="number"
                min={0}
                value={centsToEuros(offerPriceCents)}
                onChange={(e) =>
                  setOfferPriceCents(Math.round(Number(e.target.value) * 100))
                }
                onBlur={() => updatePending.mutate({ offerPriceCents })}
                disabled={published}
                aria-invalid={false}
              />
            </Field>
          </div>
        )}

        {draft.discountType === 'percentage' && (
          <Field>
            <FieldLabel htmlFor={`offer-preview-percent-${draft.draftId}`}>
              {L.discountPercent}
            </FieldLabel>
            <Input
              id={`offer-preview-percent-${draft.draftId}`}
              type="number"
              min={1}
              max={100}
              value={discountPercent ?? 0}
              onChange={(e) => setDiscountPercent(Number(e.target.value))}
              onBlur={() => updatePending.mutate({ discountPercent })}
              disabled={published}
              aria-invalid={false}
            />
          </Field>
        )}

        {draft.discountType === 'buy_x_get_y' && (
          <p className="text-sm">
            Buy {draft.buyQuantity ?? '?'}, get {draft.getQuantity ?? '?'}
          </p>
        )}

        <Field>
          <FieldLabel htmlFor={`offer-preview-validity-${draft.draftId}`}>
            {L.validUntil}
          </FieldLabel>
          <DatePicker
            id={`offer-preview-validity-${draft.draftId}`}
            placeholder="Select date"
            value={
              validUntil
                ? parse(validUntil, 'yyyy-MM-dd', new Date())
                : undefined
            }
            onChange={(date) => {
              const next = date ? format(date, 'yyyy-MM-dd') : '';
              setValidUntil(next);
              updatePending.mutate({
                validUntil: fromDateInputValue(next),
              });
            }}
            disabled={published}
            aria-invalid={false}
          />
        </Field>

        <p className="text-xs text-muted-foreground">
          {draft.limitPerClient ? '1 per client' : 'No client limit'}
          {' · '}
          {draft.redemptionLimit
            ? `${draft.redemptionLimit} total`
            : 'No total cap'}
        </p>
      </CardContent>
      <CardFooter className="flex gap-2 justify-end p-4 pt-0">
        <Button
          variant="outline"
          onClick={() => {
            emitEditedIfDirty();
            saveDraft.mutate(finalEdits());
          }}
          disabled={isBusy || published}
        >
          {saveDraft.isPending ? 'Saving…' : 'Save draft'}
        </Button>
        <Button
          onClick={() => {
            emitEditedIfDirty();
            publishOffer.mutate(finalEdits());
          }}
          disabled={isBusy || published}
        >
          {published
            ? 'Published'
            : publishOffer.isPending
              ? 'Publishing…'
              : 'Publish'}
        </Button>
      </CardFooter>
    </Card>
  );
}
