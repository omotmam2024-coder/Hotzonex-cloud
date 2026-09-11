import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { AuditLogRow } from '@hotzonex/shared/database';
import type { AuditFilters } from '@/lib/queries/misc';
import { useAuditLog } from '@/lib/queries/misc';
import { EmptyState, ErrorState, TableSkeleton } from './states';
import { Button } from './ui/button';
import { Table, TBody, TD, TH, THead, TR } from './ui/table';

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'router.created': 'Router added',
  'router.updated': 'Router changed',
  'router.deleted': 'Router deleted',
  'router.credentials.submitted': 'Credentials submitted',
  'router.credentials.stored': 'Credentials stored (encrypted)',
  'router.credentials.rejected': 'Credentials rejected',
  'router.test_connection.requested': 'Connection test requested',
  'router.test_connection.succeeded': 'Connection test passed',
  'router.test_connection.failed': 'Connection test failed',
  'router.test_permissions.requested': 'Permission check requested',
  'router.test_permissions.succeeded': 'Permission check finished',
  'router.test_permissions.failed': 'Permission check failed',
  'router.sync.requested': 'Sync requested',
  'router.sync.succeeded': 'Sync finished',
  'router.sync.failed': 'Sync failed',
  'router.sync.dead': 'Sync gave up',
  'router.fetch_logs.requested': 'Logs requested',
  'router.fetch_logs.succeeded': 'Logs fetched',
  'router.fetch_logs.failed': 'Log fetch failed',
  'router.ingest_credentials.requested': 'Credential storage queued',
  'router.ingest_credentials.succeeded': 'Credential storage finished',
  'router.ingest_credentials.failed': 'Credential storage failed',
  'location.created': 'Location added',
  'location.updated': 'Location changed',
  'location.deleted': 'Location deleted',
  'settings.created': 'Setting added',
  'settings.updated': 'Setting changed',
  'settings.deleted': 'Setting removed',
  'settings.organization.updated': 'Organization changed',
  'team.member.updated': 'Team member changed',
  'team.invite.created': 'Invitation sent',
  'team.invite.updated': 'Invitation changed',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-[11px]">{JSON.stringify(value, null, 2)}</pre>;
}

function Row({ row }: { row: AuditLogRow }) {
  const [open, setOpen] = useState(false);
  const hasDetail = row.before !== null || row.after !== null;
  return (
    <Fragment>
      <TR>
        <TD className="w-6 pr-0">
          {hasDetail ? (
            <button type="button" className="cursor-pointer text-muted-foreground" aria-expanded={open} aria-label={open ? 'Hide details' : 'Show details'} onClick={() => setOpen((o) => !o)}>
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ) : null}
        </TD>
        <TD className="whitespace-nowrap text-xs tabular text-muted-foreground">{new Date(row.created_at).toLocaleString()}</TD>
        <TD>
          <div className="font-medium">{actionLabel(row.action)}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{row.action}</div>
        </TD>
        <TD className="max-w-48 truncate">{row.actor_email ?? (row.actor_type === 'system' ? 'system' : '—')}</TD>
        <TD className="whitespace-nowrap text-xs">
          {row.entity_type}
          {row.entity_id ? <span className="block max-w-40 truncate font-mono text-[11px] text-muted-foreground">{row.entity_id}</span> : null}
        </TD>
        <TD className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">{row.ip ?? ''}</TD>
      </TR>
      {open ? (
        <TR className="bg-muted/30 hover:bg-muted/30">
          <TD />
          <TD colSpan={5}>
            <div className="grid gap-3 py-1 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium">Before</p>
                <Json value={row.before} />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">After</p>
                <Json value={row.after} />
              </div>
            </div>
            {row.user_agent ? <p className="mt-2 truncate text-[11px] text-muted-foreground">{row.user_agent}</p> : null}
          </TD>
        </TR>
      ) : null}
    </Fragment>
  );
}

/** Read-only by design: the audit log has no edit or delete controls, and the database forbids both. */
export function AuditTable({ filters }: { filters: AuditFilters }) {
  const log = useAuditLog(filters);
  if (log.isPending) return <TableSkeleton rows={8} cols={5} />;
  if (log.isError) {
    return (
      <div className="p-4">
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      </div>
    );
  }
  const rows = log.data.pages.flat();
  if (rows.length === 0) {
    return <EmptyState icon={<ScrollText />} title="No matching audit entries" description="Entries appear here as people sign in, change routers, locations and settings, and as the connector reports results." />;
  }
  return (
    <>
      <Table containerClassName="max-h-[70dvh]">
        <THead>
          <TR className="hover:bg-transparent">
            <TH className="w-6" />
            <TH>When</TH>
            <TH>Action</TH>
            <TH>Actor</TH>
            <TH>Entity</TH>
            <TH>IP</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Row key={r.id} row={r} />
          ))}
        </TBody>
      </Table>
      {log.hasNextPage ? (
        <div className="border-t p-3 text-center">
          <Button variant="outline" size="sm" loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
            Load older entries
          </Button>
        </div>
      ) : null}
    </>
  );
}
