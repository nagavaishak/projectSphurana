import { Plus, Search, Sparkles } from 'lucide-react';

import { mobileAskAiDockBottomWhenStacked } from '@/features/mobile-bottom-tabs/mobile-bottom-tabs-layout';

import { cn } from '@/lib/utils';

interface MobileAskAiDockProps {
  menuOpen: boolean;
  /** When true, dock sits above the mobile bottom tab bar (Expo tab bar height). */
  stackAboveMobileTabBar?: boolean;
  /** Scroll-driven hide: dock slides down / fades out. */
  recessedByScroll?: boolean;
  onOpenSearch: () => void;
  onOpenAskAi: () => void;
  onToggleCreateMenu: () => void;
}

/** Bottom dock — visual parity with `ask-ai-clone/.../bottom-bar.tsx`. */
export function MobileAskAiDock({
  menuOpen,
  stackAboveMobileTabBar = false,
  recessedByScroll = false,
  onOpenSearch,
  onOpenAskAi,
  onToggleCreateMenu,
}: MobileAskAiDockProps) {
  return (
    <nav
      data-mobile-ask-ai-dock=""
      className={cn(
        // Below sticky `SiteHeader` (z-56) and mobile tab bar (z-55) so slide/fade runs underneath chrome.
        'pointer-events-none fixed inset-x-0 z-50 translate-y-0 opacity-100 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
        !stackAboveMobileTabBar && 'bottom-0',
        recessedByScroll &&
          'translate-y-[calc(100%+24px)] opacity-0 pointer-events-none'
      )}
      style={
        stackAboveMobileTabBar
          ? mobileAskAiDockBottomWhenStacked()
          : { paddingBottom: 'max(10px, env(safe-area-inset-bottom, 0px))' }
      }
      aria-label="Mobile navigation"
    >
      <div className="pointer-events-auto flex items-center justify-between gap-1.5 px-4">
        <div
          className={
            menuOpen
              ? 'pointer-events-none translate-y-5 opacity-0 transition-[opacity,transform] duration-[85ms] ease-out'
              : 'translate-y-0 opacity-100 transition-[opacity,transform] duration-[80ms] ease-out'
          }
        >
          <button
            type="button"
            className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-white shadow-[0_4px_10px_rgba(0,0,0,0.1)] active:scale-[0.98]"
            aria-label="Search"
            onClick={onOpenSearch}
          >
            <Search className="size-[18px] text-[#696867]" strokeWidth={2} />
          </button>
        </div>

        <div
          className={
            menuOpen
              ? 'pointer-events-none translate-y-6 opacity-0 transition-[opacity,transform] duration-[90ms] ease-out [transition-delay:20ms]'
              : 'min-w-0 flex-1 translate-y-0 opacity-100 transition-[opacity,transform] duration-[85ms] ease-out'
          }
        >
          <button
            type="button"
            className="flex h-[46px] w-full min-w-0 flex-1 items-center rounded-full bg-white px-2 shadow-[0_4px_10px_rgba(0,0,0,0.1)] active:scale-[0.98]"
            aria-label="Ask AI"
            onClick={onOpenAskAi}
          >
            <span className="flex size-[28px] shrink-0 items-center justify-center rounded-full border-2 border-[#E5E5E5] bg-white">
              <Sparkles className="size-3 text-[#696867]" strokeWidth={2} />
            </span>
            <span className="ml-1.5 truncate text-[13px] font-semibold text-[#737373]">
              Ask AI
            </span>
          </button>
        </div>

        <button
          type="button"
          className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-white shadow-[0_4px_10px_rgba(0,0,0,0.1)] active:scale-[0.98]"
          aria-label={menuOpen ? 'Close create menu' : 'Create menu'}
          aria-expanded={menuOpen}
          onClick={onToggleCreateMenu}
        >
          <Plus className="size-5 text-[#696867]" strokeWidth={2} />
        </button>
      </div>
    </nav>
  );
}
