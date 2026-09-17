import {
  type TemplateDoc,
  educational1,
} from '@borradh-workspace/video-templates';
import { type ChangeEvent, useState } from 'react';
import { useEditorStore } from '../state';

// Registry of bundled sample templates the user can load with one click.
// Add new entries here as more templates land in `@borradh-workspace/video-templates`.
const SAMPLES: ReadonlyArray<{ key: string; label: string; doc: TemplateDoc }> =
  [{ key: 'educational1', label: 'Educational 1', doc: educational1 }];

// Sample template dropdown. Lives in the toolbar between the existing button
// groups. Picking a sample replaces the doc via `setDoc`; the store's debounced
// re-synth will refresh the preview.
export const SamplePicker = () => {
  const setDoc = useEditorStore((s) => s.setDoc);
  const [value, setValue] = useState('');

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const key = e.target.value;
    setValue(''); // reset so the same item can be re-picked
    if (!key) return;
    const entry = SAMPLES.find((s) => s.key === key);
    if (!entry) return;
    setDoc(entry.doc);
  };

  return (
    <select
      aria-label="Load sample template"
      title="Load a sample template"
      value={value}
      onChange={handleChange}
      style={{
        padding: '6px 8px',
        fontSize: 12,
        background: 'var(--bg-elev, #2a2a2a)',
        color: 'var(--fg, #eee)',
        border: '1px solid var(--border, #444)',
        borderRadius: 4,
        cursor: 'pointer',
      }}
    >
      <option value="">Sample template…</option>
      {SAMPLES.map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </select>
  );
};
