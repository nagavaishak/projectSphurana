import { normalizePathname } from '@/features/mobile-bottom-tabs/mobile-bottom-tab-routes';

/** Mobile header titles for routes under `/dashboard/settings/*`. */
export const ACCOUNT_SETTINGS_HEADER_BY_PATH: Record<string, string> = {
  [normalizePathname('/dashboard/settings')]: 'Profile',
  '/dashboard/settings/notifications': 'Notifications',
  '/dashboard/settings/claire-whatsapp': 'Claire WhatsApp',
  '/dashboard/settings/details': 'Details',
  '/dashboard/settings/bookings': 'Bookings',
  '/dashboard/settings/style': 'Brand style',
  '/dashboard/settings/billing': 'Billing',
  '/dashboard/settings/integrations': 'Integrations',
  '/dashboard/settings/message-templates': 'Message templates',
};

export function getAccountSettingsHeaderTitle(pathname: string): string {
  const path = normalizePathname(pathname);
  return ACCOUNT_SETTINGS_HEADER_BY_PATH[path] ?? 'Settings';
}

export function isAccountSettingsPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return (
    path === normalizePathname('/dashboard/settings') ||
    path.startsWith('/dashboard/settings/')
  );
}
