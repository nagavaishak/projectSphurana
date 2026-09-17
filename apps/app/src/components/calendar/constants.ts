/**
 * Calendar time-grid sizing. One hour is {@link HOUR_PX} tall and each 15-minute
 * slot is {@link SLOT_PX}. These drive both the visual grid (cell heights, event
 * block heights, hover slots) and the drag-to-reschedule snap math, so they must
 * stay in a single place — a mismatch makes events land on the wrong time.
 */
export const HOUR_PX = 100;

/** Height of one 15-minute slot (also the drag snap step). */
export const SLOT_PX = HOUR_PX / 4;

/**
 * How far an hour label overhangs ABOVE the row it belongs to, in px.
 *
 * The labels are positioned `-top-2.5` (10px) so they straddle their gridline
 * rather than sitting under it — which reads correctly mid-grid, but means the
 * topmost label extends 10px above the first visible row.
 *
 * Every time-grid view auto-scrolls to 09:00 on mount. Landing `scrollTop`
 * exactly on the hour boundary therefore pushed those 10px underneath the
 * sticky header, and the first label rendered visibly BISECTED — a half "09:00"
 * clipped against the header edge on the staff calendar, the rooms calendar and
 * both week views. Subtracting this on scroll leaves the label fully clear,
 * revealing a thin sliver of the hour above (which also hints there is earlier
 * content to scroll to).
 *
 * 12 rather than 10 for two pixels of breathing room.
 */
export const HOUR_LABEL_OVERHANG_PX = 12;
