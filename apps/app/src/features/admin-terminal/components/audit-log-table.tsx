import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Filter,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { AuditLogEntry } from '../api';
import { useListAuditLogs } from '../api';

const PAGE_SIZE = 25;

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  update: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  delete: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  restore: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

const ACTOR_COLORS: Record<string, string> = {
  user: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  system: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  job: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-IE', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

function MetadataCell({
  metadata,
}: { metadata: Record<string, unknown> | null }) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <pre className="max-w-[300px] truncate text-xs text-muted-foreground">
      {JSON.stringify(metadata, null, 0)}
    </pre>
  );
}

function LogRow({ log }: { log: AuditLogEntry }) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-sm">
        {formatDate(log.createdAt)}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={ACTION_COLORS[log.action] ?? ''}>
          {log.action}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-sm">{log.entityType}</TableCell>
      <TableCell className="max-w-[120px] truncate font-mono text-xs">
        {log.entityId}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={ACTOR_COLORS[log.actorType] ?? ''}>
          {log.actorType}
        </Badge>
      </TableCell>
      <TableCell className="max-w-[120px] truncate font-mono text-xs">
        {log.actorId ?? <span className="text-muted-foreground">-</span>}
      </TableCell>
      <TableCell className="max-w-[120px] truncate font-mono text-xs">
        {log.organizationId ?? <span className="text-muted-foreground">-</span>}
      </TableCell>
      <TableCell>
        <MetadataCell metadata={log.metadata} />
      </TableCell>
    </TableRow>
  );
}

export function AuditLogTable() {
  const [page, setPage] = useState(0);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [orgIdFilter, setOrgIdFilter] = useState('');

  const { logs, total, isLoading, refetch } = useListAuditLogs({
    entityType: entityTypeFilter || undefined,
    action: actionFilter || undefined,
    organizationId: orgIdFilter || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Audit Log
            </CardTitle>
            <CardDescription>
              {total} total entries
              {entityTypeFilter && ` (filtered: ${entityTypeFilter})`}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Entity type (e.g. offer, lead)"
            value={entityTypeFilter}
            onChange={(e) => {
              setEntityTypeFilter(e.target.value);
              setPage(0);
            }}
            className="w-48"
          />
          <Select
            value={actionFilter}
            onValueChange={(v) => {
              setActionFilter(v === 'all' ? '' : v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
              <SelectItem value="restore">Restore</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Organization ID"
            value={orgIdFilter}
            onChange={(e) => {
              setOrgIdFilter(e.target.value);
              setPage(0);
            }}
            className="w-64"
          />
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>Entity ID</TableHead>
                <TableHead>Actor Type</TableHead>
                <TableHead>Actor ID</TableHead>
                <TableHead>Org ID</TableHead>
                <TableHead>Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No audit log entries found.
                    {entityTypeFilter || actionFilter || orgIdFilter
                      ? ' Try adjusting your filters.'
                      : ' Soft delete or restore an entity to see entries appear.'}
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => <LogRow key={log.id} log={log} />)
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
