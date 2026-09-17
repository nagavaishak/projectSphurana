// Inspector pane.
//
// Reads `selection` + `doc` from the editor store, slices both the doc and
// the schema down to the selected node, and renders a SchemaForm. Edits patch
// the doc via setAtPath; the store re-synthesizes the preview from there.

import { templateDocSchema } from '@borradh-workspace/video-templates';
import type React from 'react';
import type { z } from 'zod';
import { SchemaForm, _internal, unwrapSchema } from '../form/schema-form.js';
import { getAtPath, setAtPath } from '../lib/node-path.js';
import { useEditorStore } from '../state.js';
import type { NodePath } from '../types.js';

const {
  typeOf,
  shapeOf,
  unionOptions,
  discriminatorOf,
  arrayElement,
  tupleItems,
  literalValues,
  lazyTarget,
} = _internal;

export const InspectorPane: React.FC = () => {
  const doc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);

  return (
    <div className="pane-inspector-body">
      <header className="pane-header">Inspector</header>
      {selection === null ? (
        <div className="inspector-empty">
          Select a node in the outline to edit it.
        </div>
      ) : (
        <InspectorBody doc={doc} selection={selection} />
      )}
    </div>
  );
};

const InspectorBody: React.FC<{
  doc: unknown;
  selection: NodePath;
}> = ({ doc, selection }) => {
  const subSchema = sliceSchema(
    templateDocSchema as unknown as z.ZodTypeAny,
    doc,
    selection
  );
  const subValue = getAtPath(doc, selection);

  const onChange = (next: unknown) => {
    useEditorStore
      .getState()
      .patchDoc((current) => setAtPath(current, selection, next));
  };

  return (
    <div className="inspector-body">
      <div className="inspector-breadcrumb" title={formatBreadcrumb(selection)}>
        {formatBreadcrumb(selection)}
      </div>
      {subSchema ? (
        <SchemaForm
          schema={subSchema}
          value={subValue}
          onChange={onChange}
          path={selection}
        />
      ) : (
        <div className="inspector-empty">
          No schema for this path. Selection:{' '}
          <code>{formatBreadcrumb(selection)}</code>
        </div>
      )}
    </div>
  );
};

function formatBreadcrumb(path: NodePath): string {
  if (path.length === 0) return '(root)';
  return path.map((k) => String(k)).join(' › ');
}

/**
 * Walk `schema` following `path` and return the schema of the addressed sub-node.
 * Walks the doc in parallel so it can disambiguate discriminated-union
 * variants by the current value's discriminator field.
 */
function sliceSchema(
  rootSchema: z.ZodTypeAny,
  rootValue: unknown,
  path: NodePath
): z.ZodTypeAny | undefined {
  let schema: z.ZodTypeAny | undefined = rootSchema;
  let value: unknown = rootValue;

  for (const segment of path) {
    if (!schema) return undefined;
    schema = unwrapAll(schema);

    const t = typeOf(schema);

    if (t === 'object') {
      const shape = shapeOf(schema);
      const next = shape[String(segment)];
      if (!next) return undefined;
      schema = next;
      value = pluck(value, segment);
      continue;
    }

    if (t === 'array') {
      schema = arrayElement(schema);
      value = Array.isArray(value) ? value[Number(segment)] : undefined;
      continue;
    }

    if (t === 'tuple') {
      const items = tupleItems(schema);
      const idx = Number(segment);
      const next = items[idx];
      if (!next) return undefined;
      schema = next;
      value = Array.isArray(value) ? value[idx] : undefined;
      continue;
    }

    if (t === 'union') {
      const disc = discriminatorOf(schema);
      if (!disc) return undefined;
      const tag =
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)[disc]
          : undefined;
      const variant = unionOptions(schema).find((opt) => {
        if (typeOf(opt) !== 'object') return false;
        const optShape = shapeOf(opt);
        const ts = optShape[disc];
        if (!ts || typeOf(ts) !== 'literal') return false;
        return literalValues(ts)[0] === tag;
      });
      if (!variant) return undefined;
      const next = shapeOf(variant)[String(segment)];
      if (!next) return undefined;
      schema = next;
      value = pluck(value, segment);
      continue;
    }

    if (t === 'lazy') {
      schema = lazyTarget(schema);
      // Re-process this segment against the resolved schema. The loop will
      // re-run unwrapAll at the top of the next iteration, so we need to feed
      // the segment back in. Simulate by manually re-entering the dispatch:
      const resolved = unwrapAll(schema);
      const rt = typeOf(resolved);
      if (rt === 'object') {
        const next = shapeOf(resolved)[String(segment)];
        if (!next) return undefined;
        schema = next;
        value = pluck(value, segment);
        continue;
      }
      if (rt === 'union') {
        const disc = discriminatorOf(resolved);
        if (!disc) return undefined;
        const tag =
          value !== null && typeof value === 'object'
            ? (value as Record<string, unknown>)[disc]
            : undefined;
        const variant = unionOptions(resolved).find((opt) => {
          if (typeOf(opt) !== 'object') return false;
          const optShape = shapeOf(opt);
          const ts = optShape[disc];
          if (!ts || typeOf(ts) !== 'literal') return false;
          return literalValues(ts)[0] === tag;
        });
        if (!variant) return undefined;
        const next = shapeOf(variant)[String(segment)];
        if (!next) return undefined;
        schema = next;
        value = pluck(value, segment);
        continue;
      }
      return undefined;
    }

    // Unknown schema kind for further descent.
    return undefined;
  }

  return schema ? unwrapAll(schema) : undefined;
}

function pluck(value: unknown, segment: string | number): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const idx = typeof segment === 'number' ? segment : Number(segment);
    return value[idx];
  }
  if (typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>)[String(segment)];
}

/** Strip optional/nullable/default/pipe/lazy wrappers all the way down. */
function unwrapAll(schema: z.ZodTypeAny): z.ZodTypeAny {
  let cursor = unwrapSchema(schema).schema;
  for (let i = 0; i < 4; i++) {
    if (typeOf(cursor) === 'lazy') {
      cursor = unwrapSchema(lazyTarget(cursor)).schema;
      continue;
    }
    break;
  }
  return cursor;
}
