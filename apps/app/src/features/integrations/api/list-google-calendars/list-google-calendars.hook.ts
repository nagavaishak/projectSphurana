import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface GoogleCalendarItem {
  id: string;
  summary: string;
  description?: string;
  timeZone: string;
  primary: boolean;
  accessRole: string;
}

interface ListGoogleCalendarsResponse {
  calendars: GoogleCalendarItem[];
}

export const listGoogleCalendarsQueryOptions = (accountId: string) => {
  return queryOptions({
    queryKey: ['integrations', 'calendar', 'accounts', accountId, 'calendars'],
    queryFn: () =>
      apiClient.get<ListGoogleCalendarsResponse>(
        `integrations/calendar/accounts/${accountId}/calendars`
      ),
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useListGoogleCalendars = (accountId: string) => {
  const query = useQuery(listGoogleCalendarsQueryOptions(accountId));

  return {
    calendars: query.data?.calendars ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
