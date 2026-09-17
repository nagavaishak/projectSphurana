import { Link, createFileRoute } from '@tanstack/react-router';
import {
  Bell,
  Bot,
  Building2,
  CalendarCheck,
  CalendarX,
  ChevronRight,
  ClipboardList,
  CreditCard,
  type LucideIcon,
  MapPin,
  MessageSquare,
  Palette,
  Plug,
  Wallet,
} from 'lucide-react';

import { PageShell } from '@/components/app/page-shell';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ROUTES } from '@/lib/route-paths';

/**
 * Organisation settings — the hub the sidebar's pinned row lands on.
 *
 * Until now that row went to `/dashboard/settings`, which is the PERSONAL
 * profile page (name, password, delete account), so "Organisation settings"
 * opened your own account. The org-level settings themselves existed only as
 * routes, reachable from the mobile account list or by typing the URL; on
 * desktop nothing indexed them. This page is that index: one card per
 * destination, grouped the way the account list groups them.
 *
 * Personal settings deliberately do NOT appear here — they hang off the user
 * menu at the foot of the sidebar (NavUser → Settings / Account).
 */
export const Route = createFileRoute('/_authed/dashboard/organisation')({
  component: OrganisationSettingsPage,
});

interface SettingsCard {
  title: string;
  description: string;
  icon: LucideIcon;
  url: string;
}

interface SettingsGroup {
  label: string;
  cards: SettingsCard[];
}

const GROUPS: SettingsGroup[] = [
  {
    label: 'Business',
    cards: [
      {
        title: 'Locations',
        description:
          'Every branch you operate. Team, services and stock are assigned per location.',
        icon: MapPin,
        url: ROUTES.locations,
      },
      {
        title: 'Details',
        description:
          'Business name, website and privacy policy — the details clients see.',
        icon: Building2,
        url: ROUTES.settingsDetails,
      },
      {
        title: 'Brand style',
        description:
          'Logo, colours and fonts used across your content and booking page.',
        icon: Palette,
        url: ROUTES.brand,
      },
    ],
  },
  {
    label: 'Bookings',
    cards: [
      {
        title: 'Booking settings',
        description:
          'How clients book with you: lead times, cancellations and deposits.',
        icon: CalendarCheck,
        url: ROUTES.settingsBookings,
      },
      {
        title: 'Consent forms',
        description:
          'Forms attached to services and collected before an appointment.',
        icon: ClipboardList,
        url: ROUTES.settingsConsentForms,
      },
      {
        title: 'Intake forms',
        description: 'What you ask new clients before their first visit.',
        icon: ClipboardList,
        url: ROUTES.intakeForms,
      },
      {
        title: 'Blocked time types',
        description:
          'The reasons your team can block out time in the calendar.',
        icon: CalendarX,
        url: ROUTES.settingsBlockedTimeTypes,
      },
    ],
  },
  {
    label: 'Claire & integrations',
    cards: [
      {
        title: 'Integrations',
        description:
          'Connect Meta, Instagram, Google, Stripe and the rest of your stack.',
        icon: Plug,
        url: ROUTES.integrations,
      },
      {
        title: 'Claire WhatsApp',
        description: 'The WhatsApp number Claire answers on, and its pairing.',
        icon: Bot,
        url: ROUTES.settingsClaireWhatsapp,
      },
      {
        title: 'Message templates',
        description:
          'The wording of the confirmations and reminders you send clients.',
        icon: MessageSquare,
        url: ROUTES.settingsMessageTemplates,
      },
      {
        title: 'Notifications',
        description: 'Which events email or notify you and your team.',
        icon: Bell,
        url: ROUTES.settingsNotifications,
      },
    ],
  },
  {
    label: 'Billing',
    cards: [
      {
        title: 'Payments',
        description:
          'Taking money from clients — card processing, terminals and payouts.',
        icon: Wallet,
        url: ROUTES.settingsPayments,
      },
      {
        title: 'Billing',
        description: 'Your Borradh subscription, invoices and payment method.',
        icon: CreditCard,
        url: ROUTES.settingsBilling,
      },
    ],
  },
];

function OrganisationSettingsPage() {
  return (
    <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
      <title>Organisation settings | Borradh</title>

      <div>
        <h1 className="font-semibold text-2xl">Organisation settings</h1>
        <p className="text-muted-foreground text-sm">
          Everything that applies to your whole business. Settings for a single
          branch live under that branch&apos;s Location Settings.
        </p>
      </div>

      {GROUPS.map((group) => (
        <section className="flex flex-col gap-3" key={group.label}>
          <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {group.label}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.cards.map((card) => (
              <SettingsCardLink card={card} key={card.url} />
            ))}
          </div>
        </section>
      ))}
    </PageShell>
  );
}

function SettingsCardLink({ card }: { card: SettingsCard }) {
  return (
    <Link className="group block h-full" to={card.url}>
      <Card className="h-full transition group-hover:border-primary/40 group-hover:bg-accent/40">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="bg-muted text-muted-foreground rounded-md p-2">
              <card.icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle className="flex items-center gap-1">
                {card.title}
                <ChevronRight className="text-muted-foreground size-4 shrink-0 opacity-0 transition group-hover:opacity-100" />
              </CardTitle>
              <CardDescription className="mt-1">
                {card.description}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}
