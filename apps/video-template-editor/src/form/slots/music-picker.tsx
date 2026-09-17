// Music picker for Slot<MusicSelection>: a dropdown of shared tracks plus a
// volume slider. The dropdown label includes BPM so authors can pick a track
// that matches the template's beat-synced cuts at a glance.

import { SHARED_MUSIC_TRACKS } from '@borradh-workspace/video-templates';
import type React from 'react';
import { pathKey } from '../../lib/node-path.js';
import type { NodePath } from '../../types.js';

export interface MusicSelection {
  trackId: string;
  volume: number;
}

export interface MusicPickerProps {
  value: MusicSelection | undefined;
  onChange: (next: MusicSelection) => void;
  path: NodePath;
}

export const MusicPicker: React.FC<MusicPickerProps> = ({
  value,
  onChange,
  path,
}) => {
  const trackId = value?.trackId ?? '';
  const volume = value?.volume ?? 1;

  const trackSelectId = pathKey([...path, 'trackId']);
  const volumeId = pathKey([...path, 'volume']);

  return (
    <div className="schema-form-slot-music">
      <div className="schema-form-field" data-path={trackSelectId}>
        <label className="schema-form-label" htmlFor={trackSelectId}>
          track
        </label>
        <div className="schema-form-control">
          <select
            id={trackSelectId}
            value={trackId}
            onChange={(e) => onChange({ trackId: e.target.value, volume })}
          >
            {trackId === '' ? (
              <option value="" disabled>
                select…
              </option>
            ) : null}
            {SHARED_MUSIC_TRACKS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
                {t.bpm !== undefined ? ` — ${t.bpm} bpm` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="schema-form-field" data-path={volumeId}>
        <label className="schema-form-label" htmlFor={volumeId}>
          volume
        </label>
        <div
          className="schema-form-control"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <input
            id={volumeId}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            style={{ flex: 1 }}
            onChange={(e) =>
              onChange({
                trackId,
                volume: Number(e.target.value),
              })
            }
          />
          <span
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: 11,
              color: 'var(--fg-muted)',
              minWidth: 40,
              textAlign: 'right',
            }}
          >
            {volume.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
};
