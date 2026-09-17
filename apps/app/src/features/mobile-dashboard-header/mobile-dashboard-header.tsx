import { glassBlurClass } from '@/features/mobile-bottom-tabs/mobile-bottom-tabs-motion';
import { cn } from '@/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { useMobileDashboardHeaderContext } from './mobile-dashboard-header-context';
import { mobileDashboardHeaderDefaultBack } from './mobile-dashboard-header-default-back';
import {
  MOBILE_DASHBOARD_HEADER_Z_CLASS,
  mobileDashboardHeaderTopOffsetStyle,
} from './mobile-dashboard-header-layout';
import type {
  MobileDashboardHeaderAction,
  MobileDashboardHeaderContent,
} from './mobile-dashboard-header-types';
import { MobileHeaderIconButton } from './mobile-header-icon-button';
import { MobileHeaderLocation } from './mobile-header-location';

export interface MobileDashboardHeaderProps
  extends MobileDashboardHeaderContent {
  className?: string;
}

function HeaderTitleBlock({
  heading,
  subheading,
  centerTitle,
  compactTitle,
}: {
  heading?: string;
  subheading?: string;
  centerTitle: boolean;
  compactTitle: boolean;
}) {
  const hasHeading = Boolean(heading?.trim());
  const hasSubheading = Boolean(subheading?.trim());
  const useCompactHeading = compactTitle || hasSubheading;

  if (!hasHeading && !hasSubheading) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-0.5',
        centerTitle ? 'items-center px-1 text-center' : 'justify-center pr-1'
      )}
    >
      {hasHeading ? (
        // <h1>, not <p>. This is the page's title, and it was a <p> styled to
        // LOOK like one — so every mobile dashboard page rendered with zero
        // heading elements in its accessibility tree. Screen-reader users had
        // nothing to navigate by (heading rotor empty, no document outline), and
        // `getByRole('heading')` found nothing at the mobile viewport while the
        // desktop <h1> was right there.
        <h1
          className={cn(
            'max-w-full truncate text-[#0A0A0A]',
            centerTitle && 'w-full',
            useCompactHeading
              ? 'text-[15px] font-semibold leading-tight'
              : 'text-[32px] font-bold leading-tight tracking-[-0.02em]'
          )}
        >
          {heading}
        </h1>
      ) : null}
      {hasSubheading ? (
        <p
          className={cn(
            'max-w-full truncate text-[13px] leading-snug text-[#737373]',
            centerTitle && 'w-full'
          )}
        >
          {subheading}
        </p>
      ) : null}
    </div>
  );
}

function HeaderActionButton({
  action,
}: { action: MobileDashboardHeaderAction }) {
  return (
    <MobileHeaderIconButton
      aria-label={action.ariaLabel}
      className={cn('relative', action.className)}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {action.icon}
      {action.showBadge ? (
        <span
          className="absolute right-2.5 bottom-2.5 size-2 rounded-full bg-[#FF3B30] ring-2 ring-white"
          aria-hidden
        />
      ) : null}
    </MobileHeaderIconButton>
  );
}

/**
 * The header's trailing edge carries the PAGE's own controls and nothing else.
 *
 * It used to end in a fixed trio — inbox shortcut, notifications bell, avatar —
 * on every dashboard screen. Three glass circles competing with whatever the
 * page itself needed to put there, none of them about the screen you were
 * looking at. Inbox is now a bottom tab, and Profile and Notifications are
 * cards in More: each is a labelled destination instead of an unlabelled icon,
 * and the corner is free for the page.
 *
 * `hideInbox` and `hideNotifications` stay on the content type — pages that
 * want the bell alongside their own controls compose it explicitly through
 * `extraActions` or `rightSlot`, which is the seam those flags were really for.
 */
function DefaultHeaderActions({ extraActions }: { extraActions?: ReactNode }) {
  return (
    <>
      {extraActions}
      <MobileHeaderLocation />
    </>
  );
}

function HeaderTrailing({ config }: { config: MobileDashboardHeaderContent }) {
  if (config.hideTrailing) {
    return null;
  }

  if (config.rightSlot) {
    return <>{config.rightSlot}</>;
  }

  if (config.rightActions && config.rightActions.length > 0) {
    return (
      <>
        {config.rightActions.map((action) => (
          <HeaderActionButton key={action.id} action={action} />
        ))}
      </>
    );
  }

  return <DefaultHeaderActions extraActions={config.extraActions} />;
}

function mergeHeaderConfig(
  fromContext: MobileDashboardHeaderContent,
  props: MobileDashboardHeaderProps
): MobileDashboardHeaderContent {
  return {
    heading: props.heading ?? fromContext.heading,
    subheading: props.subheading ?? fromContext.subheading,
    showBack: props.showBack ?? fromContext.showBack,
    onBack: props.onBack ?? fromContext.onBack,
    centerTitle: props.centerTitle ?? fromContext.centerTitle,
    compactTitle: props.compactTitle ?? fromContext.compactTitle,
    centerSlot: props.centerSlot ?? fromContext.centerSlot,
    leadingSlot: props.leadingSlot ?? fromContext.leadingSlot,
    titleSlot: props.titleSlot ?? fromContext.titleSlot,
    alignItemsTop: props.alignItemsTop ?? fromContext.alignItemsTop,
    extraActions: props.extraActions ?? fromContext.extraActions,
    hideInbox: props.hideInbox ?? fromContext.hideInbox,
    hideNotifications: props.hideNotifications ?? fromContext.hideNotifications,
    hideTrailing: props.hideTrailing ?? fromContext.hideTrailing,
    rightActions: props.rightActions ?? fromContext.rightActions,
    rightSlot: props.rightSlot ?? fromContext.rightSlot,
  };
}

