// Slot<T> editor.
//
// A slot is a discriminated union on `source` with exactly two variants:
//   { source: 'fixed', value: T }
//   { source: 'query', query: SlotQuery, required: boolean }
//
// We render a toggle between the two branches. The `query` branch always uses
// the shared QueryForm (kind picker + per-kind fields). The `fixed` branch
// inspects the inner `value` schema and dispatches to a specialised picker:
//
//   z.array(mediaSourceSchema) → MediaPicker (multi)
//   mediaSourceSchema          → MediaPicker (single)
//   z.array(z.string())        → StringListForm
//   z.string()                 → textarea
//   musicSelectionSchema       → MusicPicker
//   else                        → recursive SchemaForm fallback (W-B's behaviour)

import type React from 'react';
import type { z } from 'zod';
import { pathKey } from '../lib/node-path.js';
import type { NodePath } from '../types.js';
import { SchemaForm, _internal, defaultForSchema } from './schema-form.js';
import { MediaPicker, type MediaSource } from './slots/media-picker.js';
import { MusicPicker, type MusicSelection } from './slots/music-picker.js';
import { QueryForm, type SlotQuery } from './slots/query-form.js';
import { StringListForm } from './slots/string-list-form.js';

// schema-form.tsx and slot-form.tsx form an import cycle (schema-form ↔
// slot-form via SlotForm/isSlotSchema). Destructuring `_internal` at module
// init would TDZ-error on first import. Wrap each helper in a lazy proxy fn
// that hits `_internal.*` only when actually called.
const typeOf = (s: z.ZodTypeAny) => _internal.typeOf(s);
const shapeOf = (s: z.ZodTypeAny) => _internal.shapeOf(s);
const unionOptions = (s: z.ZodTypeAny) => _internal.unionOptions(s);
const discriminatorOf = (s: z.ZodTypeAny) => _internal.discriminatorOf(s);
const literalValues = (s: z.ZodTypeAny) => _internal.literalValues(s);

interface ZodDef {
  type: string;
  [k: string]: unknown;
}
function defOf(schema: z.ZodTypeAny): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}
function arrayElement(schema: z.ZodTypeAny): z.ZodTypeAny {
  return defOf(schema).element as z.ZodTypeAny;
}

export interface SlotFormProps {
  schema: z.ZodTypeAny;
  value: unknown;
  onChange: (next: unknown) => void;
  path: NodePath;
}

/**
 * Detect a `slot(T)` discriminated union. Returns true for any schema whose
 * shape matches what `slot()` in @borradh-workspace/video-templates emits:
 *
 *   discriminator === 'source'
 *   variant where source = 'fixed' has a `value` field
 *   variant where source = 'query' has a `query` field
 */
export function isSlotSchema(schema: z.ZodTypeAny): boolean {
  if (typeOf(schema) !== 'union') return false;
  if (discriminatorOf(schema) !== 'source') return false;

  let hasFixed = false;
  let hasQuery = false;
  for (const opt of unionOptions(schema)) {
    if (typeOf(opt) !== 'object') continue;
    const shape = shapeOf(opt);
    const tagSchema = shape.source;
    if (!tagSchema || typeOf(tagSchema) !== 'literal') continue;
    const tag = literalValues(tagSchema)[0];
    if (tag === 'fixed' && 'value' in shape) hasFixed = true;
    if (tag === 'query' && 'query' in shape) hasQuery = true;
  }
  return hasFixed && hasQuery;
}

interface SlotVariants {
  fixed?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
}

function getSlotVariants(schema: z.ZodTypeAny): SlotVariants {
  const out: SlotVariants = {};
  for (const opt of unionOptions(schema)) {
    if (typeOf(opt) !== 'object') continue;
    const shape = shapeOf(opt);
    const tagSchema = shape.source;
    if (!tagSchema || typeOf(tagSchema) !== 'literal') continue;
    const tag = literalValues(tagSchema)[0];
    if (tag === 'fixed') out.fixed = opt;
    if (tag === 'query') out.query = opt;
  }
  return out;
}

// ── Inner-value schema classification ──────────────────────────────────
// Distinguishes the concrete picker to render for the `fixed` branch.

type FixedKind =
  | 'media-list'
  | 'media-single'
  | 'string-list'
  | 'string'
  | 'music'
  | 'fallback';

function hasShapeKeys(
  schema: z.ZodTypeAny,
  required: string[],
  forbidden: string[] = []
): boolean {
  if (typeOf(schema) !== 'object') return false;
  const shape = shapeOf(schema);
  for (const k of required) if (!(k in shape)) return false;
  for (const k of forbidden) if (k in shape) return false;
  return true;
}

function isMediaSourceSchema(schema: z.ZodTypeAny): boolean {
  // mediaSourceSchema = { url, mediaType, trimStartFrames, naturalDurationFrames? }
  return hasShapeKeys(schema, ['url', 'mediaType', 'trimStartFrames']);
}

function isMusicSelectionSchema(schema: z.ZodTypeAny): boolean {
  // musicSelectionSchema = { trackId, volume }
  if (!hasShapeKeys(schema, ['trackId', 'volume'])) return false;
  // Distinguish from other 2-field shapes by checking field count.
  const shape = shapeOf(schema);
  return Object.keys(shape).length === 2;
}

