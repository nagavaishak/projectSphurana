// Editor for Slot<string[]>: one textarea per item with add/remove buttons.

import type React from 'react';
import { pathKey } from '../../lib/node-path.js';
import type { NodePath } from '../../types.js';

export interface StringListFormProps {
  value: string[] | undefined;
  onChange: (next: string[]) => void;
  path: NodePath;
}

export const StringListForm: React.FC<StringListFormProps> = ({
  value,
  onChange,
  path,
}) => {
  const items = value ?? [];

  return (
    <div className="schema-form-slot-string-list">
      {items.length === 0 ? (
        <div className="schema-form-empty">empty</div>
      ) : null}
      {items.map((item, i) => {
        const id = pathKey([...path, i]);
        return (
          <div className="schema-form-array-row" key={String(i)} data-path={id}>
            <textarea
              id={id}
              rows={2}
              style={{ flex: 1, minWidth: 0 }}
              value={item}
              onChange={(e) => {
                const copy = items.slice();
                copy[i] = e.target.value;
                onChange(copy);
              }}
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
        );
      })}
      <button
        type="button"
        className="schema-form-array-add"
        onClick={() => onChange([...items, ''])}
      >
        + add item
      </button>
    </div>
  );
};
