'use client';
import { motion } from 'motion/react';

/**
 * Section 2 — social proof bar. One line, a row of clinic names, nothing else.
 */
export const LogoCloud = () => {
  const clinics = [
    'Hinoki Aesthetics',
    'Way Better Studios',
    'Radiance Clinic',
    'Bethel Wellness',
    'Revival Clinic',
    'Glow Aesthetics',
  ];
  return (
    <section className="border-y border-neutral-200 dark:border-neutral-800 py-10 md:py-12 bg-[#F8FAFC] dark:bg-neutral-900">
      <p className="text-neutral-500 dark:text-neutral-400 font-medium text-sm md:text-base text-center">
        Trusted by clinics across Ireland, the UK, and the US
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 md:gap-x-12 max-w-4xl mx-auto px-4">
        {clinics.map((name, index) => (
          <motion.span
            initial={{ opacity: 0, filter: 'blur(8px)' }}
            whileInView={{ opacity: 1, filter: 'blur(0px)' }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: index * 0.08 }}
            key={name}
            className="text-neutral-500 dark:text-neutral-400 font-semibold text-sm md:text-base whitespace-nowrap"
          >
            {name}
          </motion.span>
        ))}
      </div>
    </section>
  );
};
