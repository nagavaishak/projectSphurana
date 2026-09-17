import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const buttonGroupVariants = cva(
  // Children butt against each other: the shared edge loses its radius so the
  // group reads as ONE control, and `items-stretch` keeps a narrow caret
  // segment exactly as tall as the button beside it.
  'flex w-fit items-stretch [&>*]:relative [&>*]:focus-visible:z-10',
  {
    variants: {
      orientation: {
        horizontal:
          '[&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none',
        vertical:
          'flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:last-child)]:rounded-b-none',
      },
    },
    defaultVariants: {
      orientation: 'horizontal',
    },
  }
);

/**
 * A row of buttons that reads as one control — the split button being the case
 * this exists for: a primary action plus a caret that opens the rest.
 *
 * `role="group"` rather than a bare div so a screen reader announces the pair
 * as related; each button keeps its own accessible name.
 */
function ButtonGroup({
  className,
  orientation,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      className={cn(buttonGroupVariants({ orientation }), className)}
      data-slot="button-group"
      role="group"
      {...props}
    />
  );
}

/**
 * The hairline between two segments.
 *
 * Defaults to the input border, which is right for `outline`/`secondary`
 * groups. On a solid `default` group pass `bg-primary-foreground/25` — the
 * border colour disappears against the primary fill.
 */
function ButtonGroupSeparator({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        'relative m-0! self-stretch bg-input data-[orientation=vertical]:h-auto',
        className
      )}
      data-slot="button-group-separator"
      orientation={orientation}
      {...props}
    />
  );
}

export { ButtonGroup, ButtonGroupSeparator, buttonGroupVariants };
