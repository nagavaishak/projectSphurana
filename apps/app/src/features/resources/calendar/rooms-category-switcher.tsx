import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { useRoomsCalendar } from './rooms-calendar-context';

/**
 * Rooms / Lasers / … segmented control.
 *
 * Requirements bind at the CATEGORY level, and an appointment can hold one
 * resource per category — so "which category am I looking at" is what decides
 * both the columns and which requirement slot a drag reassigns. Hidden when the
 * org has a single category, where the choice would be noise.
 */
export function RoomsCategorySwitcher() {
  const rooms = useRoomsCalendar();
  if (!rooms || rooms.categories.length < 2) return null;

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={rooms.selectedCategoryId}
      onValueChange={(value) => {
        // Radix clears the value when the active item is re-pressed; a
        // calendar with no category has no columns, so ignore that.
        if (value) rooms.setSelectedCategoryId(value);
      }}
      aria-label="Resource category"
    >
      {rooms.categories.map((category) => (
        <ToggleGroupItem key={category.id} value={category.id}>
          {category.name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
