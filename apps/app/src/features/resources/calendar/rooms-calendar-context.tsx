import { createContext, useContext } from 'react';

import type {
  Resource,
  ResourceCategory,
} from '@borradh-workspace/api-client/types';

/**
 * Rooms-specific state the shared calendar context has no slot for.
 *
 * `config.staffHeaderMenu` is a plain component type — the library gives it the
 * column and nothing else — so the utilisation figures and the category
 * selection reach the header through here rather than by widening
 * `ICalendarConfig`.
 */
export interface RoomsCalendarContextValue {
  categories: ResourceCategory[];
  selectedCategoryId: string;
  setSelectedCategoryId: (categoryId: string) => void;
  resourceById: Map<string, Resource>;
  /** resourceId → utilisation over the selected day, 0..1. */
  /**
   * Utilisation per room, WITH the denominator that produced it.
   *
   * `openMinutes` is carried because 0% and "there were no open minutes to
   * fill" are different facts that otherwise render identically — see
   * `UtilisationLabel`.
   */
  utilisationByResourceId: Map<
    string,
    { utilisation: number; openMinutes: number }
  >;
}

const RoomsCalendarContext = createContext<RoomsCalendarContextValue | null>(
  null
);

export const RoomsCalendarContextProvider = RoomsCalendarContext.Provider;

/** Null outside the rooms calendar, so shared components stay safe to render. */
export function useRoomsCalendar(): RoomsCalendarContextValue | null {
  return useContext(RoomsCalendarContext);
}
