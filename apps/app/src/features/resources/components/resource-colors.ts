import { userColorLabels, userColorValues } from '@borradh-workspace/labels';

/**
 * The calendar-colour palette, shared with practitioners.
 *
 * `resource.color` is the SAME `user_color` enum the practitioner swatch grid
 * writes (see `features/practitioners/.../profile-panel.tsx`), which is what
 * lets the rooms calendar tint a room the same way it tints a practitioner.
 * The enum values are stored; the hex tints below exist only to paint the
 * swatch and the row dot — there is no theme token for "the 4th calendar
 * colour", so a token here would have to be invented rather than reused.
 */
export type ResourceColor = keyof typeof userColorLabels;

export const RESOURCE_COLOR_HEX: Record<ResourceColor, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  purple: '#a855f7',
  orange: '#f97316',
};

export {
  userColorLabels as resourceColorLabels,
  userColorValues as resourceColorValues,
};
