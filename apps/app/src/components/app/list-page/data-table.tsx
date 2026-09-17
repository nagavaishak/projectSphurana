'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import type { ListColumn } from './list-page-types';

/**
 * The desktop table. Renders straight from the shared column config — no
 * per-feature `<TableHead>` markup, which is what ~12 hand-rolled list pages do
 * today.
 */
export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowActions,
  rowTestId,
  sort,
  onSortChange,
}: {
  columns: ListColumn<TRow>[];
  rows: TRow[];
  rowKey: (row: TRow) => string;
  onRowClick?: (row: TRow) => void;
  rowActions?: (row: TRow) => React.ReactNode;
  rowTestId?: (row: TRow) => string;
  sort?: { columnId: string; direction: 'asc' | 'desc' };
  onSortChange?: (next: {
    columnId: string;
    direction: 'asc' | 'desc';
  }) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead
              className={cn(
                'h-auto pb-3 font-normal text-muted-foreground text-sm',
                column.align === 'right' && 'text-right',
                column.width
              )}
              key={column.id}
            >
              {column.sortable && onSortChange ? (
                <button
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() =>
                    onSortChange({
                      columnId: column.id,
                      // Clicking the active column flips it; a new column
                      // starts ascending.
                      direction:
                        sort?.columnId === column.id && sort.direction === 'asc'
                          ? 'desc'
                          : 'asc',
                    })
                  }
                  type="button"
                >
                  {column.header}
                  {sort?.columnId === column.id ? (
                    sort.direction === 'asc' ? (
                      <ArrowUp className="size-3.5" />
                    ) : (
                      <ArrowDown className="size-3.5" />
                    )
                  ) : (
                    <ChevronsUpDown className="size-3.5 opacity-40" />
                  )}
                </button>
              ) : (
                column.header
              )}
            </TableHead>
          ))}
          {rowActions && <TableHead className="w-12" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            className={cn(onRowClick && 'cursor-pointer')}
            data-testid={rowTestId?.(row)}
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map((column) => (
              <TableCell
                className={cn(
                  'py-5 align-middle',
                  column.align === 'right' && 'text-right'
                )}
                key={column.id}
              >
                {column.cell(row)}
              </TableCell>
            ))}
            {rowActions && (
              // Stops the row's own click: opening the menu must not also open
              // the record behind it.
              <TableCell
                className="py-5 text-right"
                onClick={(event) => event.stopPropagation()}
              >
                {rowActions(row)}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
