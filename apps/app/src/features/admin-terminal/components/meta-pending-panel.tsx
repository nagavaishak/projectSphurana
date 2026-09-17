import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangleIcon,
  CopyIcon,
  Facebook,
  Instagram,
  LinkIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  type PendingMetaConnection,
  useClaimPendingMetaConnection,
  useSelfServeMetaLink,
  usedPendingMetaConnections,
} from '../api';
import { OrgCombobox, type SelectedOrg } from './org-combobox';

/**
 * Meta connections that arrived through the shareable link and belong to
 * nobody yet.
 *
 * A prospect authorises during the sales call, before their workspace exists.
 * The connection waits here until an operator says whose it is — which is a
 * RECOGNITION task, not a matching one, because the Page name they authorised
 * is the business name. That is why this shows Page and Instagram handle
 * prominently and the connection id not at all.
 */
export function MetaPendingPanel() {
  const { connections, isLoading, isFetching, isError, error, refetch } =
    usedPendingMetaConnections();
  const {
    link,
    isError: isLinkError,
    error: linkError,
  } = useSelfServeMetaLink();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>The onboarding link</CardTitle>
          <CardDescription>
            One link for every prospect — it needs no Borradh account, so it can
            go out during the sales call.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLinkError ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertDescription>
                {linkError?.message ?? 'Could not build the onboarding link.'}
              </AlertDescription>
            </Alert>
          ) : link ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                readOnly
                value={link.url}
                className="flex-1 font-mono text-xs"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(link.url);
                  toast.success('Link copied');
                }}
              >
                <CopyIcon />
                Copy
              </Button>
            </div>
          ) : (
            <Skeleton className="h-9 w-full" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waiting to be linked</CardTitle>
          <CardDescription>
            Businesses that have authorised us. Nothing is published, read or
            subscribed until one is attached to a workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCwIcon
              className={isFetching ? 'animate-spin' : undefined}
            />
            Refresh
          </Button>

          {isError ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertDescription>
                {error?.message ?? 'Could not load pending connections.'}
              </AlertDescription>
            </Alert>
          ) : null}

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : connections.length === 0 && !isError ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LinkIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing waiting</EmptyTitle>
                <EmptyDescription>
                  Connections appear here as soon as someone completes the link
                  above.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            connections.map((connection) => (
              <PendingConnectionCard
                key={connection.id}
                connection={connection}
                onLinked={() => void refetch()}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PendingConnectionCard({
  connection,
  onLinked,
}: {
  connection: PendingMetaConnection;
  onLinked: () => void;
}) {
  const [org, setOrg] = useState<SelectedOrg | null>(null);
  const [pageIds, setPageIds] = useState<Set<string>>(
    // One Page is the overwhelming case, and pre-ticking it removes a click
    // without ever choosing between two.
    new Set(connection.pages.length === 1 ? [connection.pages[0].id] : [])
  );
  const [adAccountId, setAdAccountId] = useState<string>(
    connection.adAccounts.length === 1 ? connection.adAccounts[0].id : ''
  );

  const { claim, isClaiming } = useClaimPendingMetaConnection({
    onSuccess: onLinked,
  });

  const togglePage = (id: string) =>
    setPageIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const adAccount = connection.adAccounts.find(
    (account) => account.id === adAccountId
  );

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {connection.pages[0]?.name ?? 'Unknown business'}
        </span>
        {connection.metaUserName ? (
          <Badge variant="outline">
            authorised by {connection.metaUserName}
          </Badge>
        ) : null}
        <span className="text-muted-foreground text-xs">
          {new Date(connection.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* The configuration is not readable through the Graph API, so this is
          the only place a missing permission ever becomes visible — and the
          alternative is finding out weeks later when a post silently fails. */}
      {connection.missingScopes.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertDescription>
            The Login for Business configuration did not grant:{' '}
            <span className="font-mono">
              {connection.missingScopes.join(', ')}
            </span>
            . Add them to the configuration in the Meta app, then have them
            authorise again — linking now leaves this workspace without those
            capabilities.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* A real expiry means the FLfB configuration is issuing a USER token
          rather than a system-user one. It works today and dies in ~60 days,
          which is the exact failure this flow exists to avoid. */}
      {connection.tokenExpiresAt ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertDescription>
            This token expires on{' '}
            {new Date(connection.tokenExpiresAt).toLocaleDateString()}. The
            Login for Business configuration is issuing a user token — fix it to
            a System User token with Never expiration, or this connection dies
            in about 60 days.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1">
        {connection.pages.map((page) => (
          <label
            key={page.id}
            htmlFor={`page-${connection.id}-${page.id}`}
            className="flex items-center gap-2 text-sm"
          >
            <Checkbox
              id={`page-${connection.id}-${page.id}`}
              checked={pageIds.has(page.id)}
              onCheckedChange={() => togglePage(page.id)}
            />
            <Facebook className="size-3.5" />
            <span>{page.name}</span>
            {page.instagramUsername ? (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <Instagram className="size-3" />@{page.instagramUsername}
              </span>
            ) : null}
          </label>
        ))}
      </div>

      {connection.adAccounts.length > 0 ? (
        <div className="space-y-1">
          {connection.adAccounts.map((account) => (
            <label
              key={account.id}
              htmlFor={`ad-${connection.id}-${account.id}`}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="radio"
                id={`ad-${connection.id}-${account.id}`}
                name={`ad-${connection.id}`}
                checked={adAccountId === account.id}
                onChange={() => setAdAccountId(account.id)}
              />
              <span>{account.name}</span>
              <span className="text-muted-foreground text-xs">
                {account.id}
                {account.currency ? ` · ${account.currency}` : ''}
              </span>
            </label>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <OrgCombobox value={org} onChange={setOrg} className="w-72" />
        <Button
          disabled={!org || pageIds.size === 0 || isClaiming}
          onClick={() =>
            org &&
            claim({
              pendingConnectionId: connection.id,
              organizationId: org.id,
              pageIds: [...pageIds],
              adAccountId: adAccount?.id,
              adAccountName: adAccount?.name,
            })
          }
        >
          <LinkIcon />
          {isClaiming ? 'Linking…' : 'Link to this workspace'}
        </Button>
      </div>
    </div>
  );
}
