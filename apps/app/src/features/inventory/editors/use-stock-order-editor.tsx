'use client';

import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { Truck } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import type {
  EntityFormConfig,
  EntityFormValues,
} from '@/components/app/entity-editor';
import { Field, FieldLabel } from '@/components/ui/field';
import { SingleDayPicker } from '@/components/ui/single-day-picker';
import type { EntityEditorState } from '@/features/entity-editors/registry';
import { useListLocations } from '@/features/organization-locations';
import { useOrgCurrency } from '@/hooks/use-org-currency';

import {
  createStockOrderForm,
  useCreateStockOrder,
  useCreateSupplier,
  useListProducts,
  useListSuppliers,
} from '../api';
import { InlineCreateSelect } from '../components/inline-create-select';
import {
  StockOrderFeesField,
  StockOrderItemsField,
} from '../components/stock-order-line-items';

/** Labels come from the form declaration — the contract locates by the same strings. */
const L = createStockOrderForm.labels;

/**
 * Stock-order create editor — CONFIG AND STATE ONLY, no layout.
 *
 * The line-item and fee editors are the components the dialog already used,
 * rendered through `kind: 'custom'` rather than rebuilt as generic fields; the
 * wire body is still assembled by `buildCreateStockOrderPayload` from the same
 * typed intent (item/fee parsing, cents vs basis points, null-coalescing), so
 * this surface cannot drift from what the dialog sent.
 */
export function useStockOrderEditor(): EntityEditorState {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { currency } = useOrgCurrency();
  const { locations } = useListLocations();
  const { products } = useListProducts({ limit: 100 });
  const { suppliers } = useListSuppliers();
  const { createSupplierAsync } = useCreateSupplier();
  const { createStockOrderAsync, isCreating } = useCreateStockOrder();

  // The form's VALUES ARE the payload builder's intent — same keys, same raw
  // shapes — so `onSave` hands this straight to the mutation.
  const [values, setValues] = useState(createStockOrderForm.defaults);

  const setValue = useCallback(
    (name: string, value: unknown) =>
      setValues((prev) => ({ ...prev, [name]: value })),
    []
  );

  const createSupplier = useCallback(
    async (name: string) => {
      try {
        const supplier = await createSupplierAsync({ name });
        return supplier.id;
      } catch {
        return null;
      }
    },
    [createSupplierAsync]
  );

  const productOptions = useMemo(
    () => products.map((p) => ({ id: p.id, name: p.name })),
    [products]
  );

  const config: EntityFormConfig = useMemo(
    () => ({
      title: () => 'New Stock Order',
      sections: [
        {
          id: 'details',
          label: 'Details',
          icon: Truck,
          blocks: [
            {
              title: 'Order Details',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'supplierId',
                    render: ({ disabled }) => (
                      <Field>
                        <FieldLabel htmlFor="stock-order-supplier">
                          {L.supplierId}
                        </FieldLabel>
                        <InlineCreateSelect
                          clearLabel="No supplier"
                          disabled={disabled}
                          emptyLabel="No suppliers yet."
                          id="stock-order-supplier"
                          onChange={(id) => setValue('supplierId', id)}
                          onCreate={createSupplier}
                          options={suppliers}
                          placeholder="Select supplier"
                          searchPlaceholder="Search or create supplier…"
                          value={values.supplierId}
                        />
                      </Field>
                    ),
                  },
                  {
                    kind: 'select',
                    name: 'locationId',
                    label: L.locationId,
                    placeholder: 'Select location',
                    options: locations.map((location) => ({
                      value: location.id,
                      label: location.name ?? 'Location',
                    })),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'expectedByDate',
                    render: () => (
                      <Field>
                        <FieldLabel htmlFor="stock-order-expected">
                          {L.expectedByDate}
                        </FieldLabel>
                        <SingleDayPicker
                          className="h-10 justify-between font-normal"
                          id="stock-order-expected"
                          labelVariant="PPP"
                          onSelect={(d) =>
                            setValue('expectedByDate', d ?? null)
                          }
                          placeholder="Pick a date"
                          value={values.expectedByDate ?? undefined}
                        />
                      </Field>
                    ),
                  },
                ],
              ],
            },
            {
              title: L.itemRows,
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'itemRows',
                    render: ({ disabled }) => (
                      <StockOrderItemsField
                        currencySymbol={currency.symbol}
                        disabled={disabled}
                        items={values.itemRows}
                        onChange={(itemRows) => setValue('itemRows', itemRows)}
                        products={productOptions}
                      />
                    ),
                  },
                ],
              ],
            },
            {
              title: L.feeRows,
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'feeRows',
                    render: ({ disabled }) => (
                      <StockOrderFeesField
                        currencySymbol={currency.symbol}
                        disabled={disabled}
                        fees={values.feeRows}
                        onChange={(feeRows) => setValue('feeRows', feeRows)}
                      />
                    ),
                  },
                ],
              ],
            },
            {
              title: L.notes,
              rows: [
                [
                  {
                    kind: 'textarea',
                    name: 'notes',
                    label: L.notes,
                    placeholder: 'Optional notes for this order',
                  },
                ],
              ],
            },
          ],
        },
      ],
    }),
    [
      values,
      locations,
      suppliers,
      productOptions,
      currency.symbol,
      createSupplier,
      setValue,
    ]
  );

  const onSave = useCallback(async () => {
    // Validation and the wire body both live in buildCreateStockOrderPayload;
    // the mutation's onError surfaces any message as a toast.
    try {
      await createStockOrderAsync(values);
      await navigate({ to: routes.inventoryStockOrders });
    } catch {
      // The hook already surfaces an error toast.
    }
  }, [values, createStockOrderAsync, navigate, routes.inventoryStockOrders]);

  return {
    config,
    values: values as unknown as EntityFormValues,
    setValue,
    isSaving: isCreating,
    onSave: () => void onSave(),
    onCancel: () => void navigate({ to: routes.inventoryStockOrders }),
  };
}
