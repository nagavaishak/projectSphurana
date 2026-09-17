/**
 * The stock-order line-item and fee editors.
 *
 * Lifted UNCHANGED out of the old `StockOrderCreateDialog` (markup, aria labels
 * and all) so the shared editor can render them through `kind: 'custom'`. The
 * rows they produce are the same `itemRows` / `feeRows` the payload builder
 * already parses — percent fees are still typed as a percentage and converted
 * to basis points there, not here.
 */

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
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
import type { StockOrderFeeType } from '@borradh-workspace/api-client/types';
import { Plus, Trash2 } from 'lucide-react';
import type { InlineCreateOption } from './inline-create-select';
import { InlineCreateSelect } from './inline-create-select';

export interface StockOrderItemRow {
  /** `''` — not `null` — while no product is picked: the builder drops falsy ids. */
  productId: string;
  quantity: string;
  costRaw: string;
}

export interface StockOrderFeeRow {
  name: string;
  type: StockOrderFeeType;
  valueRaw: string;
}

export const blankStockOrderItem: StockOrderItemRow = {
  productId: '',
  quantity: '1',
  costRaw: '',
};

export const blankStockOrderFee: StockOrderFeeRow = {
  name: '',
  type: 'currency',
  valueRaw: '',
};

export function StockOrderItemsField({
  items,
  products,
  currencySymbol,
  onChange,
  disabled,
}: {
  items: StockOrderItemRow[];
  products: InlineCreateOption[];
  currencySymbol: string;
  onChange: (items: StockOrderItemRow[]) => void;
  disabled?: boolean;
}) {
  const setItem = (index: number, patch: Partial<StockOrderItemRow>) =>
    onChange(items.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Field>
      <FieldLabel>Products</FieldLabel>
      <div className="flex flex-col gap-2">
        {items.map((row, index) => (
          <div className="flex items-end gap-2" key={index}>
            <div className="flex-1">
              <InlineCreateSelect
                disabled={disabled}
                emptyLabel="No products found."
                onChange={(id) => setItem(index, { productId: id ?? '' })}
                options={products}
                placeholder="Select product"
                searchPlaceholder="Search products…"
                value={row.productId || null}
              />
            </div>
            <Input
              aria-label="Quantity"
              className="w-20"
              disabled={disabled}
              min={1}
              onChange={(e) => setItem(index, { quantity: e.target.value })}
              type="number"
              value={row.quantity}
            />
            <InputGroup className="w-28">
              <InputGroupAddon>{currencySymbol}</InputGroupAddon>
              <InputGroupInput
                aria-label="Unit cost"
                disabled={disabled}
                inputMode="decimal"
                onChange={(e) => setItem(index, { costRaw: e.target.value })}
                placeholder="Cost"
                value={row.costRaw}
              />
            </InputGroup>
            <Button
              aria-label="Remove line"
              disabled={disabled || items.length === 1}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        className="mt-2 self-start"
        disabled={disabled}
        onClick={() => onChange([...items, { ...blankStockOrderItem }])}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus className="size-4" />
        Add product
      </Button>
    </Field>
  );
}

export function StockOrderFeesField({
  fees,
  currencySymbol,
  onChange,
  disabled,
}: {
  fees: StockOrderFeeRow[];
  currencySymbol: string;
  onChange: (fees: StockOrderFeeRow[]) => void;
  disabled?: boolean;
}) {
  const setFee = (index: number, patch: Partial<StockOrderFeeRow>) =>
    onChange(fees.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Field>
      <FieldLabel>Fees</FieldLabel>
      <div className="flex flex-col gap-2">
        {fees.map((fee, index) => (
          <div className="flex items-end gap-2" key={index}>
            <Input
              aria-label="Fee name"
              className="flex-1"
              disabled={disabled}
              onChange={(e) => setFee(index, { name: e.target.value })}
              placeholder="e.g. Shipping"
              value={fee.name}
            />
            <Select
              disabled={disabled}
              onValueChange={(v) =>
                setFee(index, { type: v as StockOrderFeeType })
              }
              value={fee.type}
            >
              <SelectTrigger aria-label="Fee type" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="currency">Fixed amount</SelectItem>
                <SelectItem value="percent">Percentage</SelectItem>
              </SelectContent>
            </Select>
            <InputGroup className="w-28">
              {fee.type === 'currency' && (
                <InputGroupAddon>{currencySymbol}</InputGroupAddon>
              )}
              <InputGroupInput
                aria-label="Fee value"
                disabled={disabled}
                inputMode="decimal"
                onChange={(e) => setFee(index, { valueRaw: e.target.value })}
                placeholder={fee.type === 'percent' ? '0' : '0.00'}
                value={fee.valueRaw}
              />
              {fee.type === 'percent' && (
                <InputGroupAddon align="inline-end">%</InputGroupAddon>
              )}
            </InputGroup>
            <Button
              aria-label="Remove fee"
              disabled={disabled}
              onClick={() => onChange(fees.filter((_, i) => i !== index))}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        className="mt-2 self-start"
        disabled={disabled}
        onClick={() => onChange([...fees, { ...blankStockOrderFee }])}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus className="size-4" />
        Add fee
      </Button>
    </Field>
  );
}
