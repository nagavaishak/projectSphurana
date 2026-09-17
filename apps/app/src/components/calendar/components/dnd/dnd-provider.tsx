import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import {
  MouseTransition,
  MultiBackend,
  TouchTransition,
} from 'react-dnd-multi-backend';
import { TouchBackend } from 'react-dnd-touch-backend';

import { CustomDragLayer } from '@/components/calendar/components/dnd/custom-drag-layer';

interface DndProviderWrapperProps {
  children: React.ReactNode;
}

/**
 * Multi-backend pipeline: HTML5 native drag on desktop pointers, TouchBackend
 * on touch devices (iOS/Android WebView via Capacitor — the HTML5 backend
 * doesn't see synthetic touch drag events there).
 *
 * `delayTouchStart: 150` lets vertical scroll gestures win unless the user
 * actually long-presses, otherwise every drag-attempt would hijack scrolling
 * in the time grid.
 */
const HTML5toTouch = {
  backends: [
    {
      id: 'html5',
      backend: HTML5Backend,
      transition: MouseTransition,
    },
    {
      id: 'touch',
      backend: TouchBackend,
      options: {
        enableMouseEvents: false,
        delayTouchStart: 150,
      },
      transition: TouchTransition,
      preview: true,
    },
  ],
};

export function DndProviderWrapper({ children }: DndProviderWrapperProps) {
  return (
    <DndProvider backend={MultiBackend} options={HTML5toTouch}>
      {children}
      <CustomDragLayer />
    </DndProvider>
  );
}
