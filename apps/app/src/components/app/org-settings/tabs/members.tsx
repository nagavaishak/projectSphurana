'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useGetActiveOrganization,
  useGetOrganizationMembers,
  useInviteMember,
  useRemoveMember,
} from '@/features/organization';
import { Lock, MoreVertical, Users } from 'lucide-react';
import { useState } from 'react';

export function MembersTab() {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  const { data: activeOrg } = useGetActiveOrganization();
  const organizationId = activeOrg?.id ?? '';

  const { members, isLoading: isPending } =
    useGetOrganizationMembers(organizationId);
  const { execute: removeMember, isExecuting: isRemoving } =
    useRemoveMember(organizationId);
  const { execute: inviteMember, isExecuting: isInviting } =
    useInviteMember(organizationId);

  const handleRemoveMember = (userId: string) => {
    if (!organizationId) return;
    removeMember(userId);
  };

  const handleInviteMember = () => {
    if (!organizationId || !inviteEmail) return;

    inviteMember({ email: inviteEmail });
    setInviteEmail('');
    setInviteDialogOpen(false);
  };

  if (isPending) {
    return (
      <div className="w-full px-6">
        <div className="animate-pulse space-y-4 py-4">
          <div className="h-10 bg-muted rounded w-full" />
          <div className="h-32 bg-muted rounded w-full" />
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="w-full px-6 py-4">
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length > 0 ? (
                members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.user?.name ?? 'Unknown'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.user?.email ?? 'Unknown'}
                    </TableCell>
                    <TableCell>
                      {member.role === 'owner' || member.role === 'admin' ? (
                        <Badge variant="secondary" className="gap-1">
                          <Lock className="h-3 w-3" />
                          Admin
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <Users className="h-3 w-3" />
                          Member
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={isRemoving}
                          >
                            <span className="sr-only">Open menu</span>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleRemoveMember(member.userId)}
                            className="text-red-600"
                          >
                            Remove Member
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    No team members found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-end pt-4">
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                Invite
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Team Member</DialogTitle>
                <DialogDescription>
                  Send an invitation to a new team member via email.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Input
                  placeholder="Email address"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setInviteDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleInviteMember}
                  disabled={isInviting || !inviteEmail}
                >
                  {isInviting ? 'Sending...' : 'Send Invitation'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </ScrollArea>
  );
}
