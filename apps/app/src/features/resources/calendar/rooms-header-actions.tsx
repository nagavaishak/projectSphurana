import { RoomsCategorySwitcher } from './rooms-category-switcher';

/**
 * What the rooms calendar adds to the LEFT of the shared toolbar, beside the
 * resource multi-select it filters alongside.
 *
 * The Staff ⇄ Rooms toggle deliberately does NOT live here. It exists on both
 * calendars and means the same thing on each, so it is rendered through
 * `config.headerAxisToggle` instead — pinned immediately after the team /
 * resource picker on both. Here it sat at the tail of a row whose width is the
 * category switcher's, so it slid sideways as categories appeared and vanished
 * as you switched calendars, moving out from under the cursor that had just
 * clicked it.
 */
export function RoomsHeaderActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RoomsCategorySwitcher />
    </div>
  );
}
