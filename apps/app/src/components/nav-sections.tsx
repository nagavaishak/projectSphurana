'use client';

import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import { branchHandle as toBranchHandle } from '@/features/organization-locations/branch-path';
import { useActiveLocation } from '@/features/organization-locations/use-active-location';
import {
  type DashboardNavSection,
  isDashboardNavItemActive,
  isDashboardSectionActive,
  resolveNavUrl,
} from '@/lib/dashboard-nav';

/**
 * shadcn `sidebar-10` → `nav-workspaces.tsx`, adapted to our nav config.
 *
 * Same markup: a `Collapsible` per section, the section title as a
 * `SidebarMenuButton`, a `SidebarMenuAction` chevron that rotates on open, and
 * the children in a `SidebarMenuSub`.
 *
 * Departures from the block:
 *
 * 1. The chevron is NOT `showOnHover`. In sidebar-10 these are a Notion-style
 *    workspace tree — secondary, hover-revealed. Here they are the product's
 *    primary navigation, so an affordance you can only find by hovering is
 *    wrong (and unreachable on touch).
 * 2. Sections with no children render as a plain row rather than an empty
 *    collapsible, so Calendar and Customers don't grow a chevron that opens
 *    onto nothing.
 * 3. A parent with children never paints as active — see `NavSectionItem`.
 * 4. Accordion: at most ONE section is open at a time, across every group.
 *    Two open sections put the same label on screen twice (Memberships lives
 *    under both Catalog and Sales), which reads as a duplicated tab.
 */
export function NavSections({
  sections,
  pathname,
  onNavigate,
}: {
  sections: DashboardNavSection[];
  pathname: string;
  onNavigate?: () => void;
}) {
  // The branch every location-scoped nav target is resolved against.
  //
  // `useActiveLocation` rather than `useRoutes`/`useResolvedRoutes` on purpose:
  // it is URL-first but falls back to the remembered branch and then to the
  // org's PRIMARY, so the sidebar still links into a real branch from an
  // org-level page (`/dashboard/settings`) on a cold start with empty storage.
  // The other two fall back to the UN-PREFIXED paths there, which is precisely
  // the state that had every sidebar click going through the compatibility
  // splat. The switcher in this same sidebar already holds the locations query,
  // so this costs no extra request.
  const { location } = useActiveLocation();
  const branchHandle = location ? toBranchHandle(location) : null;

  // Which section is expanded — exactly one, or none. Held here rather than per
  // item so that opening one closes the rest.
  const activeSlug = sections.find(
    (section) =>
      (section.items?.length ?? 0) > 0 &&
      isDashboardSectionActive(section, pathname)
  )?.slug;
  const [openSlug, setOpenSlug] = useState<string | undefined>(activeSlug);

  // Follow navigation: landing inside a section by any route — a sub-item, a
  // redirect, a typed URL — expands it and collapses whatever was open.
  //
  // Assigning `activeSlug` even when it is undefined is the point: navigating
  // to a section that HAS no subtabs (Customers, Calendar) must collapse
  // whatever was open. Guarding on `if (activeSlug)` left the previous section
  // hanging open under a page it had nothing to do with.
  //
  // Manually opening a section without navigating does not re-run this — the
  // effect keys on `activeSlug`, which has not changed — so a section you open
  // by its chevron stays open until you navigate into a different one.
  useEffect(() => {
    setOpenSlug(activeSlug);
  }, [activeSlug]);

  // One SidebarGroup per `group`, in declaration order. Sections with no group
  // form the leading, unlabelled block; "Location" gets a SidebarGroupLabel —
  // the same slot sidebar-10's NavWorkspaces uses for its "Workspaces" heading.
  const groups: {
    label: string | undefined;
    sections: DashboardNavSection[];
  }[] = [];
  for (const section of sections) {
    const last = groups.at(-1);
    if (last && last.label === section.group) last.sections.push(section);
    else groups.push({ label: section.group, sections: [section] });
  }

  return (
    <>
      {groups.map((group) => (
        // `pb-0`: the seam between groups is owned by the NEXT group's `pt-2`
        // alone, so it matches the 8px under the switcher instead of doubling.
        <SidebarGroup className="pb-0" key={group.label ?? '__ungrouped'}>
          {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.sections.map((section) => (
                <NavSectionItem
                  branchHandle={branchHandle}
                  key={section.slug}
                  onNavigate={onNavigate}
                  onOpenChange={(isOpen) =>
                    setOpenSlug(isOpen ? section.slug : undefined)
                  }
                  open={openSlug === section.slug}
                  pathname={pathname}
                  section={section}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

function NavSectionItem({
  section,
  pathname,
  open,
  onOpenChange,
  onNavigate,
  branchHandle,
}: {
  section: DashboardNavSection;
  pathname: string;
  /** Slug-or-id of the branch in scope; null when the org has none yet. */
  branchHandle: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate?: () => void;
}) {
  const sectionActive = isDashboardSectionActive(section, pathname);
  const children = section.items ?? [];

  if (children.length === 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={sectionActive}>
          <Link onClick={onNavigate} to={resolveNavUrl(section, branchHandle)}>
            <section.icon />
            <span>{section.title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  // Land on the first VISIBLE child rather than `section.url`. The two are the
  // same today, but booking-destination filtering can remove a section's first
  // item (ENG-500), and `section.url` would then point at a tab that is no
  // longer in the list.
  const firstChild = children[0];

  // You cannot collapse the section you are standing in: doing so hides the
  // page you are looking at from the navigation, leaving nothing highlighted
  // and no visible route back to its siblings.
  const locked = sectionActive;

  return (
    // `asChild` so the Collapsible renders AS the <li>, not as a <div> wrapping
    // one. Without it the DOM was `<ul> > <div> > <li>`, which axe flags twice
    // over — `list` ("<ul> must only directly contain <li>") and `listitem`
    // ("<li> must be contained in a <ul>") — seven nodes on every authenticated
    // page, and it breaks the list semantics a screen reader announces the nav
    // with. This is the shape shadcn's own sidebar block uses.
    <Collapsible
      asChild
      className="group/collapsible"
      onOpenChange={(next) => {
        if (locked && !next) return;
        onOpenChange(next);
      }}
      open={open || locked}
    >
      <SidebarMenuItem>
        {/*
          A parent with children is a disclosure, not a destination, so it never
          paints a filled background — only the sub-item does.

          `isActive` is deliberately not passed (that is the active fill), and
          the three rules that fill on interaction are overridden: `hover:`,
          `active:`, and `data-[state=open]:hover:` from SidebarMenuButton's
          base classes. The text/icon colour still shifts on hover, so the row
          keeps an affordance without competing with the selected sub-item.
        */}
        <SidebarMenuButton
          asChild
          className="hover:bg-transparent active:bg-transparent data-[state=open]:hover:bg-transparent"
        >
          <Link
            onClick={() => {
              // Clicking the row opens the section AND goes to its first tab.
              onOpenChange(true);
              onNavigate?.();
            }}
            to={resolveNavUrl(firstChild, branchHandle)}
          >
            <section.icon />
            <span>{section.title}</span>
          </Link>
        </SidebarMenuButton>
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            aria-label={`Toggle ${section.title}`}
            className="data-[state=open]:rotate-90"
          >
            <ChevronRight />
          </SidebarMenuAction>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {children.map((item) => (
              <SidebarMenuSubItem key={item.title}>
                <SidebarMenuSubButton
                  asChild
                  isActive={isDashboardNavItemActive(item, pathname)}
                >
                  <Link
                    onClick={onNavigate}
                    to={resolveNavUrl(item, branchHandle)}
                  >
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
