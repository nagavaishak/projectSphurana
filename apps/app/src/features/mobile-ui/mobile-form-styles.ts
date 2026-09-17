import { cn } from '@/lib/utils';

/** Shared iOS-style input chrome for the mobile funnel forms. */
export const MOBILE_INPUT_CLASS =
  'h-[44px] w-full rounded-lg border border-[#E5E5EA] bg-white px-3 text-[15px] text-black placeholder:text-[#C7C7CC] focus:border-[#2E65F3] focus:outline-none focus:ring-1 focus:ring-[#2E65F3]';

export const MOBILE_SELECT_TRIGGER_CLASS = cn(
  MOBILE_INPUT_CLASS,
  'flex w-full items-center justify-between py-0 shadow-none',
  'h-11 min-h-11 max-h-11 !h-11 !min-h-11 !max-h-11',
  'data-[size=default]:!h-11 data-[size=sm]:!h-11',
  '[&_[data-slot=select-value]]:flex [&_[data-slot=select-value]]:items-center [&_[data-slot=select-value]]:text-[15px]'
);

export const MOBILE_TEXTAREA_CLASS =
  'min-h-[88px] w-full rounded-lg border border-[#E5E5EA] px-3 py-2 text-[15px] focus:border-[#2E65F3] focus:outline-none focus:ring-1 focus:ring-[#2E65F3]';

/** Full-width pill action button pinned at the bottom of a funnel step. */
export const MOBILE_PRIMARY_BUTTON_CLASS =
  'w-full rounded-full bg-foreground py-3 text-base font-semibold text-background';
