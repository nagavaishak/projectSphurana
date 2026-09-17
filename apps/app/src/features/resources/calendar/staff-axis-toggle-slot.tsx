import { useResourceScheduling } from '@/features/resources/booking';

import { RoomsAxisToggle } from './rooms-axis-toggle';

/**
 * The Staff ⇄ Rooms toggle, as rendered on the STAFF calendar.
 *
 * WHY THIS EXISTS SEPARATELY. The toggle shipped rendered only from the rooms
 * calendar's own header, which made the whole axis unreachable: you could go
 * rooms → team, but nothing on the team calendar pointed the other way, so the
 * rooms calendar could only be opened by typing its URL.
 *
 * Gated on the org actually having a room. A clinic that has never set one up
 * gets no toggle and no hint of one — same progressive-disclosure rule the
 * booking dialog and the service editor follow.
 */
export function StaffAxisToggleSlot() {
  const { enabled } = useResourceScheduling();
  if (!enabled) return null;
  return <RoomsAxisToggle axis="team" />;
}
