'use client';

import type {
  Product,
  ProductMeasureUnit,
} from '@borradh-workspace/api-client/types';
import {
  productMeasureUnitLabels,
  productMeasureUnitValues,
} from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { Banknote, Barcode, ListTree, Package } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type {
  EntityFormConfig,
  EntityFormValues,
} from '@/components/app/entity-editor';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Switch } from '@/components/ui/switch';
import type { EntityEditorState } from '@/features/entity-editors/registry';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import { centsToMajorString, parseMajorToCents } from '@/lib/org-currency';
import { useResolvedRoutes } from '@/lib/use-routes';

import { TaxCodePicker } from '@/features/stripe-connect';
import {
  createProductForm,
  useCreateProduct,
  useCreateProductBrand,
  useCreateProductCategory,
  useCreateSupplier,
  useGetProduct,
  useListProductBrands,
  useListProductCategories,
  useListSuppliers,
  useUpdateProduct,
} from '../api';
import { InlineCreateSelect } from '../components/inline-create-select';
import { ProductPhotoAside } from '../components/product-photo-aside';
import { ProductSkuField } from '../components/product-sku-field';
import { ProductStockEditor } from '../components/product-stock-editor';

/** Labels come from the form declaration — the contract locates by the same strings. */
const L = createProductForm.labels;

/**
 * Product create/edit editor — CONFIG AND STATE ONLY, no layout.
 *
 * Every field, guard and derived value comes across from the old
 * `ProductFormDialog` unchanged: the same `FormState`, the same markup ⇄ retail
 * synchronisation (markup is presentational and never persisted), the same two
 * submit guards, and the same typed intent handed to
 * `useCreateProduct` / `useUpdateProduct` — so the body on the wire is
 * identical to what the dialog sent.
 *
 * What DID change is shape: the dialog's single scrolling column becomes four
 * tabs (Details, Pricing, Identifiers, Stock) plus the photo uploader in the
 * aside, which is what the design asks for and what a page has the room for.
 */
interface FormState {
  name: string;
  images: string[];
  barcode: string;
  brandId: string | null;
  measureUnit: ProductMeasureUnit;
  measureAmount: string;
  description: string;
  categoryId: string | null;
  supplyRaw: string;
  retailEnabled: boolean;
  isMedication: boolean;
  onlineEnabled: boolean;
  shippable: boolean;
  retailRaw: string;
  taxCode: string;
  markupRaw: string;
  teamMemberCommissionEnabled: boolean;
  skus: string[];
  supplierId: string | null;
  trackStock: boolean;
  lowStockLevel: string;
  reorderQuantity: string;
  lowStockNotify: boolean;
}

const blankForm: FormState = {
  name: '',
  images: [],
  barcode: '',
  brandId: null,
  measureUnit: 'whole',
  measureAmount: '',
  description: '',
  categoryId: null,
  supplyRaw: '',
  retailEnabled: false,
  isMedication: false,
  onlineEnabled: false,
  shippable: true,
  retailRaw: '',
  taxCode: '',
  markupRaw: '',
  teamMemberCommissionEnabled: false,
  skus: [],
  supplierId: null,
  trackStock: false,
  lowStockLevel: '',
  reorderQuantity: '',
  lowStockNotify: false,
};