/**
 * Full-width blur header — title copy is plain text; actions stay as glass pills.
 */
export function MobileDashboardHeader({
  className,
  ...props
}: MobileDashboardHeaderProps) {
  const navigate = useNavigate();
  const { content: contextContent } = useMobileDashboardHeaderContext();
  const config = mergeHeaderConfig(contextContent, props);

  const {
    heading,
    subheading,
    showBack,
    onBack,
    centerTitle = false,
    compactTitle = false,
    centerSlot,
    titleSlot,
    alignItemsTop = false,
    hideTrailing = false,
  } = config;

  const hasTitle = Boolean(heading?.trim() || subheading?.trim());
  const hasCenterSlot = Boolean(centerSlot);
  const hasTitleSlot = Boolean(titleSlot);
  const useCenterTitleLayout = centerTitle || hasCenterSlot;
  const hasCustomTrailing =
    !hideTrailing &&
    (Boolean(config.rightSlot) ||
      Boolean(config.rightActions && config.rightActions.length > 0));

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    mobileDashboardHeaderDefaultBack(navigate);
  };

  // Leading slot precedence: an explicit slot from the page, then Back.
  //
  // The branch chip used to be the last arm here, which meant Back displaced it
  // on every screen you navigate INTO — and since the shared shell gives every
  // page a Back control, "the branch is still one tap away on the root screen"
  // stopped being true: the switcher had disappeared from all but three
  // screens. It sits on the TRAILING edge now (see `DefaultHeaderActions`),
  // which the inbox/bell/avatar trio vacated, so the two controls no longer
  // compete for one corner.
  const leadingSlot: ReactNode = config.leadingSlot ? (
    config.leadingSlot
  ) : showBack ? (
    // A BARE arrow, not a glass pill.
    //
    // The pill was there to hold its own against the branch chip and the
    // inbox/bell/avatar trio it used to share the bar with. Those are gone, so
    // a white circle with a shadow is now the single heaviest element on a
    // screen whose actual title sits underneath it in 32px — chrome shouting
    // over content. The tap target is unchanged; only the decoration went.
    <button
      aria-label="Go back"
      className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full transition active:scale-[0.97] active:bg-black/[0.05]"
      onClick={handleBack}
      type="button"
    >
      <ArrowLeft className="size-6 text-[#0A0A0A]" strokeWidth={2} />
    </button>
  ) : null;

  /*
    The hairline and the white glass are for a header that is a BAR — one that
    carries a title and reads as chrome sitting above the page.

    A header with NO title is not a bar. It is a back arrow, or a branch chip,
    floating over the top of the page — and painting it white with a rule under
    it drew a band across every such screen that read as a rendering seam where
    the white stopped and the grey page began.
  */
  const isBareHeader = !(hasTitle || hasCenterSlot || hasTitleSlot);

  return (
    <header
      aria-label="Dashboard"
      data-mobile-dashboard-header=""
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 md:hidden',
        // A bar that carries a TITLE is chrome, and it says so: white glass and
        // a hairline. One that carries only a back arrow or a branch chip is
        // not chrome — it is the top of the page — so it takes the page's own
        // surface and no rule. White-on-grey there drew a band across the
        // screen that read as a rendering seam.
        isBareHeader
          ? 'bg-sidebar/85 backdrop-blur-md supports-[backdrop-filter]:bg-sidebar/70'
          : cn('border-white/60 border-b', glassBlurClass),
        MOBILE_DASHBOARD_HEADER_Z_CLASS,
        className
      )}
      style={mobileDashboardHeaderTopOffsetStyle()}
    >
      <div
        className={cn(
          'pointer-events-auto grid w-full gap-2 px-4 pb-3',
          alignItemsTop ? 'items-start' : 'items-center',
          useCenterTitleLayout
            ? hasCustomTrailing
              ? 'grid-cols-[3rem_minmax(0,1fr)_auto]'
              : 'grid-cols-[3rem_1fr_3rem]'
            : 'grid-cols-[auto_1fr_auto]'
        )}
      >
        <div
          className={cn(
            'flex shrink-0 justify-start',
            alignItemsTop ? 'items-start' : 'items-center',
            useCenterTitleLayout && 'w-12'
          )}
        >
          {leadingSlot}
        </div>

        {hasTitleSlot ? (
          <div className="flex min-w-0 items-center justify-start">
            {titleSlot}
          </div>
        ) : hasCenterSlot ? (
          <div className="flex min-w-0 justify-center">{centerSlot}</div>
        ) : hasTitle ? (
          <HeaderTitleBlock
            centerTitle={centerTitle}
            compactTitle={compactTitle}
            heading={heading}
            subheading={subheading}
          />
        ) : (
          <div className="min-w-0" aria-hidden />
        )}

        <div
          className={cn(
            'flex shrink-0 justify-end gap-2',
            alignItemsTop ? 'items-start' : 'items-center',
            useCenterTitleLayout && !hasCustomTrailing && 'w-12'
          )}
        >
          <HeaderTrailing config={config} />
        </div>
      </div>
    </header>
  );
}
