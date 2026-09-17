import type React from 'react';
import type { OutroLayoutConfig } from '../../types/outro-layouts';
import { OutroLocation } from './outro-location';
import { OutroOffer } from './outro-offer';
import { OutroTagline } from './outro-tagline';

export interface OutroLayoutRendererProps {
  config: OutroLayoutConfig;
}

/**
 * Renders the appropriate outro layout based on the layout type in config.
 * The worker defaults to 'location' — the logo + location clinic card.
 */
export const OutroLayoutRenderer: React.FC<OutroLayoutRendererProps> = ({
  config,
}) => {
  switch (config.layout) {
    case 'location':
      return <OutroLocation config={config} />;
    case 'offer':
      return <OutroOffer config={config} />;
    default:
      return <OutroTagline config={config} />;
  }
};
