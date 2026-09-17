import { ROUTES } from '@/lib/route-paths';
import { apiClient } from '@borradh-workspace/api-client';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Building2, LogIn, Users } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { setAdminSessionToken } from '@/lib/admin-session-token';
import { setAuthTokenAndPersist } from '@/lib/auth-token';

import { useGetOrganizationWithMembers } from '../api';
import { OnboardingPanel } from './onboarding-panel';

interface OrganizationDetailProps {
  organizationId: string;
}

export function OrganizationDetail({
  organizationId,
}: OrganizationDetailProps) {
  const { organization, isLoading, isError } =
    useGetOrganizationWithMembers(organizationId);
  const [impersonatingUserId, setImpersonatingUserId] = useState<string | null>(
    null
  );

  const handleImpersonate = useCallback(async (userId: string) => {
    setImpersonatingUserId(userId);
    try {
      const result = await apiClient.post<{
        token?: string;
        adminSessionToken?: string;
      }>('admin-terminal/impersonate', { userId });
      // Held for the exit: without it Better Auth cannot find the admin to
      // restore, and the banner's button fails silently.
      if (result?.adminSessionToken) {
        setAdminSessionToken(result.adminSessionToken);
      }
      // The API authenticates this client from its Bearer token, not the
      // cookie, so the token has to be swapped for the impersonated one — or
      // the app keeps rendering the admin's own account.
      if (result?.token) await setAuthTokenAndPersist(result.token);
      toast.success('Impersonating user — redirecting...');
      // `/dashboard` (not a branch path): a full page load entering the
      // dashboard from outside it has no branch in scope, and the entry
      // redirect resolves the right one.
      window.location.href = ROUTES.dashboard;
    } catch {
      toast.error('Failed to impersonate user');
      setImpersonatingUserId(null);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (isError || !organization) {
    return (
      <div className="text-muted-foreground py-12 text-center">
        Organization not found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/admin">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{organization.name}</h1>
          <p className="text-muted-foreground text-sm">{organization.slug}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Organization Info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Business Type</dt>
              <dd>
                <Badge variant="secondary">{organization.businessType}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="font-mono">{organization.slug}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{new Date(organization.createdAt).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Members</dt>
              <dd>{organization.members.length}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Members
          </CardTitle>
          <CardDescription>
            {organization.members.length} member
            {organization.members.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Org Role</TableHead>
                <TableHead>Platform Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organization.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        {m.user.image && <AvatarImage src={m.user.image} />}
                        <AvatarFallback>
                          {m.user.name?.charAt(0)?.toUpperCase() ?? '?'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{m.user.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {m.user.email}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {m.user.role === 'admin' ? (
                      <Badge variant="destructive">admin</Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        user
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleImpersonate(m.user.id)}
                      disabled={impersonatingUserId === m.user.id}
                    >
                      <LogIn className="mr-1 h-3.5 w-3.5" />
                      {impersonatingUserId === m.user.id
                        ? 'Impersonating...'
                        : 'Impersonate'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <OnboardingPanel organizationId={organizationId} />
    </div>
  );
}
