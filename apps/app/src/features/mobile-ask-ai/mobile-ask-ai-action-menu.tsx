import {
  CalendarPlus,
  ImagePlus,
  LayoutGrid,
  type LucideIcon,
  Megaphone,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { mobileAskAiDockBottomWhenStacked } from '@/features/mobile-bottom-tabs/mobile-bottom-tabs-layout';

import { cn } from '@/lib/utils';

/** Matches `MobileAskAiDock` side action width for `right` inset. */
const DOCK_SIDE_BUTTON_PX = 46;

export type MobileAskAiCreateActionId =
  | 'content'
  | 'appointment'
  | 'advertisement'
  | 'post';

/** Labels only (no subtitles) — parity with `animated-action-menu` + bottom-bar items. */
const ITEMS: {
  id: MobileAskAiCreateActionId;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: 'content', label: 'Create Content', icon: LayoutGrid },
  { id: 'appointment', label: 'Create Appointment', icon: CalendarPlus },
  { id: 'advertisement', label: 'Create Advertisement', icon: Megaphone },
  { id: 'post', label: 'Create Post', icon: ImagePlus },
];

interface MobileAskAiActionMenuProps {
  open: boolean;
  /** Same as dock — menu bottom aligns with dock so it sits beside the + control, not on the tab bar. */
  stackAboveMobileTabBar?: boolean;
  onClose: () => void;
  onSelect: (id: MobileAskAiCreateActionId) => void;
}

function menuPanelStyle(stackAboveMobileTabBar: boolean): CSSProperties {
  const bottom = stackAboveMobileTabBar
    ? mobileAskAiDockBottomWhenStacked()
    : { bottom: 'max(10px, env(safe-area-inset-bottom, 0px))' };
  return {
    ...bottom,
    left: '1rem',
    right: `calc(1rem + ${DOCK_SIDE_BUTTON_PX * 1.125}px)`,
  };
}

/**
 * Create menu — layout + motion tokens from `ask-ai-clone/.../animated-action-menu.tsx`
 * and anchor from `bottom-bar` (`offset` + `inlineCreateMenu` right inset).
 */
export function MobileAskAiActionMenu({
  open,
  stackAboveMobileTabBar = false,
  onClose,
  onSelect,
}: MobileAskAiActionMenuProps) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), 160);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        className="absolute inset-0 bg-transparent"
        aria-label="Close create menu"
        onClick={onClose}
      />
      <div
        className={cn(
          'absolute origin-bottom rounded-[22px] bg-white px-2.5 py-2 shadow-[0_8px_18px_rgba(0,0,0,0.12)] transition-[opacity,transform] duration-200 ease-out',
          open
            ? 'translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none translate-y-4 scale-[0.98] opacity-0'
        )}
        style={menuPanelStyle(stackAboveMobileTabBar)}
        role="menu"
        aria-label="Create"
      >
        <ul className="flex flex-col">
          {ITEMS.map((item, index) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  role="menuitem"
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left text-[14px] font-semibold transition-[opacity,transform] duration-200 ease-out hover:bg-[#FBFBFB] active:bg-[#F0F0F5]',
                    open
                      ? 'translate-y-0 opacity-100'
                      : 'translate-y-2.5 opacity-0'
                  )}
                  style={{ transitionDelay: open ? `${index * 26}ms` : '0ms' }}
                  onClick={() => {
                    onSelect(item.id);
                    onClose();
                  }}
                >
                  <Icon
                    className="size-5 shrink-0 text-black"
                    strokeWidth={2}
                  />
                  <span className="min-w-0 flex-1 text-black">
                    {item.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
