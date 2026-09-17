// Shared query editor for any Slot<T>.
//
// SlotQuery is a discriminated union on `kind` with five variants
// (asset-clips | asset-media | script-text | music | brand). We render a kind
// picker plus per-kind fields. Reused across every slot since the query shape
// is the same regardless of the slot's value type.

import type React from 'react';
import { pathKey } from '../../lib/node-path.js';
import type { NodePath } from '../../types.js';

export type SlotQuery =
  | { kind: 'asset-clips'; tag: string; count: [number, number] }
  | { kind: 'asset-media'; tag: string; mediaType: 'image' | 'video' }
  | {
      kind: 'script-text';
      role: 'hook' | 'body' | 'cta' | 'disclaimer';
      index?: number;
    }
  | { kind: 'music'; mood?: string; bpm?: [number, number] }
  | {
      kind: 'brand';
      field: 'primaryColor' | 'logoUrl' | 'businessName';
    };

export interface QueryFormProps {
  value: SlotQuery | undefined;
  onChange: (next: SlotQuery) => void;
  path: NodePath;
}

const KIND_OPTIONS: SlotQuery['kind'][] = [
  'asset-clips',
  'asset-media',
  'script-text',
  'music',
  'brand',
];

function defaultForKind(kind: SlotQuery['kind']): SlotQuery {
  switch (kind) {
    case 'asset-clips':
      return { kind, tag: '', count: [1, 3] };
    case 'asset-media':
      return { kind, tag: '', mediaType: 'image' };
    case 'script-text':
      return { kind, role: 'hook' };
    case 'music':
      return { kind };
    case 'brand':
      return { kind, field: 'primaryColor' };
  }
}

export const QueryForm: React.FC<QueryFormProps> = ({
  value,
  onChange,
  path,
}) => {
  const kindId = pathKey([...path, 'kind']);
  const current = value;

  return (
    <div className="schema-form-slot-query">
      <div className="schema-form-field" data-path={kindId}>
        <label className="schema-form-label" htmlFor={kindId}>
          kind
        </label>
        <div className="schema-form-control">
          <select
            id={kindId}
            value={current?.kind ?? ''}
            onChange={(e) => {
              const next = e.target.value as SlotQuery['kind'];
              onChange(defaultForKind(next));
            }}
          >
            {current === undefined ? (
              <option value="" disabled>
                select…
              </option>
            ) : null}
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>

      {current?.kind === 'asset-clips' ? (
        <AssetClipsFields value={current} onChange={onChange} path={path} />
      ) : null}
      {current?.kind === 'asset-media' ? (
        <AssetMediaFields value={current} onChange={onChange} path={path} />
      ) : null}
      {current?.kind === 'script-text' ? (
        <ScriptTextFields value={current} onChange={onChange} path={path} />
      ) : null}
      {current?.kind === 'music' ? (
        <MusicQueryFields value={current} onChange={onChange} path={path} />
      ) : null}
      {current?.kind === 'brand' ? (
        <BrandFields value={current} onChange={onChange} path={path} />
      ) : null}
    </div>
  );
};

// ── Per-kind sub-fields ─────────────────────────────────────────────────

const AssetClipsFields: React.FC<{
  value: Extract<SlotQuery, { kind: 'asset-clips' }>;
  onChange: (next: SlotQuery) => void;
  path: NodePath;
}> = ({ value, onChange, path }) => {
  const tagId = pathKey([...path, 'tag']);
  const minId = pathKey([...path, 'count', 0]);
  const maxId = pathKey([...path, 'count', 1]);
  return (
    <>
      <div className="schema-form-field" data-path={tagId}>
        <label className="schema-form-label" htmlFor={tagId}>
          tag
        </label>
        <div className="schema-form-control">
          <input
            id={tagId}
            type="text"
            value={value.tag}
            onChange={(e) => onChange({ ...value, tag: e.target.value })}
          />
        </div>
      </div>
      <div className="schema-form-field" data-path={minId}>
        <label className="schema-form-label" htmlFor={minId}>
          count min
        </label>
        <div className="schema-form-control">
          <input
            id={minId}
            type="number"
            min={0}
            value={value.count[0]}
            onChange={(e) =>
              onChange({
                ...value,
                count: [Number(e.target.value) || 0, value.count[1]] as [
                  number,
                  number,
                ],
              })
            }
          />
        </div>
      </div>
      <div className="schema-form-field" data-path={maxId}>
        <label className="schema-form-label" htmlFor={maxId}>
          count max
        </label>
        <div className="schema-form-control">
          <input
            id={maxId}
            type="number"
            min={1}
            value={value.count[1]}
            onChange={(e) =>
              onChange({
                ...value,
                count: [value.count[0], Number(e.target.value) || 1] as [
                  number,
                  number,
                ],
              })
            }
          />
        </div>
      </div>
    </>
  );
};

