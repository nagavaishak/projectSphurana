/**
 * Shared bits for the mobile Daily summary page: the compact overflow (⋯) menu that carries the desktop "Options / Export" actions, and a
 * small formatting helper. Only `daily-summary-mobile.tsx` still uses these —
 * every other Sales page now renders one `ListPage` at both viewports.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MOBILE_FILTER_CHROME_CLASS } from '@/features/mobile-ui';
import { cn } from '@/lib/utils';
import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';

/** Joins the parts of a row's subtitle/meta line, skipping empties. */
export function joinMeta(...parts: (string | number | null | undefined)[]) {
  return parts.filter(Boolean).join(' · ');
}

/** The desktop "Options / Export" dropdown, shrunk to a 38px ⋯ control. */
export function SalesMobileOptionsMenu({
  onExportCsv,
  disabled,
  children,
}: {
  onExportCsv: () => void;
  disabled?: boolean;
  /** Extra menu items rendered above "Export as CSV" (e.g. sort). */
  children?: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Options"
          className={cn(
            'flex size-[38px] shrink-0 items-center justify-center',
            MOBILE_FILTER_CHROME_CLASS
          )}
        >
          <MoreHorizontal className="size-4 text-black" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {children}
        <DropdownMenuItem disabled={disabled} onSelect={onExportCsv}>
          Export as CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Row of filter controls under the mobile search field. */
export function SalesMobileControls({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
