'use client';

import { ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import type { ListColumn, MobileRole } from './list-page-types';

/**
 * The phone rendering of the SAME column config the desktop table uses.
 *
 * Columns opt in by declaring a `mobile` role; anything without one is dropped
 * rather than squeezed. That is the point: there is no second, hand-written
 * mobile component per feature to drift from the table.
 *
 * The chrome is the house phone-list language from `features/mobile-ui`
 * (`MobileRecordList` / `MobileRecordRow`): one rounded white card, hairline
 * dividers, 15px medium title over a 13px muted line, and a chevron on rows
 * that go somewhere. Those metrics are duplicated here rather than imported
 * because this list carries two things `MobileRecordRow` has no slot for — a
 * leading `media` cell and a trailing row-actions menu — and a wrapper that
 * passed those through as `title`/`trailing` would put the menu where the value
 * belongs. Same look, one config, both viewports.
 */
export function MobileList<TRow>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowActions,
  rowTestId,
}: {
  columns: ListColumn<TRow>[];
  rows: TRow[];
  rowKey: (row: TRow) => string;
  onRowClick?: (row: TRow) => void;
  rowActions?: (row: TRow) => ReactNode;
  rowTestId?: (row: TRow) => string;
}) {
  const byRole = (role: MobileRole) =>
    columns.find((column) => column.mobile === role);

  const media = byRole('media');
  const primary = byRole('primary');
  const secondary = byRole('secondary');
  const trailing = byRole('trailing');

  /**
   * An EMPTY secondary or trailing cell renders nothing at all — and a lone
   * placeholder dash counts as empty.
   *
   * `'—'` for "no value" is a house convention in these cells (39 of them
   * across 21 files). On the desktop TABLE it earns its place: the column
   * header above says what the blank means, and a truly empty cell in a grid
   * reads as a rendering fault. A phone row has no header. There, the dash is
   * just a second line of nothing under every product without a brand — it
   * costs a line of height and pays back no information.
   *
   * Encoded here rather than in the 39 cells because it is one rule about how a
   * phone row differs from a table row, which is exactly what this component is
   * for. A cell that wraps its dash in an element is not caught; that is fine,
   * the rule is a courtesy and not a contract.
   */
  const hasContent = (value: ReactNode) => {
    if (value === null || value === undefined || value === false) return false;
    if (typeof value === 'string') return !/^[\s—–-]*$/.test(value);
    return true;
  };

  return (
    <ul className="flex flex-col divide-y divide-[#F0F0F0] overflow-hidden rounded-2xl border border-[#ECECEC] bg-white">
      {rows.map((row) => {
        const interactive = Boolean(onRowClick);
        const secondaryRendered = secondary?.cell(row);
        const secondaryValue = hasContent(secondaryRendered)
          ? secondaryRendered
          : null;
        const trailingRendered = trailing?.cell(row);
        const trailingValue = hasContent(trailingRendered)
          ? trailingRendered
          : null;
        const content = (
          <>
            {media && <div className="shrink-0">{media.cell(row)}</div>}

            <div className="min-w-0 flex-1">
              {/*
                `[&_*]:truncate` as well as `truncate`.

                `text-overflow: ellipsis` applies to a box's OWN inline content;
                it does not reach into a descendant block. Several cells return
                a wrapper div (Products' name cell nests the name and a
                desktop-only SKU inside one), so the wrapper here clipped the
                title mid-letter against the price with no ellipsis at all —
                which reads as a rendering fault rather than as "there is more
                text". Every DESCENDANT, not just the direct child: Products'
                cell is two levels deep (wrapper > name), and truncating only
                the wrapper moves the clip one level down without fixing it. The
                role is documented as one line of text, so truncating whatever
                is inside it is the intent, not a compromise.
              */}
              {primary && (
                <div className="truncate font-medium text-[15px] text-[#0A0A0A] [&_*]:truncate">
                  {primary.cell(row)}
                </div>
              )}
              {secondaryValue && (
                <div className="truncate text-[13px] text-[#737373] [&_*]:truncate">
                  {secondaryValue}
                </div>
              )}
            </div>

            {trailingValue && (
              <div className="shrink-0 font-medium text-[#0A0A0A] text-[15px]">
                {trailingValue}
              </div>
            )}

            {rowActions && (
              // A plain element, NOT a <button>.
              //
              // `rowActions(row)` renders its own trigger button ("Open menu"),
              // so wrapping it in a button nested one interactive element inside
              // another — invalid HTML, and the outer button swallowed the click
              // so the menu never opened. Row actions were simply unusable on
              // every mobile list.
              //
              // The wrapper exists only to stop the row's own click, so that a
              // tap on the menu does not also open the record behind it. A
              // keyboard user reaches the inner button directly, so this needs
              // no role, tabindex or key handling of its own.
              // biome-ignore lint/a11y/useKeyWithClickEvents: not interactive — see above
              <div
                className="shrink-0"
                onClick={(event) => event.stopPropagation()}
              >
                {rowActions(row)}
              </div>
            )}

            {/* The chevron only where there is somewhere to go. Row actions own
                the right edge when the row itself does not navigate. */}
            {interactive && !rowActions && (
              <ChevronRightIcon
                aria-hidden
                className="size-4 shrink-0 text-[#C7C7CC]"
              />
            )}
          </>
        );
        return (
          <li data-testid={rowTestId?.(row)} key={rowKey(row)}>
            {/*
              A REAL <button> when the row navigates, a plain div when it does
              not. A div with role="button" needs its own tabIndex and Enter/
              Space handling — exactly what gets forgotten — whereas the native
              element brings focus, keyboard activation and the right role for
              free. Both branches are written out rather than switching the tag
              dynamically, because a dynamic tag hides the button from the a11y
              linter, which is the check that caught this in the first place.
            */}
            {interactive ? (
              <button
                className={cn(
                  'flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left',
                  'transition active:bg-black/[0.03]'
                )}
                onClick={() => onRowClick?.(row)}
                type="button"
              >
                {content}
              </button>
            ) : (
              <div className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
