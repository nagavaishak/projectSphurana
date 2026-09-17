// Recursive Zod → form renderer.
//
// Strategy: walk the schema and the value in lockstep, emitting a small input
// per leaf. We don't rely on react-hook-form here — the schema shapes (esp.
// discriminated unions and z.lazy) are awkward for `register`/`Controller`,
// and the editor state already lives in zustand, so a controlled-form pattern
// is simpler.
//
// Anything we can't render gets a readonly JSON textarea so we never throw and
// the user can still see what's in the doc.
//
// Implementation note: Zod 4 exposes runtime kinds via `schema._zod.def.type`
// (a string discriminator like "object", "array", "union", "literal", …).
// We use that rather than `instanceof` to avoid the v4 type-level generic
// gymnastics that don't narrow well across schema types.

import type React from 'react';
import { useId } from 'react';
import type { z } from 'zod';
import { pathKey } from '../lib/node-path.js';
import type { NodePath } from '../types.js';
import { SlotForm, isSlotSchema } from './slot-form.js';

export interface SchemaFormProps {
  schema: z.ZodTypeAny;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Path used for stable form ids and labels. */
  path: NodePath;
  /** Optional override for the label of this node. */
  label?: string;
}

// ── Zod 4 internal helpers ────────────────────────────────────────────
// These reach into `schema._zod.def` because Zod 4 makes the runtime-kind
// discrimination via `def.type`. We keep all the casts in one place.

interface ZodDef {
  type: string;
  [k: string]: unknown;
}

