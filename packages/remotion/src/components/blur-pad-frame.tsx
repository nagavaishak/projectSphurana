import type React from 'react';
import { AbsoluteFill } from 'remotion';

/**
 * Blur-pad: a blurred, scaled-up copy of the media fills the frame while the
 * media itself is fitted inside it (objectFit: contain), so nothing is cropped.
 *
 * Why this exists: the licensed stock bank is overwhelmingly 16:9 (216 of 261
 * clips) while the compositions are 1080x1920 portrait. Cropping to fill throws
 * away roughly half of every landscape frame — usually the half containing the
 * practitioner's hands and the instrument, which is the whole point of the shot.
 *
 * Cost: the background decodes the source a second time. That is affordable
 * only because clips are normalised to 720p landscape / 1080x1920 portrait
 * before ingest — two 720p decodes are far cheaper than one 4K decode. Pass
 * `fillsFrame` when the source already matches the composition aspect ratio to
 * skip the second decode entirely.
 */
export const BLUR_BACKGROUND_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  filter: 'blur(24px) brightness(0.7)',
  transform: 'scale(1.15)',
};

/** Media fitted inside the frame without cropping. */
export const CONTAIN_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
};

export interface BlurPadFrameProps {
  /** Blurred cover-fitted copy painted behind. Omitted when `fillsFrame`. */
  background: React.ReactNode;
  /** The media itself, contain-fitted. */
  foreground: React.ReactNode;
  /**
   * True when the source already covers the frame, so the blurred copy would be
   * invisible and only cost decode work. Callers pass this when the source
   * aspect ratio is known to match the composition.
   */
  fillsFrame?: boolean;
}

export const BlurPadFrame: React.FC<BlurPadFrameProps> = ({
  background,
  foreground,
  fillsFrame,
}) => (
  <AbsoluteFill style={{ overflow: 'hidden' }}>
    {!fillsFrame && background}
    <AbsoluteFill
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {foreground}
    </AbsoluteFill>
  </AbsoluteFill>
);
