import { type VariantProps, cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Size variants (applied to DialogContent)                                  */
/* -------------------------------------------------------------------------- */

const dialogSizeVariants = cva('gap-0 p-0', {
  variants: {
    size: {
      sm: 'sm:max-w-[400px]',
      md: 'sm:max-w-[500px]',
      lg: 'sm:max-w-[640px]',
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/* -------------------------------------------------------------------------- */
/*  Icon variants                                                             */
/* -------------------------------------------------------------------------- */

const iconContainerVariants = cva(
  'flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*="size-"])]:size-5',
  {
    variants: {
      iconVariant: {
        default: 'bg-primary/10 text-primary',
        muted: 'bg-muted text-foreground',
        destructive: 'bg-destructive/10 text-destructive',
        warning:
          'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
        success:
          'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
      },
    },
    defaultVariants: {
      iconVariant: 'default',
    },
  }
);

/* -------------------------------------------------------------------------- */
/*  Context for size (used by compound sub-components)                        */
/* -------------------------------------------------------------------------- */

type AppDialogSize = 'sm' | 'md' | 'lg';

const SizeContext = React.createContext<AppDialogSize>('md');

/* -------------------------------------------------------------------------- */
/*  AppDialogRoot – compound wrapper                                          */
/* -------------------------------------------------------------------------- */

interface AppDialogRootProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: AppDialogSize;
  children: React.ReactNode;
}

function AppDialogRoot({
  open,
  onOpenChange,
  size = 'md',
  children,
}: AppDialogRootProps) {
  return (
    <SizeContext.Provider value={size}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(dialogSizeVariants({ size }))}
          onInteractOutside={(e) => {
            // Prevent dialog from closing when clicking Google Places autocomplete
            const target = e.target as HTMLElement;
            if (target.closest('.pac-container')) {
              e.preventDefault();
            }
          }}
        >
          {children}
        </DialogContent>
      </Dialog>
    </SizeContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/*  AppDialogHeader                                                           */
/* -------------------------------------------------------------------------- */

interface AppDialogHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon | React.ReactNode;
  iconVariant?: VariantProps<typeof iconContainerVariants>['iconVariant'];
  className?: string;
}

function AppDialogHeader({
  title,
  description,
  icon,
  iconVariant,
  className,
}: AppDialogHeaderProps) {
  const renderedIcon = renderIcon(icon, iconVariant);

  return (
    <div
      data-slot="app-dialog-header"
      className={cn('border-b p-6 pb-4', className)}
    >
      <div className="flex items-start gap-3">
        {renderedIcon}
        <div className="flex-1 space-y-1">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  AppDialogBody                                                             */
/* -------------------------------------------------------------------------- */

interface AppDialogBodyProps {
  children: React.ReactNode;
  className?: string;
}

function AppDialogBody({ children, className }: AppDialogBodyProps) {
  return (
    <div data-slot="app-dialog-body" className={cn('p-6', className)}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  AppDialogFooter                                                           */
/* -------------------------------------------------------------------------- */

interface AppDialogFooterProps {
  children: React.ReactNode;
  className?: string;
}

function AppDialogFooter({ children, className }: AppDialogFooterProps) {
  return (
    <div
      data-slot="app-dialog-footer"
      className={cn(
        'flex flex-col-reverse items-center gap-2 border-t p-4 sm:flex-row sm:justify-end',
        className
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  AppDialog – props-driven convenience component                            */
/* -------------------------------------------------------------------------- */

interface AppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  icon?: LucideIcon | React.ReactNode;
  iconVariant?: VariantProps<typeof iconContainerVariants>['iconVariant'];
  size?: AppDialogSize;
  footer?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
}

function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  iconVariant,
  size = 'md',
  footer,
  children,
  contentClassName,
}: AppDialogProps) {
  return (
    <AppDialogRoot open={open} onOpenChange={onOpenChange} size={size}>
      <AppDialogHeader
        title={title}
        description={description}
        icon={icon}
        iconVariant={iconVariant}
      />
      <AppDialogBody className={contentClassName}>{children}</AppDialogBody>
      {footer && <AppDialogFooter>{footer}</AppDialogFooter>}
    </AppDialogRoot>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function renderIcon(
  icon: LucideIcon | React.ReactNode | undefined,
  iconVariant: VariantProps<typeof iconContainerVariants>['iconVariant']
): React.ReactNode {
  if (!icon) return null;

  const classes = cn(iconContainerVariants({ iconVariant }));

  // Already a rendered React element or primitive – use directly
  if (
    React.isValidElement(icon) ||
    typeof icon === 'string' ||
    typeof icon === 'number'
  ) {
    return <div className={classes}>{icon}</div>;
  }

  // Component reference (function, ForwardRef, memo) – instantiate it
  const Icon = icon as React.ComponentType;
  return (
    <div className={classes}>
      <Icon />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Exports                                                                   */
/* -------------------------------------------------------------------------- */

export {
  AppDialog,
  AppDialogRoot,
  AppDialogHeader,
  AppDialogBody,
  AppDialogFooter,
};

export type {
  AppDialogProps,
  AppDialogRootProps,
  AppDialogHeaderProps,
  AppDialogBodyProps,
  AppDialogFooterProps,
};
