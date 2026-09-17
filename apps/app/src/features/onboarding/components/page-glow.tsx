import { motion } from 'motion/react';

/**
 * A blue glow that hugs the viewport edges and falls off toward the centre —
 * the "your analysis is complete" celebration. Rendered as a fixed
 * pointer-events-none overlay whose inset box-shadows layer from a bright
 * inner edge out to a soft, wide, low-intensity halo. Gently breathes.
 */
export function PageGlow() {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0.75] }}
      transition={{
        duration: 2.4,
        times: [0, 0.4, 1],
        repeat: Number.POSITIVE_INFINITY,
        repeatType: 'reverse',
        ease: 'easeInOut',
      }}
      style={{
        // Stacked inset shadows: tight + bright at the edge, then progressively
        // wider + fainter so the blue decreases in intensity moving inward.
        boxShadow: [
          'inset 0 0 24px 0 rgba(59,130,246,0.6)',
          'inset 0 0 60px 4px rgba(59,130,246,0.32)',
          'inset 0 0 120px 14px rgba(37,99,235,0.16)',
        ].join(', '),
      }}
    />
  );
}
