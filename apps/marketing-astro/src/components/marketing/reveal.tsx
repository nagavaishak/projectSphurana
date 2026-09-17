'use client';

import { cn } from '@/lib/utils';
import { motion } from 'motion/react';
import type React from 'react';

/**
 * Fade + rise into view on scroll. Used across sections to give the page a
 * gentle, progressive reveal as the visitor moves down.
 */
export const Reveal = ({
  children,
  className,
  delay = 0,
  y = 24,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) => (
  <motion.div
    initial={{ opacity: 0, y }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-80px' }}
    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay }}
    className={cn('w-full', className)}
  >
    {children}
  </motion.div>
);
