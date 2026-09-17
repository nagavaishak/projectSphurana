'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A minimal dropdown menu — the one primitive the portal needed that
 * marketing-astro does not already have.
 *
 * apps/app used `@radix-ui/react-dropdown-menu`. That package is not installed
 * here, and the portal's entire use of it is a single-item account menu, so
 * this is a ~100-line local implementation instead of a new dependency in a
 * package.json another agent is concurrently editing. It keeps the parts of
 * Radix that a menu is not a menu without: Escape closes, an outside click
 * closes, focus returns to the trigger, arrow keys move between items, and the
 * trigger carries `aria-haspopup`/`aria-expanded`.
 *
 * If this ever needs submenus, checkboxes or a portal, swap it for Radix
 * rather than growing it.
 */

interface MenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const MenuContext = React.createContext<MenuContextValue | null>(null);

function useMenu(): MenuContextValue {
  const ctx = React.useContext(MenuContext);
  if (!ctx) throw new Error('DropdownMenu parts must be used together');
  return ctx;
}

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const value = React.useMemo(() => ({ open, setOpen, triggerRef }), [open]);

  return (
    <MenuContext.Provider value={value}>
      <div className="relative">{children}</div>
    </MenuContext.Provider>
  );
}

export function DropdownMenuTrigger({
  children,
  ...props
}: React.ComponentProps<'button'>) {
  const { open, setOpen, triggerRef } = useMenu();

  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  className,
  children,
  align = 'end',
}: {
  className?: string;
  children: React.ReactNode;
  align?: 'start' | 'end';
}) {
  const { open, setOpen, triggerRef } = useMenu();
  const contentRef = React.useRef<HTMLDivElement>(null);

  // Close on outside click / Escape, and hand focus back to the trigger so a
  // keyboard user is not dropped at the top of the document.
  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        contentRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen, triggerRef]);

  // Move focus into the menu on open.
  React.useEffect(() => {
    if (!open) return;
    contentRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();
  }, [open]);

  if (!open) return null;

  const items = () =>
    Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []
    );

  return (
    <div
      ref={contentRef}
      role="menu"
      className={cn(
        'absolute z-50 mt-2 min-w-40 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        align === 'end' ? 'right-0' : 'left-0',
        className
      )}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const all = items();
        const index = all.indexOf(document.activeElement as HTMLElement);
        const next =
          event.key === 'ArrowDown'
            ? (index + 1) % all.length
            : (index - 1 + all.length) % all.length;
        all[next]?.focus();
      }}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({
  className,
  onSelect,
  disabled,
  children,
}: {
  className?: string;
  onSelect?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { setOpen } = useMenu();

  const select = () => {
    if (disabled) return;
    setOpen(false);
    onSelect?.();
  };

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={select}
      className={cn(
        'flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none',
        'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
        className
      )}
    >
      {children}
    </button>
  );
}
