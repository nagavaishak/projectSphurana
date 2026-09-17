import { PlusIcon, Trash2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** One free-text spec line. Rows with a blank key are dropped on submit. */
export interface ResourceSpecRow {
  key: string;
  value: string;
}

export const MAX_SPEC_ROWS = 20;
export const MAX_SPEC_LENGTH = 60;

interface ResourceSpecsEditorProps {
  value: ResourceSpecRow[];
  onChange: (rows: ResourceSpecRow[]) => void;
  /** Id for the first key input so the group's label points at something. */
  id?: string;
  invalid?: boolean;
}

/**
 * Clinic-defined, DISPLAY-ONLY key/values ("Size": "3.5 x 4m").
 *
 * Deliberately free text rather than a fixed schema: what matters about a room
 * differs per clinic, and specs never affect scheduling — the booking engine
 * never reads them.
 */
export function ResourceSpecsEditor({
  value,
  onChange,
  id,
  invalid,
}: ResourceSpecsEditorProps) {
  const rows = value.length > 0 ? value : [];

  const update = (index: number, patch: Partial<ResourceSpecRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const remove = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  const add = () => {
    if (rows.length >= MAX_SPEC_ROWS) return;
    onChange([...rows, { key: '', value: '' }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div key={`spec-${index}`} className="flex items-center gap-2">
          <Input
            id={index === 0 ? id : undefined}
            value={row.key}
            maxLength={MAX_SPEC_LENGTH}
            placeholder="e.g. Size"
            aria-label={`Spec ${index + 1} name`}
            aria-invalid={invalid}
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <Input
            value={row.value}
            maxLength={MAX_SPEC_LENGTH}
            placeholder="e.g. 3.5 x 4m"
            aria-label={`Spec ${index + 1} value`}
            aria-invalid={invalid}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove spec ${index + 1}`}
            onClick={() => remove(index)}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      ))}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={add}
          disabled={rows.length >= MAX_SPEC_ROWS}
        >
          <PlusIcon className="size-4" />
          Add spec
        </Button>
      </div>

      <FieldDescription>
        Shown on the room, never used for scheduling. Up to {MAX_SPEC_ROWS}{' '}
        lines.
      </FieldDescription>
    </div>
  );
}
