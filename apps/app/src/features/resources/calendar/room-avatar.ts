import {
  RESOURCE_COLOR_HEX,
  type ResourceColor,
} from '../components/resource-colors';

/**
 * A room's "avatar" — its colour, as an inline SVG data URI.
 *
 * WHY THIS EXISTS. The shared column header renders an `<Avatar>` with an
 * initials fallback, which is right for a person and wrong for a room: the
 * first cut of this calendar showed rooms as grey circles reading "R1", "R2",
 * "U", as though Room 1 were a colleague whose initials you should recognise.
 *
 * `picturePath` is the header's designed image slot, so rather than fork the
 * shared component we give it the image a room actually has: a filled chip in
 * the room's own calendar colour, matching the tint its blocks carry in the
 * grid below. The header then teaches the colour instead of hiding it.
 *
 * A room with NO colour still gets a chip, in neutral slate. Returning null
 * would fall through to the shared `<Avatar>`'s initials fallback — which is
 * how the first cut rendered "R1" and "R2" — and a room is never a person,
 * whether or not anyone has picked its colour. Rooms created before colours
 * were auto-assigned would otherwise wear initials forever.
 */
export function roomAvatarDataUri(color: string | null | undefined): string {
  const hex =
    (color ? RESOURCE_COLOR_HEX[color as ResourceColor] : undefined) ??
    // Reads as "no colour chosen" without reading as broken.
    '#94a3b8';

  // A rounded square rather than a disc: it reads as a space/room, and it
  // distinguishes a room column from a person column at a glance.
  // The shared header Avatar is a fixed 56px — sized for a person's photo, which
  // made a full-bleed door glyph read as a slab. The tint still fills the circle
  // so the chip looks deliberate, but the door itself is drawn small and centred.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="${hex}" opacity="0.16"/><rect x="15.5" y="13" width="9" height="14" rx="1.8" fill="${hex}"/><circle cx="22.4" cy="20" r="0.9" fill="#fff" opacity="0.95"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The "Unassigned" column's chip: a dashed outline, i.e. a room-shaped hole.
 *
 * Same reasoning as above — this column means "no room yet", and the initials
 * fallback rendered it as "U", which looks like a person called U.
 */
export function unassignedAvatarDataUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="15.75" y="13.25" width="8.5" height="13.5" rx="1.8" fill="none" stroke="#94a3b8" stroke-width="1.3" stroke-dasharray="2.6 2.2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