function defOf(schema: z.ZodTypeAny): ZodDef {
  // `_zod` is the v4 internals namespace; every schema has it.
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

function typeOf(schema: z.ZodTypeAny): string {
  return defOf(schema).type;
}

function shapeOf(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  // ZodObject exposes `.shape` directly.
  return (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
}

function unionOptions(schema: z.ZodTypeAny): z.ZodTypeAny[] {
  const def = defOf(schema);
  return (def.options as z.ZodTypeAny[]) ?? [];
}

function discriminatorOf(schema: z.ZodTypeAny): string | undefined {
  const def = defOf(schema);
  return (def.discriminator as string | undefined) ?? undefined;
}

function arrayElement(schema: z.ZodTypeAny): z.ZodTypeAny {
  return defOf(schema).element as z.ZodTypeAny;
}

function tupleItems(schema: z.ZodTypeAny): z.ZodTypeAny[] {
  return (defOf(schema).items as z.ZodTypeAny[]) ?? [];
}

function literalValues(schema: z.ZodTypeAny): unknown[] {
  return (defOf(schema).values as unknown[]) ?? [];
}

function enumValues(schema: z.ZodTypeAny): Array<string | number> {
  // ZodEnum exposes `.options` in v4.
  const opts = (schema as unknown as { options?: Array<string | number> })
    .options;
  if (Array.isArray(opts)) return opts;
  // Fallback: read def.entries (for native enums).
  const entries = defOf(schema).entries as
    | Record<string, string | number>
    | undefined;
  if (entries) {
    const vals = Object.values(entries);
    // Filter out numeric-enum reverse mappings (strings that are themselves keys).
    const keys = new Set(Object.keys(entries));
    return vals.filter((v) => !(typeof v === 'string' && keys.has(v)));
  }
  return [];
}

function innerOfWrapper(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
  const def = defOf(schema);
  return (def.innerType as z.ZodTypeAny | undefined) ?? undefined;
}

function lazyTarget(schema: z.ZodTypeAny): z.ZodTypeAny {
  // ZodLazy stores a `getter` function in v4.
  const def = defOf(schema) as { getter?: () => z.ZodTypeAny };
  return def.getter ? def.getter() : (schema as z.ZodTypeAny);
}

interface UnwrappedSchema {
  schema: z.ZodTypeAny;
  optional: boolean;
}

/** Peel ZodOptional / ZodNullable / ZodDefault / ZodPipe wrappers. */
export function unwrapSchema(schema: z.ZodTypeAny): UnwrappedSchema {
  let cursor: z.ZodTypeAny = schema;
  let optional = false;
  for (let i = 0; i < 8; i++) {
    const t = typeOf(cursor);
    if (t === 'optional' || t === 'nullable' || t === 'nonoptional') {
      if (t !== 'nonoptional') optional = true;
      const inner = innerOfWrapper(cursor);
      if (!inner) break;
      cursor = inner;
      continue;
    }
    if (t === 'default' || t === 'prefault' || t === 'catch') {
      const inner = innerOfWrapper(cursor);
      if (!inner) break;
      cursor = inner;
      continue;
    }
    if (t === 'pipe') {
      // For UI we usually want the input side of a pipe (the user-facing type).
      const def = defOf(cursor) as {
        in?: z.ZodTypeAny;
        out?: z.ZodTypeAny;
      };
      if (def.in) {
        cursor = def.in;
        continue;
      }
      if (def.out) {
        cursor = def.out;
        continue;
      }
      break;
    }
    if (t === 'readonly') {
      const inner = innerOfWrapper(cursor);
      if (!inner) break;
      cursor = inner;
      continue;
    }
    break;
  }
  return { schema: cursor, optional };
}

// ── Component ─────────────────────────────────────────────────────────
export const SchemaForm: React.FC<SchemaFormProps> = (props) => {
  const inner = unwrapSchema(props.schema);
  return (
    <Renderer {...props} schema={inner.schema} optional={inner.optional} />
  );
};

interface RendererProps extends SchemaFormProps {
  optional: boolean;
}

const Renderer: React.FC<RendererProps> = ({
  schema,
  value,
  onChange,
  path,
  label,
  optional,
}) => {
  // 1) Slot<T> shortcut — detect before generic discriminated-union handling.
  if (isSlotSchema(schema)) {
    return (
      <Field label={label ?? lastSegment(path)} path={path}>
        <SlotForm
          schema={schema}
          value={value}
          onChange={onChange}
          path={path}
        />
      </Field>
    );
  }

  const t = typeOf(schema);

  // 2) Lazy — resolve and recurse.
  if (t === 'lazy') {
    return (
      <SchemaForm
        schema={lazyTarget(schema)}
        value={value}
        onChange={onChange}
        path={path}
        label={label}
      />
    );
  }

  // 3) Discriminated union (or generic union with a discriminator).
  if (t === 'union' && discriminatorOf(schema)) {
    return (
      <DiscriminatedUnionInput
        schema={schema}
        value={value}
        onChange={onChange}
        path={path}
        label={label ?? lastSegment(path)}
      />
    );
  }

  // 4) Object — render a field group.
  if (t === 'object') {
    return (
      <ObjectInput
        schema={schema}
        value={value as Record<string, unknown> | undefined}
        onChange={onChange}
        path={path}
        label={label}
      />
    );
  }

  // 5) Array — list + add/remove.
  if (t === 'array') {
    return (
      <ArrayInput
        schema={schema}
        value={value as unknown[] | undefined}
        onChange={onChange}
        path={path}
        label={label ?? lastSegment(path)}
      />
    );
  }

  // 6) Tuple — small fixed-arity list.
  if (t === 'tuple') {
    return (
      <TupleInput
        schema={schema}
        value={value as unknown[] | undefined}
        onChange={onChange}
        path={path}
        label={label ?? lastSegment(path)}
      />
    );
  }

  // 7) Primitive inputs.
  const fieldLabel = label ?? lastSegment(path);

  if (t === 'string') {
    return (
      <Field label={fieldLabel} path={path} optional={optional}>
        <StringInput
          value={(value as string | undefined) ?? ''}
          onChange={(v) => onChange(v)}
          path={path}
        />
      </Field>
    );
  }

  if (t === 'number' || t === 'int') {
    return (
      <Field label={fieldLabel} path={path} optional={optional}>
        <NumberInput
          value={value as number | undefined}
          onChange={(v) => onChange(v)}
          path={path}
        />
      </Field>
    );
  }

  if (t === 'boolean') {
    return (
      <Field label={fieldLabel} path={path} optional={optional}>
        <BooleanInput
          value={(value as boolean | undefined) ?? false}
          onChange={(v) => onChange(v)}
          path={path}
        />
      </Field>
    );
  }

  if (t === 'enum') {
    const options = enumValues(schema);
    return (
      <Field label={fieldLabel} path={path} optional={optional}>
        <SelectInput
          value={value as string | number | undefined}
          options={options}
          onChange={(v) => onChange(v)}
          path={path}
        />
      </Field>
    );
  }

  if (t === 'literal') {
    const vals = literalValues(schema);
    const display =
      vals.length === 1 ? JSON.stringify(vals[0]) : JSON.stringify(vals);
    return (
      <Field label={fieldLabel} path={path} optional={optional}>
        <span className="schema-form-readonly">{display}</span>
      </Field>
    );
  }

  // 8) Fallback — readonly JSON.
  return (
    <Field label={fieldLabel} path={path} optional={optional}>
      <JsonFallback value={value} />
    </Field>
  );
};

// ── Object ────────────────────────────────────────────────────────────
const ObjectInput: React.FC<{
  schema: z.ZodTypeAny;
  value: Record<string, unknown> | undefined;
  onChange: (next: unknown) => void;
  path: NodePath;
  label?: string;
}> = ({ schema, value, onChange, path, label }) => {
  const shape = shapeOf(schema);
  const safeValue: Record<string, unknown> = value ?? {};

  return (
    <fieldset className="schema-form-group">
      {label ? (
        <legend className="schema-form-group-label">{label}</legend>
      ) : null}
      {Object.entries(shape).map(([key, childSchema]) => (
        <SchemaForm
          key={key}
          schema={childSchema}
          value={safeValue[key]}
          onChange={(next) => {
            if (next === undefined) {
              const copy = { ...safeValue };
              delete copy[key];
              onChange(copy);
            } else {
              onChange({ ...safeValue, [key]: next });
            }
          }}
          path={[...path, key]}
          label={key}
        />
      ))}
    </fieldset>
  );
};

// ── Discriminated union (non-slot) ────────────────────────────────────
const DiscriminatedUnionInput: React.FC<{
  schema: z.ZodTypeAny;
  value: unknown;
  onChange: (next: unknown) => void;
  path: NodePath;
  label: string;
}> = ({ schema, value, onChange, path, label }) => {
  const discriminator = discriminatorOf(schema) ?? 'kind';
  const options = unionOptions(schema);
  const valueObj = (value ?? {}) as Record<string, unknown>;
  const currentTag = valueObj[discriminator];

  const tagOptions = options
    .map((opt) => {
      const shape = shapeOf(opt);
      const tagSchema = shape[discriminator];
      if (!tagSchema) return undefined;
      if (typeOf(tagSchema) !== 'literal') return undefined;
      const vals = literalValues(tagSchema);
      return vals[0] !== undefined ? String(vals[0]) : undefined;
    })
    .filter((x): x is string => x !== undefined);

  const currentOpt = options.find((opt) => {
    const shape = shapeOf(opt);
    const tagSchema = shape[discriminator];
    if (!tagSchema || typeOf(tagSchema) !== 'literal') return false;
    return literalValues(tagSchema)[0] === currentTag;
  });

  return (
    <fieldset className="schema-form-group">
      <legend className="schema-form-group-label">{label}</legend>
      <Field label={discriminator} path={[...path, discriminator]}>
        <select
          id={pathKey([...path, discriminator])}
          value={(currentTag as string) ?? ''}
          onChange={(e) => {
            const nextTag = e.target.value;
            const nextOpt = options.find((opt) => {
              const shape = shapeOf(opt);
              const ts = shape[discriminator];
              if (!ts || typeOf(ts) !== 'literal') return false;
              return literalValues(ts)[0] === nextTag;
            });
            const nextShape = nextOpt ? Object.keys(shapeOf(nextOpt)) : [];
            const carried: Record<string, unknown> = {};
            for (const k of nextShape) {
              if (k === discriminator) continue;
              if (k in valueObj) carried[k] = valueObj[k];
            }
            onChange({ [discriminator]: nextTag, ...carried });
          }}
        >
          {currentTag === undefined ? (
            <option value="" disabled>
              select…
            </option>
          ) : null}
          {tagOptions.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </Field>
      {currentOpt
        ? Object.entries(shapeOf(currentOpt))
            .filter(([k]) => k !== discriminator)
            .map(([key, childSchema]) => (
              <SchemaForm
                key={key}
                schema={childSchema}
                value={valueObj[key]}
                onChange={(next) => {
                  if (next === undefined) {
                    const copy = { ...valueObj };
                    delete copy[key];
                    onChange(copy);
                  } else {
                    onChange({ ...valueObj, [key]: next });
                  }
                }}
                path={[...path, key]}
                label={key}
              />
            ))
        : null}
    </fieldset>
  );
};

// ── Array ─────────────────────────────────────────────────────────────
const ArrayInput: React.FC<{
  schema: z.ZodTypeAny;
  value: unknown[] | undefined;
  onChange: (next: unknown) => void;
  path: NodePath;
  label: string;
}> = ({ schema, value, onChange, path, label }) => {
  const items = value ?? [];
  const element = arrayElement(schema);
  return (
    <fieldset className="schema-form-group">
      <legend className="schema-form-group-label">{label}</legend>
      {items.length === 0 ? (
        <div className="schema-form-empty">empty</div>
      ) : null}
      {items.map((item, i) => (
        <div className="schema-form-array-row" key={String(i)}>
          <SchemaForm
            schema={element}
            value={item}
            onChange={(next) => {
              const copy = items.slice();
              copy[i] = next;
              onChange(copy);
            }}
            path={[...path, i]}
            label={`[${i}]`}
          />
          <button
            type="button"
            className="schema-form-array-remove"
            onClick={() => {
              const copy = items.slice();
              copy.splice(i, 1);
              onChange(copy);
            }}
          >
            remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="schema-form-array-add"
        onClick={() => {
          const next = defaultForSchema(element);
          onChange([...items, next]);
        }}
      >
        + add item
      </button>
    </fieldset>
  );
};

// ── Tuple ─────────────────────────────────────────────────────────────
const TupleInput: React.FC<{
  schema: z.ZodTypeAny;
  value: unknown[] | undefined;
  onChange: (next: unknown) => void;
  path: NodePath;
  label: string;
}> = ({ schema, value, onChange, path, label }) => {
  const items = tupleItems(schema);
  const safeValue = value ?? [];
  return (
    <fieldset className="schema-form-group">
      <legend className="schema-form-group-label">{label}</legend>
      {items.map((item, i) => (
        <SchemaForm
          key={String(i)}
          schema={item}
          value={safeValue[i]}
          onChange={(next) => {
            const copy = safeValue.slice();
            copy[i] = next;
            while (copy.length < items.length) copy.push(undefined);
            onChange(copy);
          }}
          path={[...path, i]}
          label={`[${i}]`}
        />
      ))}
    </fieldset>
  );
};

// ── Primitive inputs ──────────────────────────────────────────────────
const StringInput: React.FC<{
  value: string;
  onChange: (next: string) => void;
  path: NodePath;
}> = ({ value, onChange, path }) => (
  <input
    type="text"
    id={pathKey(path)}
    value={value}
    onChange={(e) => onChange(e.target.value)}
  />
);

const NumberInput: React.FC<{
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  path: NodePath;
}> = ({ value, onChange, path }) => (
  <input
    type="number"
    id={pathKey(path)}
    value={value === undefined ? '' : value}
    onChange={(e) => {
      const raw = e.target.value;
      if (raw === '') return onChange(undefined);
      const n = Number(raw);
      onChange(Number.isFinite(n) ? n : undefined);
    }}
  />
);

const BooleanInput: React.FC<{
  value: boolean;
  onChange: (next: boolean) => void;
  path: NodePath;
}> = ({ value, onChange, path }) => (
  <input
    type="checkbox"
    id={pathKey(path)}
    checked={value}
    onChange={(e) => onChange(e.target.checked)}
  />
);

const SelectInput: React.FC<{
  value: string | number | undefined;
  options: Array<string | number>;
  onChange: (next: string | number) => void;
  path: NodePath;
}> = ({ value, options, onChange, path }) => (
  <select
    id={pathKey(path)}
    value={value === undefined ? '' : String(value)}
    onChange={(e) => {
      const raw = e.target.value;
      const match = options.find((o) => String(o) === raw);
      onChange(match ?? raw);
    }}
  >
    {value === undefined ? (
      <option value="" disabled>
        select…
      </option>
    ) : null}
    {options.map((opt) => (
      <option key={String(opt)} value={String(opt)}>
        {String(opt)}
      </option>
    ))}
  </select>
);

const JsonFallback: React.FC<{ value: unknown }> = ({ value }) => (
  <textarea
    readOnly
    rows={4}
    className="schema-form-json-fallback"
    value={(() => {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    })()}
  />
);

// ── Field wrapper ─────────────────────────────────────────────────────
const Field: React.FC<{
  label: string;
  path: NodePath;
  optional?: boolean;
  children: React.ReactNode;
}> = ({ label, path, optional, children }) => {
  const reactId = useId();
  return (
    <div
      className="schema-form-field"
      data-path={pathKey(path)}
      data-react-id={reactId}
    >
      <label className="schema-form-label" htmlFor={pathKey(path)}>
        {label}
        {optional ? (
          <span className="schema-form-optional"> (optional)</span>
        ) : null}
      </label>
      <div className="schema-form-control">{children}</div>
    </div>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────
function lastSegment(path: NodePath): string {
  if (path.length === 0) return '';
  return String(path[path.length - 1]);
}

// Best-effort default value for a schema. Used when adding array items.
export function defaultForSchema(schema: z.ZodTypeAny): unknown {
  const { schema: inner } = unwrapSchema(schema);
  const t = typeOf(inner);
  if (t === 'string') return '';
  if (t === 'number' || t === 'int') return 0;
  if (t === 'boolean') return false;
  if (t === 'literal') return literalValues(inner)[0];
  if (t === 'enum') {
    const opts = enumValues(inner);
    return opts[0];
  }
  if (t === 'array') return [];
  if (t === 'tuple') {
    return tupleItems(inner).map(defaultForSchema);
  }
  if (t === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(shapeOf(inner))) {
      const childUnwrap = unwrapSchema(v);
      if (childUnwrap.optional) continue;
      out[k] = defaultForSchema(v);
    }
    return out;
  }
  if (t === 'union') {
    const opts = unionOptions(inner);
    if (opts[0]) return defaultForSchema(opts[0]);
    return {};
  }
  if (t === 'lazy') {
    return defaultForSchema(lazyTarget(inner));
  }
  return undefined;
}

// Re-export internal helpers so slot-form and inspector-pane can share them.
export const _internal = {
  typeOf,
  shapeOf,
  unionOptions,
  discriminatorOf,
  arrayElement,
  tupleItems,
  literalValues,
  lazyTarget,
};
