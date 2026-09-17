/**
 * The product editor's SKU list — badges, a typed entry (Enter or "Add") and
 * the auto-generate button. Lifted out of the product dialog unchanged; it owns
 * only the draft input, the SKU list itself lives in the editor's form state.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { createProductForm } from '../api/create-product/create-product.form';

/** `ARGANOIL-4F2X` — a name-derived prefix plus a collision-free suffix. */
export function generateSku(name: string, existing: string[]): string {
  const prefix =
    name
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase()
      .slice(0, 8) || 'SKU';
  let candidate = '';
  do {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    candidate = `${prefix}-${suffix}`;
  } while (existing.includes(candidate));
  return candidate;
}

export function ProductSkuField({
  skus,
  productName,
  onChange,
  disabled,
}: {
  skus: string[];
  productName: string;
  onChange: (skus: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');

  const addSku = (raw: string) => {
    const value = raw.trim().toUpperCase();
    if (!value || skus.includes(value)) return;
    onChange([...skus, value]);
    setDraft('');
  };

  return (
    <Field>
      <FieldLabel>SKUs</FieldLabel>
      {skus.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {skus.map((sku) => (
            <Badge key={sku} variant="secondary">
              {sku}
              <button
                aria-label={`Remove ${sku}`}
                className="ml-1"
                onClick={() => onChange(skus.filter((s) => s !== sku))}
                type="button"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          aria-label={createProductForm.labels.skus}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addSku(draft);
            }
          }}
          placeholder="Enter a SKU"
          value={draft}
        />
        <Button
          disabled={disabled}
          onClick={() => addSku(draft)}
          type="button"
          variant="outline"
        >
          Add
        </Button>
        <Button
          disabled={disabled}
          onClick={() => addSku(generateSku(productName, skus))}
          type="button"
          variant="outline"
        >
          <Sparkles className="size-4" />
          Auto-generate
        </Button>
      </div>
    </Field>
  );
}