function classifyFixed(schema: z.ZodTypeAny): FixedKind {
  const t = typeOf(schema);

  if (t === 'array') {
    const el = arrayElement(schema);
    if (isMediaSourceSchema(el)) return 'media-list';
    if (typeOf(el) === 'string') return 'string-list';
    return 'fallback';
  }

  if (t === 'object') {
    if (isMediaSourceSchema(schema)) return 'media-single';
    if (isMusicSelectionSchema(schema)) return 'music';
    return 'fallback';
  }

  if (t === 'string') return 'string';

  return 'fallback';
}

export const SlotForm: React.FC<SlotFormProps> = ({
  schema,
  value,
  onChange,
  path,
}) => {
  const variants = getSlotVariants(schema);
  const obj = (value ?? {}) as Record<string, unknown>;
  const source = obj.source as 'fixed' | 'query' | undefined;

  const sourceSelectId = pathKey([...path, 'source']);

  const fixedInner = variants.fixed ? shapeOf(variants.fixed).value : undefined;
  const queryInner = variants.query ? shapeOf(variants.query).query : undefined;
  const requiredInner = variants.query
    ? shapeOf(variants.query).required
    : undefined;

  return (
    <div className="schema-form-slot">
      <div
        className="schema-form-field"
        data-path={pathKey([...path, 'source'])}
      >
        <label className="schema-form-label" htmlFor={sourceSelectId}>
          source
        </label>
        <div className="schema-form-control">
          <select
            id={sourceSelectId}
            value={source ?? ''}
            onChange={(e) => {
              const next = e.target.value as 'fixed' | 'query';
              if (next === 'fixed') {
                onChange({
                  source: 'fixed',
                  value: fixedInner ? defaultForSchema(fixedInner) : undefined,
                });
              } else {
                onChange({
                  source: 'query',
                  query: queryInner ? defaultForSchema(queryInner) : undefined,
                  required:
                    typeof obj.required === 'boolean' ? obj.required : true,
                });
              }
            }}
          >
            {source === undefined ? (
              <option value="" disabled>
                select…
              </option>
            ) : null}
            <option value="fixed">fixed</option>
            <option value="query">query</option>
          </select>
        </div>
      </div>

      {source === 'fixed' && fixedInner
        ? renderFixedBranch({
            innerSchema: fixedInner,
            innerValue: obj.value,
            onChange: (next) => onChange({ source: 'fixed', value: next }),
            path: [...path, 'value'],
          })
        : null}

      {source === 'query' && queryInner ? (
        <>
          <QueryForm
            value={obj.query as SlotQuery | undefined}
            onChange={(next) =>
              onChange({
                source: 'query',
                query: next,
                required:
                  typeof obj.required === 'boolean' ? obj.required : true,
              })
            }
            path={[...path, 'query']}
          />
          {requiredInner ? (
            <div
              className="schema-form-field"
              data-path={pathKey([...path, 'required'])}
            >
              <label
                className="schema-form-label"
                htmlFor={pathKey([...path, 'required'])}
              >
                required
              </label>
              <div className="schema-form-control">
                <input
                  id={pathKey([...path, 'required'])}
                  type="checkbox"
                  checked={Boolean(obj.required)}
                  onChange={(e) =>
                    onChange({
                      source: 'query',
                      query: obj.query,
                      required: e.target.checked,
                    })
                  }
                />
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

function renderFixedBranch(args: {
  innerSchema: z.ZodTypeAny;
  innerValue: unknown;
  onChange: (next: unknown) => void;
  path: NodePath;
}): React.ReactNode {
  const { innerSchema, innerValue, onChange, path } = args;
  const kind = classifyFixed(innerSchema);

  switch (kind) {
    case 'media-list':
      return (
        <MediaPicker
          value={innerValue as MediaSource[] | undefined}
          onChange={(next) => onChange(next)}
          single={false}
          path={path}
        />
      );
    case 'media-single':
      return (
        <MediaPicker
          value={innerValue as MediaSource | undefined}
          onChange={(next) => onChange(next)}
          single={true}
          path={path}
        />
      );
    case 'string-list':
      return (
        <StringListForm
          value={innerValue as string[] | undefined}
          onChange={(next) => onChange(next)}
          path={path}
        />
      );
    case 'string': {
      const id = pathKey(path);
      return (
        <div className="schema-form-field" data-path={id}>
          <label className="schema-form-label" htmlFor={id}>
            value
          </label>
          <div className="schema-form-control">
            <textarea
              id={id}
              rows={3}
              style={{ width: '100%' }}
              value={(innerValue as string | undefined) ?? ''}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </div>
      );
    }
    case 'music':
      return (
        <MusicPicker
          value={innerValue as MusicSelection | undefined}
          onChange={(next) => onChange(next)}
          path={path}
        />
      );
    case 'fallback':
      return (
        <SchemaForm
          schema={innerSchema}
          value={innerValue}
          onChange={onChange}
          path={path}
          label="value"
        />
      );
  }
}
