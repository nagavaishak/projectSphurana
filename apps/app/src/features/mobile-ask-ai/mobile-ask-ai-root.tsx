import { GlobalSearch } from '@/components/app/global-search';
import { ROUTES } from '@/lib/route-paths';
import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MobileAskAiActionMenu,
  type MobileAskAiCreateActionId,
} from './mobile-ask-ai-action-menu';
import { MobileAskAiDock } from './mobile-ask-ai-dock';
import { MobileAskAiSheet } from './mobile-ask-ai-sheet';
import { useMobileAskAiDockScrollHide } from './use-mobile-ask-ai-dock-scroll-hide';

/** Match `bottom-bar` sequence: compress dock → delay → show menu (≈85+20+90ms). */
const MENU_OPEN_DELAY_MS = 200;
const MENU_CLOSE_DELAY_MS = 200;

export interface MobileAskAiRootProps {
  /** Lift dock above fixed mobile bottom tabs when both are visible. */
  stackAboveMobileTabBar?: boolean;
}

export function MobileAskAiRoot({
  stackAboveMobileTabBar = false,
}: MobileAskAiRootProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dockMenuCompress, setDockMenuCompress] = useState(false);
  const [menuPanelVisible, setMenuPanelVisible] = useState(false);
  const menuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMenuTimer = useCallback(() => {
    if (menuTimerRef.current !== null) {
      clearTimeout(menuTimerRef.current);
      menuTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearMenuTimer(), [clearMenuTimer]);

  const collapseDockChrome = useCallback(() => {
    clearMenuTimer();
    setMenuPanelVisible(false);
    setDockMenuCompress(false);
  }, [clearMenuTimer]);

  const closeCreateMenu = useCallback(() => {
    clearMenuTimer();
    setMenuPanelVisible(false);
    menuTimerRef.current = setTimeout(() => {
      setDockMenuCompress(false);
      menuTimerRef.current = null;
    }, MENU_CLOSE_DELAY_MS);
  }, [clearMenuTimer]);

  const toggleCreateMenu = useCallback(() => {
    if (menuPanelVisible) {
      closeCreateMenu();
      return;
    }
    clearMenuTimer();
    setDockMenuCompress(true);
    menuTimerRef.current = setTimeout(() => {
      setMenuPanelVisible(true);
      menuTimerRef.current = null;
    }, MENU_OPEN_DELAY_MS);
  }, [menuPanelVisible, closeCreateMenu, clearMenuTimer]);

  const pinnedForDockScroll =
    searchOpen || sheetOpen || menuPanelVisible || dockMenuCompress;
  const dockHiddenByScroll = useMobileAskAiDockScrollHide({
    pinned: pinnedForDockScroll,
  });

  useEffect(() => {
    if (dockHiddenByScroll) collapseDockChrome();
  }, [dockHiddenByScroll, collapseDockChrome]);

  const onCreateSelect = useCallback(
    (id: MobileAskAiCreateActionId) => {
      switch (id) {
        case 'content':
          void navigate({ to: routes.content });
          break;
        case 'appointment':
          void navigate({ to: routes.calendarDay });
          break;
        case 'advertisement':
          void navigate({
            to: ROUTES.adsNew,
            search: { campaignId: undefined },
          });
          break;
        case 'post':
          void navigate({ to: routes.contentCalendar });
          break;
        default:
          break;
      }
    },
    [navigate, routes]
  );

  return (
    <>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <MobileAskAiDock
        menuOpen={dockMenuCompress}
        stackAboveMobileTabBar={stackAboveMobileTabBar}
        recessedByScroll={dockHiddenByScroll}
        onOpenSearch={() => {
          collapseDockChrome();
          setSearchOpen(true);
        }}
        onOpenAskAi={() => {
          collapseDockChrome();
          setSheetOpen(true);
        }}
        onToggleCreateMenu={toggleCreateMenu}
      />
      <MobileAskAiActionMenu
        open={menuPanelVisible}
        stackAboveMobileTabBar={stackAboveMobileTabBar}
        onClose={closeCreateMenu}
        onSelect={onCreateSelect}
      />
      <MobileAskAiSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
}
