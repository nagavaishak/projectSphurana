import { Badge, type badgeVariants } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Link } from '@tanstack/react-router';
import type { VariantProps } from 'class-variance-authority';
import { ArrowLeftIcon } from 'lucide-react';
import * as React from 'react';

/* ─── Root container ──────────────────────────────────────────────── */

function DedicatedLayout({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dedicated-layout"
      className={cn('flex h-screen w-full flex-col', className)}
      {...props}
    />
  );
}

/* ─── Header bar ──────────────────────────────────────────────────── */

function DedicatedLayoutHeader({
  className,
  ...props
}: React.ComponentProps<'header'>) {
  return (
    <header
      data-slot="dedicated-layout-header"
      className={cn(
        'flex h-14 shrink-0 items-center bg-background px-4',
        className
      )}
      {...props}
    />
  );
}

function DedicatedLayoutHeaderLeft({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dedicated-layout-header-left"
      className={cn('flex items-center gap-3', className)}
      {...props}
    />
  );
}

function DedicatedLayoutHeaderRight({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dedicated-layout-header-right"
      className={cn('ml-auto flex items-center gap-2', className)}
      {...props}
    />
  );
}

/* ─── Optional tab bar ────────────────────────────────────────────── */

function DedicatedLayoutTabs({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dedicated-layout-tabs"
      className={cn('flex shrink-0 items-center bg-background px-4', className)}
      {...props}
    />
  );
}

/* ─── Main content area ───────────────────────────────────────────── */

function DedicatedLayoutContent({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dedicated-layout-content"
      className={cn('flex-1 overflow-hidden', className)}
      {...props}
    />
  );
}

/* ─── Helper: Back button ─────────────────────────────────────────── */

interface DedicatedLayoutBackButtonProps {
  href: string;
  className?: string;
}

function DedicatedLayoutBackButton({
  href,
  className,
}: DedicatedLayoutBackButtonProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Button variant="ghost" size="icon" className="size-8" asChild>
        <Link to={href}>
          <ArrowLeftIcon className="size-4" />
          <span className="sr-only">Go back</span>
        </Link>
      </Button>
      <Separator orientation="vertical" className="h-5" />
    </div>
  );
}

/* ─── Helper: Breadcrumb from items array ─────────────────────────── */

interface BreadcrumbItemData {
  label: string;
  href?: string;
}

interface DedicatedLayoutBreadcrumbProps {
  items: BreadcrumbItemData[];
  className?: string;
}

function DedicatedLayoutBreadcrumb({
  items,
  className,
}: DedicatedLayoutBreadcrumbProps) {
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <React.Fragment key={item.label}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isLast || !item.href ? (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={item.href}>{item.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/* ─── Helper: Status badge ────────────────────────────────────────── */

interface DedicatedLayoutStatusBadgeProps
  extends VariantProps<typeof badgeVariants> {
  label: string;
  className?: string;
}

function DedicatedLayoutStatusBadge({
  label,
  variant = 'secondary',
  className,
}: DedicatedLayoutStatusBadgeProps) {
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}

export {
  DedicatedLayout,
  DedicatedLayoutHeader,
  DedicatedLayoutHeaderLeft,
  DedicatedLayoutHeaderRight,
  DedicatedLayoutTabs,
  DedicatedLayoutContent,
  DedicatedLayoutBackButton,
  DedicatedLayoutBreadcrumb,
  DedicatedLayoutStatusBadge,
};