function computeMarkup(supplyRaw: string, retailRaw: string): string {
  const supply = parseMajorToCents(supplyRaw);
  const retail = parseMajorToCents(retailRaw);
  if (supply == null || supply <= 0 || retail == null) return '';
  const pct = ((retail - supply) / supply) * 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

function formFromProduct(product: Product): FormState {
  const supplyRaw = centsToMajorString(product.supplyPriceCents);
  const retailRaw = centsToMajorString(product.retailPriceCents);
  return {
    name: product.name,
    images: product.images ?? [],
    barcode: product.barcode ?? '',
    brandId: product.brandId ?? null,
    measureUnit: product.measureUnit,
    measureAmount:
      product.measureAmount == null ? '' : String(product.measureAmount),
    description: product.description ?? '',
    categoryId: product.categoryId ?? null,
    supplyRaw,
    retailEnabled: product.retailEnabled,
    isMedication: product.isMedication,
    onlineEnabled: product.onlineEnabled,
    shippable: product.shippable,
    retailRaw,
    taxCode: product.taxCode ?? '',
    markupRaw: computeMarkup(supplyRaw, retailRaw),
    teamMemberCommissionEnabled: product.teamMemberCommissionEnabled,
    skus: product.skus ?? [],
    supplierId: product.supplierId ?? null,
    trackStock: product.trackStock,
    lowStockLevel:
      product.lowStockLevel == null ? '' : String(product.lowStockLevel),
    reorderQuantity:
      product.reorderQuantity == null ? '' : String(product.reorderQuantity),
    lowStockNotify: product.lowStockNotify,
  };
}

export function useProductEditor({
  product,
}: {
  /** Null → create mode. */
  product: Product | null;
}): EntityEditorState {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { currency } = useOrgCurrency();

  const { brands } = useListProductBrands();
  const { categories } = useListProductCategories();
  const { suppliers } = useListSuppliers();
  const { createProductBrandAsync } = useCreateProductBrand();
  const { createProductCategoryAsync } = useCreateProductCategory();
  const { createSupplierAsync } = useCreateSupplier();

  const { createProductAsync, isCreating } = useCreateProduct();
  const { updateProductAsync, isUpdating } = useUpdateProduct();
  const isSaving = isCreating || isUpdating;

  const [values, setValues] = useState<FormState>(() =>
    product ? formFromProduct(product) : blankForm
  );
  const [isUploading, setIsUploading] = useState(false);

  // Edit mode: the record can arrive after the first render (the editor is
  // reachable by URL, not only from a list row that already has it).
  const productId = product?.id;
  useEffect(() => {
    if (product) setValues(formFromProduct(product));
  }, [product]);

  const setValue = useCallback(
    (name: string, value: unknown) =>
      setValues((prev) => ({
        ...prev,
        [name]: value,
        // The amount input is disabled for "whole item", so a value typed under
        // a previous unit would otherwise be invisible AND still go to the wire.
        ...(name === 'measureUnit' && value === 'whole'
          ? { measureAmount: '' }
          : {}),
      })),
    []
  );

  // --- Money / markup synchronisation --------------------------------------
  const onSupplyChange = useCallback(
    (value: string) =>
      setValues((prev) => ({
        ...prev,
        supplyRaw: value,
        markupRaw: prev.retailEnabled
          ? computeMarkup(value, prev.retailRaw)
          : prev.markupRaw,
      })),
    []
  );

  const onRetailChange = useCallback(
    (value: string) =>
      setValues((prev) => ({
        ...prev,
        retailRaw: value,
        markupRaw: computeMarkup(prev.supplyRaw, value),
      })),
    []
  );

  const onMarkupChange = useCallback(
    (value: string) =>
      setValues((prev) => {
        const supply = parseMajorToCents(prev.supplyRaw);
        const markup = Number.parseFloat(value.replace(',', '.'));
        let retailRaw = prev.retailRaw;
        if (supply != null && supply > 0 && !Number.isNaN(markup)) {
          retailRaw = centsToMajorString(
            Math.round(supply * (1 + markup / 100))
          );
        }
        return { ...prev, markupRaw: value, retailRaw };
      }),
    []
  );

  const onRetailEnabledChange = useCallback(
    (checked: boolean) =>
      setValues((prev) => ({
        ...prev,
        retailEnabled: checked,
        markupRaw: checked
          ? computeMarkup(prev.supplyRaw, prev.retailRaw)
          : prev.markupRaw,
      })),
    []
  );

  // --- Inline-create helpers ----------------------------------------------
  const createBrand = useCallback(
    async (name: string) => {
      try {
        return (await createProductBrandAsync({ name })).id;
      } catch {
        return null;
      }
    },
    [createProductBrandAsync]
  );
  const createCategory = useCallback(
    async (name: string) => {
      try {
        return (await createProductCategoryAsync({ name })).id;
      } catch {
        return null;
      }
    },
    [createProductCategoryAsync]
  );
  const createSupplier = useCallback(
    async (name: string) => {
      try {
        return (await createSupplierAsync({ name })).id;
      } catch {
        return null;
      }
    },
    [createSupplierAsync]
  );

  const config: EntityFormConfig = useMemo(
    () => ({
      title: (isEdit) => (isEdit ? 'Edit Product' : 'Add Product'),
      aside: (
        <ProductPhotoAside
          images={values.images}
          onChange={(images) => setValue('images', images)}
          onUploadingChange={setIsUploading}
        />
      ),
      sections: [
        {
          id: 'details',
          label: 'Details',
          icon: ListTree,
          blocks: [
            {
              title: 'Product Details',
              rows: [
                [
                  {
                    kind: 'text',
                    name: 'name',
                    label: L.name,
                    placeholder: 'e.g. Argan oil shampoo',
                  },
                ],
                [
                  {
                    kind: 'textarea',
                    name: 'description',
                    label: L.description,
                    placeholder: 'Full product description',
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'brandId',
                    render: ({ disabled }) => (
                      <Field>
                        <FieldLabel htmlFor="product-brand">
                          {L.brandId}
                        </FieldLabel>
                        <InlineCreateSelect
                          clearLabel="No brand"
                          disabled={disabled}
                          emptyLabel="No brands yet."
                          id="product-brand"
                          onChange={(id) => setValue('brandId', id)}
                          onCreate={createBrand}
                          options={brands}
                          placeholder="Select brand"
                          searchPlaceholder="Search or create brand…"
                          value={values.brandId}
                        />
                      </Field>
                    ),
                  },
                ],
                [
                  {
                    kind: 'select',
                    name: 'measureUnit',
                    label: L.measureUnit,
                    options: productMeasureUnitValues.map((value) => ({
                      value,
                      label: productMeasureUnitLabels[value],
                    })),
                  },
                  {
                    kind: 'number',
                    name: 'measureAmount',
                    label: L.measureAmount,
                    min: 0,
                    placeholder: 'Amount',
                    // "Whole item" IS the amount — there is nothing to measure.
                    disabled: (v) => v.measureUnit === 'whole',
                  },
                ],
                [
                  {
                    kind: 'text',
                    name: 'barcode',
                    label: L.barcode,
                    placeholder: 'Optional',
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'categoryId',
                    render: ({ disabled }) => (
                      <Field>
                        <FieldLabel htmlFor="product-category">
                          {L.categoryId}
                        </FieldLabel>
                        <InlineCreateSelect
                          clearLabel="No category"
                          disabled={disabled}
                          emptyLabel="No categories yet."
                          id="product-category"
                          onChange={(id) => setValue('categoryId', id)}
                          onCreate={createCategory}
                          options={categories}
                          placeholder="Select category"
                          searchPlaceholder="Search or create category…"
                          value={values.categoryId}
                        />
                      </Field>
                    ),
                  },
                ],
              ],
            },
          ],
        },
        {
          id: 'pricing',
          label: 'Pricing',
          icon: Banknote,
          blocks: [
            {
              title: 'Pricing',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'supplyRaw',
                    render: ({ disabled }) => (
                      <Field>
                        <FieldLabel htmlFor="product-supply">
                          {L.supplyRaw}
                        </FieldLabel>
                        <InputGroup>
                          <InputGroupAddon>{currency.symbol}</InputGroupAddon>
                          <InputGroupInput
                            disabled={disabled}
                            id="product-supply"
                            inputMode="decimal"
                            onChange={(e) => onSupplyChange(e.target.value)}
                            placeholder="0.00"
                            value={values.supplyRaw}
                          />
                        </InputGroup>
                      </Field>
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'isMedication',
                    render: ({ disabled }) => (
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="product-medication">
                          {L.isMedication}
                        </FieldLabel>
                        <Switch
                          checked={values.isMedication}
                          disabled={disabled}
                          id="product-medication"
                          onCheckedChange={(checked) =>
                            setValues((prev) => ({
                              ...prev,
                              isMedication: checked,
                              // Cannot be sold. Clearing here keeps the form
                              // from ever posting a row the CHECK refuses.
                              retailEnabled: checked
                                ? false
                                : prev.retailEnabled,
                              onlineEnabled: checked
                                ? false
                                : prev.onlineEnabled,
                            }))
                          }
                        />
                      </Field>
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'retailEnabled',
                    render: ({ disabled }) => (
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="product-retail">
                          {L.retailEnabled}
                        </FieldLabel>
                        <Switch
                          checked={values.retailEnabled}
                          disabled={disabled}
                          id="product-retail"
                          onCheckedChange={onRetailEnabledChange}
                        />
                      </Field>
                    ),
                  },
                ],
              ],
            },
            {
              title: 'Retail',
              hidden: (v) => !v.retailEnabled,
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'onlineEnabled',
                    render: ({ disabled }) => (
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="product-online">
                          {L.onlineEnabled}
                        </FieldLabel>
                        <Switch
                          checked={values.onlineEnabled}
                          disabled={disabled}
                          id="product-online"
                          onCheckedChange={(checked) =>
                            setValues((prev) => ({
                              ...prev,
                              onlineEnabled: checked,
                            }))
                          }
                        />
                      </Field>
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'shippable',
                    render: ({ disabled }) => (
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="product-shippable">
                          {L.shippable}
                        </FieldLabel>
                        <Switch
                          checked={values.shippable}
                          disabled={disabled}
                          id="product-shippable"
                          onCheckedChange={(checked) =>
                            setValues((prev) => ({
                              ...prev,
                              shippable: checked,
                            }))
                          }
                        />
                      </Field>
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'retailRaw',
                    render: ({ disabled }) => (
                      <Field>
                        <FieldLabel htmlFor="product-retail-price">
                          {L.retailRaw}
                        </FieldLabel>
                        <InputGroup>
                          <InputGroupAddon>{currency.symbol}</InputGroupAddon>
                          <InputGroupInput
                            disabled={disabled}
                            id="product-retail-price"
                            inputMode="decimal"
                            onChange={(e) => onRetailChange(e.target.value)}
                            placeholder="0.00"
                            value={values.retailRaw}
                          />
                        </InputGroup>
                      </Field>
                    ),
                  },
                  {
                    kind: 'custom',
                    name: 'markupRaw',
                    render: ({ disabled }) => (
                      <Field>
                        <FieldLabel htmlFor="product-markup">Markup</FieldLabel>
                        <InputGroup>
                          <InputGroupInput
                            disabled={disabled}
                            id="product-markup"
                            inputMode="decimal"
                            onChange={(e) => onMarkupChange(e.target.value)}
                            placeholder="0"
                            value={values.markupRaw}
                          />
                          <InputGroupAddon align="inline-end">
                            %
                          </InputGroupAddon>
                        </InputGroup>
                      </Field>
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'teamMemberCommissionEnabled',
                    render: ({ disabled }) => (
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="product-commission">
                          {L.teamMemberCommissionEnabled}
                        </FieldLabel>
                        <Switch
                          checked={values.teamMemberCommissionEnabled}
                          disabled={disabled}
                          id="product-commission"
                          onCheckedChange={(c) =>
                            setValue('teamMemberCommissionEnabled', c)
                          }
                        />
                      </Field>
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'taxCode',
                    render: ({ disabled }) => (
                      <Field>
                        <FieldLabel htmlFor="product-tax-code">
                          Tax code
                        </FieldLabel>
                        <TaxCodePicker
                          disabled={disabled}
                          id="product-tax-code"
                          onChange={(taxCode) =>
                            setValue('taxCode', taxCode ?? '')
                          }
                          value={values.taxCode || null}
                        />
                      </Field>
                    ),
                  },
                ],
              ],
            },
          ],
        },
        {
          id: 'identifiers',
          label: 'Identifiers',
          icon: Barcode,
          blocks: [
            {
              title: 'Identifiers',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'skus',
                    render: ({ disabled }) => (
                      <ProductSkuField
                        disabled={disabled}
                        onChange={(skus) => setValue('skus', skus)}
                        productName={values.name}
                        skus={values.skus}
                      />
                    ),
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'supplierId',
                    render: ({ disabled }) => (
                      <Field>
                        <FieldLabel htmlFor="product-supplier">
                          {L.supplierId}
                        </FieldLabel>
                        <InlineCreateSelect
                          clearLabel="No supplier"
                          disabled={disabled}
                          emptyLabel="No suppliers yet."
                          id="product-supplier"
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
                ],
              ],
            },
          ],
        },
        {
          id: 'stock',
          label: 'Stock',
          icon: Package,
          blocks: [
            {
              title: 'Stock Tracking',
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'trackStock',
                    render: ({ disabled }) => (
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="product-track">
                          {L.trackStock}
                        </FieldLabel>
                        <Switch
                          checked={values.trackStock}
                          disabled={disabled}
                          id="product-track"
                          onCheckedChange={(c) => setValue('trackStock', c)}
                        />
                      </Field>
                    ),
                  },
                ],
                [
                  {
                    kind: 'number',
                    name: 'lowStockLevel',
                    label: L.lowStockLevel,
                    min: 0,
                    placeholder: 'e.g. 5',
                    hidden: (v) => !v.trackStock,
                  },
                  {
                    kind: 'number',
                    name: 'reorderQuantity',
                    label: L.reorderQuantity,
                    min: 1,
                    placeholder: 'e.g. 20',
                    hidden: (v) => !v.trackStock,
                  },
                ],
                [
                  {
                    kind: 'custom',
                    name: 'lowStockNotify',
                    hidden: (v) => !v.trackStock,
                    render: ({ disabled }) => (
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="product-notify">
                          {L.lowStockNotify}
                        </FieldLabel>
                        <Switch
                          checked={values.lowStockNotify}
                          disabled={disabled}
                          id="product-notify"
                          onCheckedChange={(c) => setValue('lowStockNotify', c)}
                        />
                      </Field>
                    ),
                  },
                ],
              ],
            },
            {
              // Per-location counts are only meaningful once the product
              // exists, so this block is edit-only — as it was in the dialog.
              title: 'Stock On Hand',
              hidden: (v) => !v.trackStock || !productId,
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'stockOnHand',
                    render: () =>
                      productId ? (
                        <ProductStockEditor productId={productId} />
                      ) : null,
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
      brands,
      categories,
      suppliers,
      currency.symbol,
      productId,
      setValue,
      createBrand,
      createCategory,
      createSupplier,
      onSupplyChange,
      onRetailChange,
      onMarkupChange,
      onRetailEnabledChange,
    ]
  );

  const onSave = useCallback(async () => {
    // The dialog disabled its submit button while a picture was uploading;
    // saying so is clearer than a dead button on a full page.
    if (isUploading) {
      toast.error('Wait for the picture upload to finish');
      return;
    }
    if (!values.name.trim()) {
      toast.error('Name is required');
      return;
    }

    // Retail-price validity is a UI guard; the wire body itself is assembled
    // in buildProductWritePayload (inside the create/update hooks).
    const retailPriceCents = values.retailEnabled
      ? parseMajorToCents(values.retailRaw)
      : null;
    if (
      values.retailEnabled &&
      (retailPriceCents == null || retailPriceCents <= 0)
    ) {
      toast.error('Enter a valid retail price');
      return;
    }

    // Typed intent (raw form values, minus the presentational markup field).
    const { markupRaw: _markupRaw, ...intent }: FormState = values;

    try {
      if (product) {
        await updateProductAsync({ productId: product.id, ...intent });
      } else {
        await createProductAsync(intent);
      }
      await navigate({ to: routes.catalogProducts });
    } catch {
      // The hook already surfaces an error toast.
    }
  }, [
    values,
    product,
    isUploading,
    createProductAsync,
    updateProductAsync,
    navigate,
    routes.catalogProducts,
  ]);

  return {
    config,
    values: values as unknown as EntityFormValues,
    setValue,
    isSaving,
    onSave: () => void onSave(),
    onCancel: () => void navigate({ to: routes.catalogProducts }),
  };
}

/** Edit mode resolves the record by id; the route renders the spinner. */
export function useProductEditorById({ id }: { id?: string }) {
  const { product, isLoading } = useGetProduct(id ?? '');
  const editor = useProductEditor({ product: id ? product : null });
  return {
    ...editor,
    isLoading: Boolean(id) && isLoading,
    notFound: Boolean(id) && !isLoading && !product,
  };
}