const AssetMediaFields: React.FC<{
  value: Extract<SlotQuery, { kind: 'asset-media' }>;
  onChange: (next: SlotQuery) => void;
  path: NodePath;
}> = ({ value, onChange, path }) => {
  const tagId = pathKey([...path, 'tag']);
  const typeId = pathKey([...path, 'mediaType']);
  return (
    <>
      <div className="schema-form-field" data-path={tagId}>
        <label className="schema-form-label" htmlFor={tagId}>
          tag
        </label>
        <div className="schema-form-control">
          <input
            id={tagId}
            type="text"
            value={value.tag}
            onChange={(e) => onChange({ ...value, tag: e.target.value })}
          />
        </div>
      </div>
      <div className="schema-form-field" data-path={typeId}>
        <label className="schema-form-label" htmlFor={typeId}>
          mediaType
        </label>
        <div className="schema-form-control">
          <select
            id={typeId}
            value={value.mediaType}
            onChange={(e) =>
              onChange({
                ...value,
                mediaType: e.target.value as 'image' | 'video',
              })
            }
          >
            <option value="image">image</option>
            <option value="video">video</option>
          </select>
        </div>
      </div>
    </>
  );
};

const SCRIPT_ROLES = ['hook', 'body', 'cta', 'disclaimer'] as const;

const ScriptTextFields: React.FC<{
  value: Extract<SlotQuery, { kind: 'script-text' }>;
  onChange: (next: SlotQuery) => void;
  path: NodePath;
}> = ({ value, onChange, path }) => {
  const roleId = pathKey([...path, 'role']);
  const indexId = pathKey([...path, 'index']);
  return (
    <>
      <div className="schema-form-field" data-path={roleId}>
        <label className="schema-form-label" htmlFor={roleId}>
          role
        </label>
        <div className="schema-form-control">
          <select
            id={roleId}
            value={value.role}
            onChange={(e) =>
              onChange({
                ...value,
                role: e.target.value as (typeof SCRIPT_ROLES)[number],
              })
            }
          >
            {SCRIPT_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="schema-form-field" data-path={indexId}>
        <label className="schema-form-label" htmlFor={indexId}>
          index <span className="schema-form-optional">(optional)</span>
        </label>
        <div className="schema-form-control">
          <input
            id={indexId}
            type="number"
            min={0}
            value={value.index === undefined ? '' : value.index}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                const { index: _drop, ...rest } = value;
                onChange(rest);
                return;
              }
              const n = Number(raw);
              onChange({ ...value, index: Number.isFinite(n) ? n : 0 });
            }}
          />
        </div>
      </div>
    </>
  );
};

const MusicQueryFields: React.FC<{
  value: Extract<SlotQuery, { kind: 'music' }>;
  onChange: (next: SlotQuery) => void;
  path: NodePath;
}> = ({ value, onChange, path }) => {
  const moodId = pathKey([...path, 'mood']);
  const bpmMinId = pathKey([...path, 'bpm', 0]);
  const bpmMaxId = pathKey([...path, 'bpm', 1]);
  const bpm = value.bpm ?? [60, 180];
  const bpmEnabled = value.bpm !== undefined;
  return (
    <>
      <div className="schema-form-field" data-path={moodId}>
        <label className="schema-form-label" htmlFor={moodId}>
          mood <span className="schema-form-optional">(optional)</span>
        </label>
        <div className="schema-form-control">
          <input
            id={moodId}
            type="text"
            value={value.mood ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                const { mood: _drop, ...rest } = value;
                onChange(rest);
                return;
              }
              onChange({ ...value, mood: raw });
            }}
          />
        </div>
      </div>
      <div className="schema-form-field">
        <div className="schema-form-label">
          bpm range <span className="schema-form-optional">(optional)</span>
        </div>
        <div className="schema-form-control">
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginRight: 12,
            }}
          >
            <input
              type="checkbox"
              checked={bpmEnabled}
              onChange={(e) => {
                if (e.target.checked) {
                  onChange({ ...value, bpm: [60, 180] });
                } else {
                  const { bpm: _drop, ...rest } = value;
                  onChange(rest);
                }
              }}
            />
            enable
          </label>
          {bpmEnabled ? (
            <>
              <input
                id={bpmMinId}
                type="number"
                min={0}
                style={{ width: 70, marginRight: 4 }}
                value={bpm[0]}
                onChange={(e) =>
                  onChange({
                    ...value,
                    bpm: [Number(e.target.value) || 0, bpm[1]] as [
                      number,
                      number,
                    ],
                  })
                }
              />
              <span style={{ color: 'var(--fg-muted)' }}>–</span>
              <input
                id={bpmMaxId}
                type="number"
                min={0}
                style={{ width: 70, marginLeft: 4 }}
                value={bpm[1]}
                onChange={(e) =>
                  onChange({
                    ...value,
                    bpm: [bpm[0], Number(e.target.value) || 0] as [
                      number,
                      number,
                    ],
                  })
                }
              />
            </>
          ) : null}
        </div>
      </div>
    </>
  );
};

const BRAND_FIELDS = ['primaryColor', 'logoUrl', 'businessName'] as const;

const BrandFields: React.FC<{
  value: Extract<SlotQuery, { kind: 'brand' }>;
  onChange: (next: SlotQuery) => void;
  path: NodePath;
}> = ({ value, onChange, path }) => {
  const fieldId = pathKey([...path, 'field']);
  return (
    <div className="schema-form-field" data-path={fieldId}>
      <label className="schema-form-label" htmlFor={fieldId}>
        field
      </label>
      <div className="schema-form-control">
        <select
          id={fieldId}
          value={value.field}
          onChange={(e) =>
            onChange({
              ...value,
              field: e.target.value as (typeof BRAND_FIELDS)[number],
            })
          }
        >
          {BRAND_FIELDS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
