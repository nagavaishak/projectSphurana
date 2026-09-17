import { z } from 'zod';

// Transition token registry (§9). Used by media-track between clips. Wave 3
// will swap the renderer over to a registry of concrete CSS/Remotion transforms
// keyed by token; for now the value is just validated at the schema layer.
export const TRANSITION_TOKENS = ['cut', 'fade', 'slide', 'wipe'] as const;

export type TransitionToken = (typeof TRANSITION_TOKENS)[number];

export const transitionRef = z.enum(TRANSITION_TOKENS);
