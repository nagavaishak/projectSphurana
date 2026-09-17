import { glassInteractiveClass } from '@/features/mobile-bottom-tabs/mobile-bottom-tabs-motion';
import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface MobileHeaderIconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  /** Visual size of the circular control (default 48px). */
  size?: 'md' | 'lg';
}

/**
 * Floating circular glass control — shared by the mobile dashboard header,
 * Ask AI sheet chrome, and future mobile toolbars.
 */
export function MobileHeaderIconButton({
  children,
  className,
  size = 'md',
  type = 'button',
  ...props
}: MobileHeaderIconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        glassInteractiveClass,
        'flex shrink-0 items-center justify-center rounded-full transition active:scale-[0.97]',
        'disabled:opacity-45 disabled:active:scale-100',
        size === 'lg' ? 'size-14' : 'size-12',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
