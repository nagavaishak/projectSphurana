import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';

interface SlideTransitionProps {
  /** Key identifying the current slide; changing it triggers the transition. */
  slideKey: string;
  children: ReactNode;
  className?: string;
}

/**
 * Vertical slide+fade between slides: the outgoing slide drifts up and fades
 * out, the incoming one enters from the bottom.
 */
export function SlideTransition({
  slideKey,
  children,
  className,
}: SlideTransitionProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={slideKey}
        className={className}
        initial={{ opacity: 0, y: 48 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -48 }}
        transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
