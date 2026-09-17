import type React from 'react';
import type { VideoConfig } from '../types/video-config';
import { BRollLayer } from './b-roll-layer';
import { MusicLayer } from './music-layer';
import { SquareOfferPane } from './square-offer-pane';

export interface SquareOfferCompositionProps extends VideoConfig {}

/**
 * SquareOfferComposition — 1080x1080 side-by-side layout for offer videos.
 *
 * +-------------------+-------------+
 * |                   |             |
 * |  Video Pane       |  Offer Pane |
 * |  648px (3/5)      |  432px (2/5)|
 * |                   |             |
 * +-------------------+-------------+
 *
 * Left: B-roll footage (muted, cropped to 648x1080)
 * Right: White-background offer card with headline, bullets, CTA
 * Audio: MusicLayer only (no talking head, no narration)
 *
 * No outro, no captions, no pip overlays for this composition.
 */
export const SquareOfferComposition: React.FC<SquareOfferCompositionProps> = ({
  scenes,
  fps,
  durationInFrames,
  variationId,
  music,
  offerCard,
}) => {
  if (!offerCard) {
    throw new Error(
      'SquareOfferComposition: offerCard is required. ' +
        'This composition is designed for offer videos with a side-by-side layout.'
    );
  }

  return (
    <div
      style={{
        width: 1080,
        height: 1080,
        display: 'flex',
        flexDirection: 'row',
        backgroundColor: '#000',
      }}
    >
      {/* Left: Video pane (3/5 = 648px) */}
      <div
        style={{
          width: 648,
          height: 1080,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <BRollLayer scenes={scenes} fps={fps} variationId={variationId} />
      </div>

      {/* Right: Offer pane (2/5 = 432px) */}
      <SquareOfferPane
        card={offerCard}
        fps={fps}
        durationInFrames={durationInFrames}
      />

      {/* Music (audio only, no visual) */}
      {music && <MusicLayer config={music} fps={fps} />}
    </div>
  );
};
